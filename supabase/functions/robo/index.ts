// index.ts — Edge Function "robo" (deploy com verify_jwt=false).
// trata(req, deps) é a orquestração testável; deps injeta banco, autenticação do app, IA e relógio.
import type { Agora, Cfg, Cliente, Db, Acao } from './nucleo.ts';
import {
  agoraSP, chaveTelefone, ehObj, efeitosDaAcao, normalizaTelefone, removeEmojis, somaDias, validaAcao,
} from './nucleo.ts';
import { decidir } from './decisao.ts';
import { gerarConfirmacoes, interpretaConfirmacao, valoresModelo } from './confirmacao.ts';
import { montaContents, montaPrompt, extraiJSON } from './prompt.ts';
import type { Content, MsgHist } from './prompt.ts';
import type { Linha, Tabelas } from './banco.ts';
import { aplicaEfeitos, carregaChaves, carregaDb } from './banco.ts';
import { preencheModelo } from './nucleo.ts';

declare const Deno: any;

export type Deps = {
  tab: Tabelas;
  /** JWT do app -> user_id (ou null se inválido). */
  usuarioDoToken: (jwt: string) => Promise<string | null>;
  /** Chama a IA (Gemini com reserva Groq). Lança erro se as duas falharem. */
  ia: (cfg: Cfg, chaves: { gemini: string; groq: string }, system: string, contents: Content[]) => Promise<{ texto: string; provedor?: string }>;
  agora?: () => Date;
  aleatorio?: () => number;
};

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-robo-codigo',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const ROTAS_ROBO = ['pulso', 'mensagem', 'pendentes', 'enviada'];
const ROTAS_APP = ['aprovar', 'simular'];

class ErroHttp extends Error {
  status: number;
  constructor(status: number, msg: string) { super(msg); this.status = status; }
}

function resposta(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
}

export async function sha256hex(s: string): Promise<string> {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('');
}

function notifica(cfg: Cfg, k: string): boolean {
  const n = ehObj(cfg.notificar_dono) ? cfg.notificar_dono : {};
  return n[k] !== false;
}

type Ctx = { deps: Deps; tab: Tabelas; agora: Agora; agoraMs: number; nowIso: string; aleatorio: () => number };

async function aviso(c: Ctx, tipo: string, texto: string, telefone?: string | null): Promise<void> {
  await c.tab.ins('avisos', { tipo, texto: String(texto).slice(0, 1000), telefone: telefone || null });
}
function isoMais(c: Ctx, seg: number): string { return new Date(c.agoraMs + Math.round(seg * 1000)).toISOString(); }
function atrasoSeg(c: Ctx, cfg: Cfg): number {
  const a = ehObj(cfg.atraso_resposta_seg) ? cfg.atraso_resposta_seg : {};
  let min = Number(a.min), max = Number(a.max);
  if (!(min >= 0)) min = 8;
  if (!(max >= min)) max = min;
  return min + (max - min) * c.aleatorio();
}
async function cfgAtual(tab: Tabelas): Promise<Cfg> {
  const l = (await tab.sel('config', { id: 1 }))[0];
  return (l && l.dados) || {};
}
function acharCliente(db: Db, tel: string): Cliente | null {
  const k = chaveTelefone(tel);
  return db.clientes.find((x) => x.telefone && chaveTelefone(x.telefone) === k) || null;
}
function jidIndividual(jid: unknown): boolean {
  if (jid == null || jid === '') return true;
  const j = String(jid);
  if (j === 'status@broadcast' || /@(g\.us|broadcast|newsletter)$/.test(j)) return false;
  return /@(s\.whatsapp\.net|c\.us|lid)$/.test(j);
}
function ehUnico(e: any): boolean { return !!e && e.code === '23505'; }

/* ---------------- autenticação ---------------- */
async function autenticaRobo(c: Ctx, req: Request): Promise<void> {
  const cod = String(req.headers.get('x-robo-codigo') || '').trim().toUpperCase();
  if (!cod) throw new ErroHttp(401, 'Código do robô ausente.');
  const hash = await sha256hex(cod);
  const l = (await c.tab.sel('robo_codigos', { hash, revogado: false }))[0];
  if (!l) throw new ErroHttp(401, 'Código inválido, gere outro no app.');
  if (!l.usado_em) await c.tab.upd('robo_codigos', { id: l.id }, { usado_em: c.nowIso });
}
async function autenticaDono(c: Ctx, req: Request): Promise<string> {
  const h = String(req.headers.get('authorization') || '');
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) throw new ErroHttp(401, 'Faça login de novo.');
  const uid = await c.deps.usuarioDoToken(m[1].trim());
  if (!uid) throw new ErroHttp(401, 'Faça login de novo.');
  const d = await c.tab.sel('dono', { user_id: uid });
  if (!d.length) throw new ErroHttp(401, 'Esta conta não é a do dono.');
  return uid;
}

/* ---------------- pulso ---------------- */
async function rotaPulso(c: Ctx, b: Linha) {
  const cfg = await cfgAtual(c.tab);
  const antes = (await c.tab.sel('robo', { id: 1 }))[0];
  const conectado = b.conectado === true;
  const linha = {
    online_em: c.nowIso, conectado,
    qr: typeof b.qr === 'string' && b.qr ? b.qr.slice(0, 20000) : null,
    numero: typeof b.numero === 'string' && b.numero ? b.numero.slice(0, 32) : null,
    versao: typeof b.versao === 'string' ? b.versao.slice(0, 32) : null,
  };
  const upd = await c.tab.upd('robo', { id: 1 }, linha);
  if (!upd.length) await c.tab.ups('robo', { id: 1, ...linha }, 'id');
  if (!conectado && antes && antes.conectado && notifica(cfg, 'robo_offline')) {
    await aviso(c, 'robo_offline', 'O robô perdeu a conexão com o WhatsApp. Se aparecer um QR, escaneie de novo.');
  }
  const r = ehObj(cfg.robo) ? cfg.robo : {};
  const p = ehObj(r.pausa_envio_seg) ? r.pausa_envio_seg : {};
  return {
    ok: true,
    config_resumo: {
      ia_ligada: !!cfg.ia_ligada, modo: cfg.modo === 'automatico' ? 'automatico' : 'sugerir',
      pausa_envio_seg: { min: Number(p.min ?? 3), max: Number(p.max ?? 9) },
      max_envios_por_minuto: Number(r.max_envios_por_minuto ?? 8),
      intervalo_pendentes_seg: 15, intervalo_pulso_seg: 60,
    },
  };
}

/* ---------------- mensagem ---------------- */
async function insereSaida(c: Ctx, cfg: Cfg, tel: string, clienteId: string | null, texto: string, origem: string,
  sugerir: boolean, extra: Linha = {}, atraso = true): Promise<Linha> {
  return await c.tab.ins('mensagens', {
    telefone: tel, cliente_id: clienteId, direcao: 'saida', texto, origem,
    status: sugerir ? 'sugerida' : 'aprovada',
    enviar_apos: sugerir ? null : (atraso ? isoMais(c, atrasoSeg(c, cfg)) : c.nowIso),
    ...extra,
  });
}
function posProcessa(cfg: Cfg, texto: string): string {
  let t = String(texto || '').trim();
  if (cfg.usar_emojis === false) t = removeEmojis(t).replace(/[ \t]+\n/g, '\n').trim();
  const ass = String(cfg.assinatura || '').trim();
  if (ass && t) t = t + '\n' + ass;
  return t;
}
async function substituiSaidasIA(c: Ctx, tel: string, motivo: string): Promise<void> {
  await c.tab.upd('mensagens', { telefone: tel, direcao: 'saida', origem: 'ia', status: { in: ['sugerida', 'aprovada'] } },
    { status: 'ignorada', motivo });
}

async function rotaMensagem(c: Ctx, b: Linha) {
  const tel = normalizaTelefone(b.telefone);
  const texto = String(b.texto == null ? '' : b.texto).slice(0, 4000);
  const idw = b.id_whatsapp ? String(b.id_whatsapp) : null;
  if (!tel) throw new ErroHttp(400, 'telefone inválido');
  const deMim = b.de_mim === true;
  const tsMs = Number(b.ts) > 0 ? Number(b.ts) : c.agoraMs;

  // 2. duplicada
  if (idw && (await c.tab.sel('mensagens', { id_whatsapp: idw })).length) return { ok: true, resultado: 'duplicada' };

  // 1. não individual
  if (!jidIndividual(b.jid)) {
    try {
      await c.tab.ins('mensagens', { telefone: tel, direcao: deMim ? 'saida' : 'entrada', texto, status: 'ignorada',
        origem: deMim ? 'dono' : 'cliente', id_whatsapp: idw, motivo: 'não é conversa individual' });
    } catch (e) { if (ehUnico(e)) return { ok: true, resultado: 'duplicada' }; throw e; }
    return { ok: true, resultado: 'ignorada', motivo: 'não é conversa individual' };
  }

  const db = await carregaDb(c.tab, c.agora);
  const cfg = db.cfg;
  let cliente = acharCliente(db, tel);

  // 3. contato
  const contatoAntes = (await c.tab.sel('contatos', { telefone: tel }))[0] || null;
  const contato: Linha = {
    telefone: tel,
    jid: b.jid ? String(b.jid) : (contatoAntes && contatoAntes.jid) || null,
    nome_contato: !deMim && b.nome_contato ? String(b.nome_contato).slice(0, 120) : (contatoAntes && contatoAntes.nome_contato) || '',
    cliente_id: cliente ? cliente.id : (contatoAntes && contatoAntes.cliente_id) || null,
    ultima_msg_em: c.nowIso,
    nao_lidas: ((contatoAntes && Number(contatoAntes.nao_lidas)) || 0) + (deMim ? 0 : 1),
  };
  await c.tab.ups('contatos', contato, 'telefone');
  const clienteId = cliente ? cliente.id : null;

  // 4. de_mim
  if (deMim) {
    try {
      await c.tab.ins('mensagens', { telefone: tel, cliente_id: clienteId, direcao: 'saida', texto, status: 'enviada', origem: 'dono',
        id_whatsapp: idw, enviada_em: new Date(tsMs).toISOString() });
    } catch (e) { if (ehUnico(e)) return { ok: true, resultado: 'duplicada' }; throw e; }
    const pmin = Number(cfg.pausa_quando_dono_responde_min);
    if (pmin > 0) {
      const ate = new Date(c.agoraMs + pmin * 60000).toISOString();
      const atual = contatoAntes && contatoAntes.pausado_ate ? Date.parse(contatoAntes.pausado_ate) : 0;
      if (!(atual > Date.parse(ate))) await c.tab.upd('contatos', { telefone: tel }, { pausado_ate: ate, motivo_pausa: 'dono respondeu' });
    }
    await substituiSaidasIA(c, tel, 'dono respondeu');
    return { ok: true, resultado: 'registrada' };
  }

  // 5. entrada
  let entrada: Linha;
  try {
    entrada = await c.tab.ins('mensagens', { telefone: tel, cliente_id: clienteId, direcao: 'entrada', texto, status: 'recebida',
      origem: 'cliente', id_whatsapp: idw });
  } catch (e) { if (ehUnico(e)) return { ok: true, resultado: 'duplicada' }; throw e; }
  const sugerir = cfg.modo !== 'automatico';

  // 6. resposta de confirmação
  const ignorado = (cliente && cliente.ignorar) ||
    (Array.isArray(cfg.ignorados) && cfg.ignorados.some((t: unknown) => chaveTelefone(t) === chaveTelefone(tel)));
  const pausado = !!(contatoAntes && contatoAntes.pausado_ate && Date.parse(contatoAntes.pausado_ate) > c.agoraMs);
  if (cfg.ia_ligada && cfg.confirmacao_auto && cliente && !ignorado && !pausado) {
    const r = await tentaConfirmacao(c, db, cliente, tel, texto, entrada, sugerir);
    if (r) return r;
  }

  // 7. decidir
  const umaHora = new Date(c.agoraMs - 3600000).toISOString();
  const saidasIa = await c.tab.sel('mensagens', { telefone: tel, direcao: 'saida', origem: 'ia',
    status: { in: ['sugerida', 'aprovada', 'enviando', 'enviada'] }, criada_em: { gte: umaHora } });
  const avisosLim = await c.tab.sel('avisos', { tipo: 'limite', telefone: tel, criado_em: { gte: umaHora } });
  const dec = decidir({
    cfg, agora: c.agora, cliente,
    contato: { telefone: tel, pausado_ate: contatoAntes && contatoAntes.pausado_ate, boas_vindas_em: contatoAntes && contatoAntes.boas_vindas_em,
      fora_horario_em: contatoAntes && contatoAntes.fora_horario_em },
    texto, saidasIaUltimaHora: saidasIa.length, ehPrimeiraMensagem: !contatoAntes, avisouLimite: avisosLim.length > 0,
  });
  if (dec.aviso) await aviso(c, dec.aviso.tipo, dec.aviso.texto, tel);
  if (dec.tipo === 'ignorar') {
    await c.tab.upd('mensagens', { id: entrada.id }, { motivo: dec.motivo });
    return { ok: true, resultado: 'ignorada', motivo: dec.motivo };
  }
  if (dec.tipo === 'texto') {
    const extraContato: Linha = {};
    if (dec.pausar_min && dec.pausar_min > 0) {
      extraContato.pausado_ate = new Date(c.agoraMs + dec.pausar_min * 60000).toISOString();
      extraContato.motivo_pausa = dec.motivo;
    }
    if (dec.motivo === 'fora do horário') extraContato.fora_horario_em = c.nowIso;
    if (Object.keys(extraContato).length) await c.tab.upd('contatos', { telefone: tel }, extraContato);
    await substituiSaidasIA(c, tel, 'substituída');
    await insereSaida(c, cfg, tel, clienteId, posProcessa(cfg, dec.texto || ''), 'ia', sugerir, { responde_a: entrada.id, motivo: dec.motivo });
    if (sugerir && notifica(cfg, 'sugestao_nova')) await aviso(c, 'sugestao_nova', 'Resposta sugerida para ' + nomeDe(cliente, contato) + '.', tel);
    return { ok: true, resultado: sugerir ? 'sugerida' : 'respondida', motivo: dec.motivo };
  }

  // 8. IA
  if (!cliente && cfg.cadastrar_desconhecidos !== false) {
    cliente = await cadastra(c, tel, String(contato.nome_contato || ''));
    if (cliente) {
      db.clientes.push(cliente);
      await c.tab.upd('contatos', { telefone: tel }, { cliente_id: cliente.id });
      await c.tab.upd('mensagens', { id: entrada.id }, { cliente_id: cliente.id });
    }
  }
  const cid = cliente ? cliente.id : null;
  const system = montaPrompt(db, cliente, c.agora);
  const contents = montaContents(await historico(c, cfg, tel, entrada.id), texto);
  let saidaTexto: string;
  try {
    const chaves = await carregaChaves(c.tab);
    saidaTexto = (await c.deps.ia(cfg, chaves, system, contents)).texto;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await c.tab.upd('mensagens', { id: entrada.id }, { erro: msg.slice(0, 500), motivo: 'erro da IA' });
    if (notifica(cfg, 'erro_ia')) await aviso(c, 'erro_ia', 'A IA não conseguiu responder ' + nomeDe(cliente, contato) + ': ' + msg, tel);
    return { ok: true, resultado: 'ignorada', motivo: 'erro da IA' };
  }

  // 9. JSON
  const out = extraiJSON(saidaTexto);
  let forcaSugerida = false;
  const avisos: { tipo: string; texto: string }[] = [];
  if (out.precisa_dono) {
    forcaSugerida = true;
    avisos.push({ tipo: 'precisa_dono', texto: 'A IA pediu sua ajuda na conversa com ' + nomeDe(cliente, contato) + '.' });
  }

  // 10. ação
  const acao: Acao = out.acao || { tipo: 'nenhuma' };
  let acaoStatus: string | null = null, acaoErro: string | null = null;
  if (acao.tipo !== 'nenhuma') {
    const v = validaAcao(db, acao, cid, c.agora, true);
    if (!sugerir) {
      const ef = v.ok ? efeitosDaAcao(db, acao, cid, c.agora, true) : { ok: false, erro: v.erro, efeitos: [] };
      const ap = ef.ok ? await aplicaEfeitos(c.tab, ef.efeitos) : { ok: false, erro: ef.erro };
      if (ap.ok) {
        acaoStatus = 'aplicada';
        const tipoAviso = acao.tipo === 'reservar_avulso' ? 'nova_reserva' : acao.tipo === 'cancelar' ? 'cancelamento' : acao.tipo === 'nao_vem' ? 'nao_vem' : '';
        if (tipoAviso && notifica(cfg, tipoAviso)) avisos.push({ tipo: tipoAviso, texto: 'A IA fez: ' + descreveAcao(acao) + ' para ' + nomeDe(cliente, contato) + '.' });
      } else {
        acaoStatus = 'recusada'; acaoErro = ap.erro || 'ação inválida';
        forcaSugerida = true;
        avisos.push({ tipo: 'acao_recusada', texto: 'A IA quis ' + descreveAcao(acao) + ' para ' + nomeDe(cliente, contato) + ', mas não deu: ' + acaoErro + ' Revise a resposta.' });
      }
    } else {
      acaoStatus = 'pendente';
      if (!v.ok) acaoErro = v.erro || null;
    }
  }

  // 11. texto
  const textoFinal = posProcessa(cfg, out.resposta);
  if (!textoFinal) {
    await c.tab.upd('mensagens', { id: entrada.id }, { motivo: 'IA sem resposta' });
    for (const a of avisos) await aviso(c, a.tipo, a.texto, tel);
    return { ok: true, resultado: 'ignorada', motivo: 'IA sem resposta' };
  }

  // 12. agrupa
  await substituiSaidasIA(c, tel, 'substituída');

  // boas-vindas (uma vez)
  const vaiSugerir = sugerir || forcaSugerida;
  if (dec.boas_vindas) {
    await insereSaida(c, cfg, tel, cid, posProcessa(cfg, dec.boas_vindas), 'ia', vaiSugerir, { responde_a: entrada.id, motivo: 'boas-vindas' }, false);
    await c.tab.upd('contatos', { telefone: tel }, { boas_vindas_em: c.nowIso });
  }

  // 13. saída
  await insereSaida(c, cfg, tel, cid, textoFinal, 'ia', vaiSugerir, {
    responde_a: entrada.id, acao: acao.tipo !== 'nenhuma' ? acao : null, acao_status: acaoStatus, acao_erro: acaoErro,
  });
  if (vaiSugerir && notifica(cfg, 'sugestao_nova') && !forcaSugerida) avisos.push({ tipo: 'sugestao_nova', texto: 'Resposta sugerida para ' + nomeDe(cliente, contato) + '.' });
  for (const a of avisos) await aviso(c, a.tipo, a.texto, tel);
  return { ok: true, resultado: vaiSugerir ? 'sugerida' : 'respondida' };
}

function nomeDe(cliente: Cliente | null, contato: Linha): string {
  return (cliente && cliente.nome) || contato.nome_contato || contato.telefone;
}
function descreveAcao(a: Acao): string {
  const n: Record<string, string> = { reservar_avulso: 'reservar', cancelar: 'cancelar', confirmar: 'confirmar', nao_vem: 'marcar "não vem"' };
  return (n[a.tipo] || a.tipo) + ' ' + (a.data || '') + ' ' + (a.hora != null ? a.hora + 'h' : '') + ' campo ' + (a.campo ?? '');
}

async function cadastra(c: Ctx, tel: string, nome: string): Promise<Cliente | null> {
  try {
    const l = await c.tab.ins('clientes', { nome, telefone: tel, tipo: 'avulso', origem: 'ia' });
    return { id: String(l.id), nome: l.nome || '', telefone: tel, tipo: 'avulso', ignorar: false, fixos: [] };
  } catch (e) {
    if (!ehUnico(e)) throw e;
    const l = (await c.tab.sel('clientes', { telefone: tel }))[0];
    return l ? { id: String(l.id), nome: l.nome || '', telefone: tel, tipo: l.tipo === 'fixo' ? 'fixo' : 'avulso', ignorar: !!l.ignorar, fixos: [] } : null;
  }
}

async function historico(c: Ctx, cfg: Cfg, tel: string, semId: unknown): Promise<MsgHist[]> {
  const n = Number(ehObj(cfg.ia) ? cfg.ia.historico_msgs : 12) || 12;
  const ls = await c.tab.sel('mensagens', { telefone: tel, id: { neq: semId } }, { ordem: { col: 'id', asc: false }, limite: n * 3 });
  return ls
    .filter((m) => (m.direcao === 'entrada' && m.status !== 'ignorada') || (m.direcao === 'saida' && m.status === 'enviada'))
    .slice(0, n).reverse()
    .map((m) => ({ direcao: m.direcao, texto: String(m.texto || '') }));
}

async function tentaConfirmacao(c: Ctx, db: Db, cliente: Cliente, tel: string, texto: string, entrada: Linha, sugerir: boolean) {
  const datas = [c.agora.data, somaDias(c.agora.data, 1)];
  let alvo: { data: string; hora: number; campo: number } | null = null;
  for (const [k, v] of Object.entries(db.confirmacoes)) {
    if (!v || (v.status !== 'manha' && v.status !== 'tarde')) continue;
    const [data, h, cp] = k.split('|');
    if (datas.indexOf(data) < 0) continue;
    const hora = Number(h), campo = Number(cp);
    if (!cliente.fixos.some((f) => Number(f.hora) === hora && Number(f.campo) === campo)) continue;
    if (data === c.agora.data && hora <= c.agora.hora) continue;
    if (!alvo || data + String(hora).padStart(2, '0') < alvo.data + String(alvo.hora).padStart(2, '0')) alvo = { data, hora, campo };
  }
  if (!alvo) return null;
  const r = interpretaConfirmacao(texto);
  if (!r) return null;
  const acao: Acao = { tipo: r === 'sim' ? 'confirmar' : 'nao_vem', ...alvo };
  const ef = efeitosDaAcao(db, acao, cliente.id, c.agora, false);
  if (!ef.ok) return null;
  const ap = await aplicaEfeitos(c.tab, ef.efeitos);
  if (!ap.ok) return null;
  const cfg = db.cfg;
  const v = valoresModelo(db, cliente.nome, alvo.data, alvo.hora, alvo.campo);
  const modelos = ehObj(cfg.modelos) ? cfg.modelos : {};
  const tpl = r === 'sim' ? (modelos.confirmou || 'Show, {nome}! Confirmado amanhã às {hora}h no {campo}.')
    : (modelos.nao_vem || 'Tudo bem, {nome}! Liberamos o horário de amanhã. Até a próxima!');
  const txt = posProcessa(cfg, preencheModelo(tpl, v));
  await c.tab.upd('mensagens', { id: entrada.id }, { acao, acao_status: 'aplicada', motivo: 'resposta de confirmação' });
  await insereSaida(c, cfg, tel, cliente.id, txt, 'confirmacao', sugerir, { responde_a: entrada.id });
  const tipoAviso = r === 'sim' ? 'confirmacao' : 'nao_vem';
  if (r === 'sim' || notifica(cfg, 'nao_vem')) {
    await aviso(c, tipoAviso, (cliente.nome || tel) + (r === 'sim' ? ' confirmou ' : ' não vem ') + v.dia + ' às ' + alvo.hora + 'h no ' + v.campo + '.', tel);
  }
  return { ok: true, resultado: sugerir ? 'sugerida' : 'respondida', motivo: r === 'sim' ? 'confirmou' : 'não vem' };
}

/* ---------------- pendentes ---------------- */
async function rotaPendentes(c: Ctx) {
  const cfg = await cfgAtual(c.tab);
  if (cfg.ia_ligada && cfg.confirmacao_auto) {
    const db = await carregaDb(c.tab, c.agora);
    for (const it of gerarConfirmacoes(db, c.agora)) {
      const k = { data: it.data, hora: it.hora, campo: it.campo };
      if (it.etapa === 'liberar') {
        const u = await c.tab.upd('confirmacoes', { ...k, status: { in: ['manha', 'tarde'] } },
          { status: 'nao_vem', liberado_auto: true, atualizado_em: c.nowIso });
        if (!u.length) continue;
        await c.tab.ups('excecoes', { ...k, cliente_id: it.cliente_id }, 'data,hora,campo');
        if (notifica(cfg, 'nao_vem')) await aviso(c, 'nao_vem', it.texto, it.telefone);
        continue;
      }
      let pegou = false;
      if (it.etapa === 'manha') {
        try {
          await c.tab.ins('confirmacoes', { ...k, cliente_id: it.cliente_id, status: 'manha', manha_em: c.nowIso, atualizado_em: c.nowIso });
          pegou = true;
        } catch (e) {
          if (!ehUnico(e)) throw e;
          const u = await c.tab.upd('confirmacoes', { ...k, status: 'pendente', manha_em: null },
            { status: 'manha', manha_em: c.nowIso, cliente_id: it.cliente_id, atualizado_em: c.nowIso });
          pegou = u.length > 0;
        }
      } else {
        const u = await c.tab.upd('confirmacoes', { ...k, status: 'manha', tarde_em: null },
          { status: 'tarde', tarde_em: c.nowIso, atualizado_em: c.nowIso });
        pegou = u.length > 0;
      }
      if (pegou) {
        await c.tab.ins('mensagens', { telefone: normalizaTelefone(it.telefone), cliente_id: it.cliente_id, direcao: 'saida',
          texto: posProcessa(cfg, it.texto), status: 'aprovada', origem: 'confirmacao', enviar_apos: c.nowIso, motivo: 'confirmação ' + it.etapa });
      }
    }
  }
  // presas em "enviando" há mais de 5 min
  await c.tab.upd('mensagens', { direcao: 'saida', status: 'enviando', enviar_apos: { lt: new Date(c.agoraMs - 5 * 60000).toISOString() } },
    { status: 'erro', erro: 'sem confirmação de envio' });
  // IA desligada: nada automático sai (só o que o dono mandou)
  if (!cfg.ia_ligada) {
    await c.tab.upd('mensagens', { direcao: 'saida', status: 'aprovada', origem: { in: ['ia', 'confirmacao'] } },
      { status: 'ignorada', motivo: 'IA desligada' });
  }
  // pega até 10 (enviar_apos vira o momento da retirada, usado acima)
  const cand = await c.tab.sel('mensagens', { direcao: 'saida', status: 'aprovada', enviar_apos: { lte: c.nowIso } },
    { ordem: { col: 'enviar_apos', asc: true }, limite: 10 });
  const pegas: Linha[] = [];
  for (const m of cand) {
    const u = await c.tab.upd('mensagens', { id: m.id, status: 'aprovada' }, { status: 'enviando', enviar_apos: c.nowIso });
    if (u.length) pegas.push(u[0]);
  }
  const tels = Array.from(new Set(pegas.map((m) => m.telefone)));
  const contatos = tels.length ? await c.tab.sel('contatos', { telefone: { in: tels } }) : [];
  const jid: Record<string, string | null> = {};
  for (const x of contatos) jid[x.telefone] = x.jid || null;
  return { ok: true, mensagens: pegas.map((m) => ({ id: Number(m.id), telefone: m.telefone, jid: jid[m.telefone] ?? null, texto: m.texto })) };
}

/* ---------------- enviada ---------------- */
async function rotaEnviada(c: Ctx, b: Linha) {
  const id = Number(b.id);
  if (!Number.isInteger(id) || id <= 0) throw new ErroHttp(400, 'id inválido');
  const campos: Linha = b.ok === true
    ? { status: 'enviada', enviada_em: c.nowIso, erro: null }
    : { status: 'erro', erro: String(b.erro || 'falha no envio').slice(0, 500) };
  if (b.ok === true && b.id_whatsapp) campos.id_whatsapp = String(b.id_whatsapp);
  try {
    await c.tab.upd('mensagens', { id, direcao: 'saida' }, campos);
  } catch (e) {
    if (!ehUnico(e)) throw e;
    delete campos.id_whatsapp;
    await c.tab.upd('mensagens', { id, direcao: 'saida' }, campos);
  }
  return { ok: true };
}

/* ---------------- aprovar ---------------- */
async function rotaAprovar(c: Ctx, b: Linha) {
  const id = Number(b.mensagem_id);
  if (!Number.isInteger(id) || id <= 0) throw new ErroHttp(400, 'mensagem_id inválido');
  const m = (await c.tab.sel('mensagens', { id }))[0];
  if (!m || m.direcao !== 'saida') throw new ErroHttp(400, 'Mensagem não encontrada.');
  if (m.status !== 'sugerida' && m.status !== 'erro') throw new ErroHttp(400, 'Essa mensagem já foi tratada (' + m.status + ').');
  const campos: Linha = { status: 'aprovada', enviar_apos: c.nowIso, erro: null };
  if (typeof b.texto === 'string') {
    const t = b.texto.trim();
    if (!t) throw new ErroHttp(400, 'Texto vazio.');
    campos.texto = t.slice(0, 4000);
  }
  let acaoStatus: string | null = m.acao_status || null, acaoErro: string | null = null;
  const acao: Acao | null = ehObj(m.acao) ? (m.acao as Acao) : null;
  if (acao && acao.tipo !== 'nenhuma' && acaoStatus !== 'aplicada') {
    if (b.aplicar_acao === false) {
      acaoStatus = 'recusada'; acaoErro = 'O dono não aplicou a ação.';
    } else {
      const db = await carregaDb(c.tab, c.agora);
      const cid = m.cliente_id || (acharCliente(db, m.telefone) || { id: null }).id;
      const ef = efeitosDaAcao(db, acao, cid, c.agora, false);
      const ap = ef.ok ? await aplicaEfeitos(c.tab, ef.efeitos) : { ok: false, erro: ef.erro };
      acaoStatus = ap.ok ? 'aplicada' : 'recusada';
      acaoErro = ap.ok ? null : (ap.erro || 'ação inválida');
    }
    campos.acao_status = acaoStatus;
    campos.acao_erro = acaoErro;
  }
  await c.tab.upd('mensagens', { id }, campos);
  const r: Linha = { ok: true, acao_status: acaoStatus };
  if (acaoErro) r.acao_erro = acaoErro;
  return r;
}

/* ---------------- simular ---------------- */
async function rotaSimular(c: Ctx, b: Linha) {
  const texto = String(b.texto == null ? '' : b.texto).trim();
  if (!texto) throw new ErroHttp(400, 'Escreva uma mensagem de teste.');
  const db = await carregaDb(c.tab, c.agora);
  const tel = b.telefone ? normalizaTelefone(b.telefone) : '';
  const cliente = tel ? acharCliente(db, tel) : null;
  const contato = tel ? (await c.tab.sel('contatos', { telefone: tel }))[0] : null;
  const decisao = decidir({
    cfg: { ...db.cfg, ia_ligada: true }, agora: c.agora, cliente,
    contato: { telefone: tel || '0', pausado_ate: contato && contato.pausado_ate, boas_vindas_em: contato && contato.boas_vindas_em, fora_horario_em: contato && contato.fora_horario_em },
    texto, saidasIaUltimaHora: 0, ehPrimeiraMensagem: !contato,
  });
  const system = montaPrompt(db, cliente, c.agora);
  const contents = montaContents(tel ? await historico(c, db.cfg, tel, -1) : [], texto);
  const base = { ok: true, decisao, prompt_chars: system.length };
  let saida: string;
  try {
    saida = (await c.deps.ia(db.cfg, await carregaChaves(c.tab), system, contents)).texto;
  } catch (e) {
    return { ...base, ok: false, resposta: '', acao: { tipo: 'nenhuma' }, valida: false, erro: e instanceof Error ? e.message : String(e) };
  }
  const out = extraiJSON(saida);
  const v = validaAcao(db, out.acao, cliente ? cliente.id : null, c.agora, true);
  const r: Linha = { ...base, resposta: posProcessa(db.cfg, out.resposta), acao: out.acao, precisa_dono: out.precisa_dono, valida: v.ok };
  if (!v.ok) r.erro = v.erro;
  return r;
}

/* ---------------- entrada ---------------- */
export async function trata(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: CORS });
  if (req.method !== 'POST') return resposta(400, { ok: false, erro: 'Use POST.' });
  let b: Linha;
  try {
    b = await req.json();
  } catch {
    return resposta(400, { ok: false, erro: 'JSON inválido.' });
  }
  if (!ehObj(b) || typeof b.acao !== 'string') return resposta(400, { ok: false, erro: 'Falta "acao".' });
  const d = (deps.agora || (() => new Date()))();
  const c: Ctx = { deps, tab: deps.tab, agora: agoraSP(d), agoraMs: d.getTime(), nowIso: d.toISOString(), aleatorio: deps.aleatorio || Math.random };
  try {
    if (ROTAS_ROBO.indexOf(b.acao) >= 0) {
      await autenticaRobo(c, req);
      if (b.acao === 'pulso') return resposta(200, await rotaPulso(c, b));
      if (b.acao === 'mensagem') return resposta(200, await rotaMensagem(c, b));
      if (b.acao === 'pendentes') return resposta(200, await rotaPendentes(c));
      return resposta(200, await rotaEnviada(c, b));
    }
    if (ROTAS_APP.indexOf(b.acao) >= 0) {
      await autenticaDono(c, req);
      if (b.acao === 'aprovar') return resposta(200, await rotaAprovar(c, b));
      return resposta(200, await rotaSimular(c, b));
    }
    return resposta(400, { ok: false, erro: 'Ação desconhecida: ' + String(b.acao).slice(0, 40) });
  } catch (e) {
    if (e instanceof ErroHttp) return resposta(e.status, { ok: false, erro: e.message });
    console.error('[robo]', b.acao, e);
    return resposta(500, { ok: false, erro: 'Erro interno, tente de novo.' });
  }
}

/* ---------------- Deno ---------------- */
if (typeof Deno !== 'undefined' && Deno.serve) {
  const banco = await import('./banco.ts');
  const { chamarIA } = await import('./ia.ts');
  const sb = await banco.criaClienteSupabase();
  const deps: Deps = {
    tab: banco.criaTabelasSupabase(sb),
    usuarioDoToken: banco.criaUsuarioDoToken(sb),
    ia: (cfg, chaves, system, contents) => chamarIA(cfg, chaves, system, contents),
  };
  Deno.serve((req: Request) => trata(req, deps));
}
