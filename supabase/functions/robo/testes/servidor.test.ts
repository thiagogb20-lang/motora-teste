// Testes da orquestração (P1): trata() com banco em memória e IA falsa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trata, sha256hex } from '../index.ts';
import type { Deps } from '../index.ts';
import { aplicaEfeitos, carregaDb, CONFLITO } from '../banco.ts';
import type { Filtro, Linha, OpcoesSel, Tabelas } from '../banco.ts';
import { chamarIA } from '../ia.ts';
import { CFG_PADRAO } from './_dados.ts';

/* ---------- banco em memória ---------- */
const UNICOS: Record<string, string[][]> = {
  mensagens: [['id_whatsapp']], clientes: [['telefone']], reservas: [['data', 'hora', 'campo']],
  excecoes: [['data', 'hora', 'campo']], confirmacoes: [['data', 'hora', 'campo']], contatos: [['telefone']],
  robo: [['id']], config: [['id']], robo_codigos: [['hash']], horarios_fixos: [['dia', 'hora', 'campo']],
};
const PADROES: Record<string, () => Linha> = {
  mensagens: () => ({ cliente_id: null, acao: null, acao_status: null, acao_erro: null, motivo: null, responde_a: null,
    enviar_apos: null, enviada_em: null, erro: null, id_whatsapp: null, texto: '' }),
  contatos: () => ({ jid: null, nome_contato: '', cliente_id: null, pausado_ate: null, motivo_pausa: null, boas_vindas_em: null,
    fora_horario_em: null, ultima_msg_em: null, nao_lidas: 0 }),
  confirmacoes: () => ({ cliente_id: null, status: 'pendente', manha_em: null, tarde_em: null, respondido_em: null, liberado_auto: false }),
  clientes: () => ({ nome: '', telefone: '', tipo: 'avulso', observacao: '', ignorar: false, origem: 'dono' }),
  reservas: () => ({ pago: false, origem: 'dono' }),
  avisos: () => ({ lido: false, telefone: null }),
};
const COM_ID_NUM = ['mensagens', 'avisos', 'regras', 'horarios_fixos', 'excecoes', 'conversas_exemplo', 'robo_codigos'];
const COM_ID_TXT = ['clientes', 'reservas'];

function bate(l: Linha, f?: Filtro): boolean {
  for (const [k, v] of Object.entries(f || {})) {
    const x = l[k];
    if (v === null) { if (x != null) return false; continue; }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = v as Record<string, any>;
      if ('in' in o && !o.in.includes(x)) return false;
      if ('neq' in o && x === o.neq) return false;
      if ('lt' in o && !(x != null && x < o.lt)) return false;
      if ('lte' in o && !(x != null && x <= o.lte)) return false;
      if ('gt' in o && !(x != null && x > o.gt)) return false;
      if ('gte' in o && !(x != null && x >= o.gte)) return false;
      continue;
    }
    if (x !== v) return false;
  }
  return true;
}

class Memoria implements Tabelas {
  t: Record<string, Linha[]> = {};
  seq = 1;
  relogio: () => string;
  constructor(relogio: () => string) { this.relogio = relogio; }
  lista(n: string): Linha[] { return (this.t[n] = this.t[n] || []); }
  violou(n: string, l: Linha, ignorar?: Linha): boolean {
    for (const cols of UNICOS[n] || []) {
      if (cols.some((c) => l[c] == null || l[c] === '')) continue;
      if (this.lista(n).some((o) => o !== ignorar && cols.every((c) => o[c] === l[c]))) return true;
    }
    return false;
  }
  async sel(n: string, f?: Filtro, o?: OpcoesSel) {
    let r = this.lista(n).filter((l) => bate(l, f)).map((l) => structuredClone(l));
    if (o && o.ordem) { const { col, asc } = o.ordem; r.sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc === false ? -1 : 1)); }
    if (o && o.limite) r = r.slice(0, o.limite);
    return r;
  }
  async ins(n: string, linha: Linha) {
    const l: Linha = { ...(PADROES[n] ? PADROES[n]() : {}), ...structuredClone(linha) };
    if (l.id == null && COM_ID_NUM.includes(n)) l.id = this.seq++;
    if (l.id == null && COM_ID_TXT.includes(n)) l.id = 'id' + this.seq++;
    for (const c of ['criada_em', 'criado_em']) if (l[c] == null && (n === 'mensagens' ? c === 'criada_em' : c === 'criado_em')) l[c] = this.relogio();
    if (this.violou(n, l)) { const e: any = new Error('duplicate key'); e.code = '23505'; throw e; }
    this.lista(n).push(l);
    return structuredClone(l);
  }
  async upd(n: string, f: Filtro, campos: Linha) {
    const out: Linha[] = [];
    for (const l of this.lista(n)) {
      if (!bate(l, f)) continue;
      const novo = { ...l, ...structuredClone(campos) };
      if (this.violou(n, novo, l)) { const e: any = new Error('duplicate key'); e.code = '23505'; throw e; }
      Object.assign(l, novo);
      out.push(structuredClone(l));
    }
    return out;
  }
  async ups(n: string, linha: Linha, conflito: string) {
    const cols = conflito.split(',');
    const ex = this.lista(n).find((o) => cols.every((c) => o[c] === linha[c]));
    if (ex) Object.assign(ex, structuredClone(linha));
    else await this.ins(n, linha);
  }
  async del(n: string, f: Filtro) { this.t[n] = this.lista(n).filter((l) => !bate(l, f)); }
}

/* ---------- cenário ---------- */
const CODIGO = 'ABCD2345';
const TEL_ANA = '5511987654321', TEL_BETO = '5511912345678';

async function cenario(opts: { agora?: string; cfg?: Record<string, unknown>; ia?: Deps['ia'] } = {}) {
  let agoraIso = opts.agora || '2026-10-27T13:00:00.000Z'; // terça 10:00 em SP
  const mem = new Memoria(() => agoraIso);
  const cfg = { ...structuredClone(CFG_PADRAO), ia_ligada: true, ...(opts.cfg || {}) };
  mem.t.config = [{ id: 1, dados: cfg, gemini_key: 'chave-g', groq_key: '' }];
  mem.t.robo = [{ id: 1, online_em: null, conectado: false, qr: null, numero: null, versao: null }];
  mem.t.robo_codigos = [
    { id: 900, hash: await sha256hex(CODIGO), revogado: false, usado_em: null },
    { id: 901, hash: await sha256hex('VELHO234'), revogado: true, usado_em: null },
  ];
  mem.t.dono = [{ user_id: 'u-dono' }];
  mem.t.regras = [{ id: 1, texto: 'Domingo fechado.', ativa: true, ordem: 1 }];
  mem.t.clientes = [
    { id: 'ana', nome: 'Ana Souza', telefone: TEL_ANA, tipo: 'fixo', ignorar: false, origem: 'dono', observacao: '' },
    { id: 'beto', nome: 'Beto', telefone: TEL_BETO, tipo: 'avulso', ignorar: false, origem: 'dono', observacao: '' },
  ];
  mem.t.horarios_fixos = [{ id: 1, cliente_id: 'ana', dia: 3, hora: 20, campo: 1 }]; // quarta 20h
  mem.t.reservas = []; mem.t.excecoes = []; mem.t.confirmacoes = []; mem.t.conversas_exemplo = [];
  mem.t.contatos = []; mem.t.mensagens = []; mem.t.avisos = [];
  const chamadasIA: { system: string; contents: unknown[] }[] = [];
  const iaPadrao: Deps['ia'] = async (_cfg, _ch, system, contents) => {
    chamadasIA.push({ system, contents });
    return { texto: JSON.stringify({ resposta: 'Oi! Tem sim 😀', acao: { tipo: 'nenhuma' }, precisa_dono: false }) };
  };
  const deps: Deps = {
    tab: mem,
    usuarioDoToken: async (jwt) => (jwt === 'tok-dono' ? 'u-dono' : jwt === 'tok-outro' ? 'u-outro' : null),
    ia: opts.ia ? async (a, b, s, c) => { chamadasIA.push({ system: s, contents: c }); return opts.ia!(a, b, s, c); } : iaPadrao,
    agora: () => new Date(agoraIso),
    aleatorio: () => 0.5,
  };
  return { mem, deps, chamadasIA, avanca: (iso: string) => { agoraIso = iso; } };
}

function req(corpo: unknown, headers: Record<string, string> = { 'x-robo-codigo': CODIGO }, metodo = 'POST'): Request {
  return new Request('http://local/robo', { method: metodo, headers: { 'content-type': 'application/json', ...headers },
    body: metodo === 'POST' ? JSON.stringify(corpo) : undefined });
}
async function chama(deps: Deps, corpo: unknown, headers?: Record<string, string>) {
  const r = await trata(req(corpo, headers), deps);
  return { status: r.status, j: await r.json() as any, r };
}
function msg(extra: Record<string, unknown> = {}) {
  return { acao: 'mensagem', telefone: TEL_BETO, jid: TEL_BETO + '@s.whatsapp.net', nome_contato: 'Beto Zap', texto: 'Tem horário quarta?',
    id_whatsapp: 'W' + Math.random().toString(36).slice(2), de_mim: false, ts: Date.parse('2026-10-27T13:00:00Z'), ...extra };
}

/* ---------- autenticação ---------- */
test('OPTIONS responde CORS', async () => {
  const { deps } = await cenario();
  const r = await trata(new Request('http://local/robo', { method: 'OPTIONS' }), deps);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.match(r.headers.get('access-control-allow-headers') || '', /x-robo-codigo/);
});

test('401: rotas do robô sem código, com código errado ou revogado', async () => {
  const { deps, mem } = await cenario();
  for (const h of [{}, { 'x-robo-codigo': 'ZZZZ9999' }, { 'x-robo-codigo': 'VELHO234' }]) {
    const { status, j } = await chama(deps, { acao: 'pulso', conectado: true }, h);
    assert.equal(status, 401);
    assert.equal(j.ok, false);
    assert.equal(typeof j.erro, 'string');
  }
  assert.equal(mem.t.robo[0].online_em, null);
});

test('código aceita minúsculas/espaços e grava usado_em só no primeiro uso', async () => {
  const { deps, mem, avanca } = await cenario();
  const { status } = await chama(deps, { acao: 'pulso', conectado: true, qr: null, numero: '5511', versao: '1.0.0' }, { 'x-robo-codigo': ' abcd2345 ' });
  assert.equal(status, 200);
  const usado = mem.t.robo_codigos[0].usado_em;
  assert.ok(usado);
  avanca('2026-10-27T13:05:00.000Z');
  await chama(deps, { acao: 'pulso', conectado: true });
  assert.equal(mem.t.robo_codigos[0].usado_em, usado);
});

test('400: JSON inválido, sem acao, ação desconhecida', async () => {
  const { deps } = await cenario();
  const r = await trata(new Request('http://local/robo', { method: 'POST', body: '{x' }), deps);
  assert.equal(r.status, 400);
  assert.equal((await chama(deps, { foo: 1 })).status, 400);
  assert.equal((await chama(deps, { acao: 'xyz' })).status, 400);
});

test('aprovar e simular sem ser dono dão 401', async () => {
  const { deps } = await cenario();
  for (const acao of ['aprovar', 'simular']) {
    assert.equal((await chama(deps, { acao, mensagem_id: 1, texto: 'oi' }, {})).status, 401);
    assert.equal((await chama(deps, { acao, mensagem_id: 1, texto: 'oi' }, { authorization: 'Bearer invalido' })).status, 401);
    const o = await chama(deps, { acao, mensagem_id: 1, texto: 'oi' }, { authorization: 'Bearer tok-outro' });
    assert.equal(o.status, 401);
    assert.match(o.j.erro, /não é a do dono/);
    // o código do robô não serve para rota do app
    assert.equal((await chama(deps, { acao, mensagem_id: 1, texto: 'oi' }, { 'x-robo-codigo': CODIGO })).status, 401);
  }
});

/* ---------- pulso ---------- */
test('pulso grava robo e devolve config_resumo; queda cria aviso robo_offline', async () => {
  const { deps, mem } = await cenario();
  const a = await chama(deps, { acao: 'pulso', conectado: true, qr: null, numero: '5511999', versao: '1.0.0' });
  assert.equal(a.status, 200);
  assert.deepEqual(a.j.config_resumo, { ia_ligada: true, modo: 'sugerir', pausa_envio_seg: { min: 3, max: 9 },
    max_envios_por_minuto: 8, intervalo_pendentes_seg: 15, intervalo_pulso_seg: 60 });
  assert.equal(mem.t.robo[0].online_em, '2026-10-27T13:00:00.000Z');
  assert.equal(mem.t.robo[0].conectado, true);
  assert.equal(mem.t.robo[0].numero, '5511999');
  await chama(deps, { acao: 'pulso', conectado: false, qr: 'data:qr', numero: null, versao: '1.0.0' });
  assert.equal(mem.t.robo[0].qr, 'data:qr');
  assert.equal(mem.t.avisos.filter((x) => x.tipo === 'robo_offline').length, 1);
  await chama(deps, { acao: 'pulso', conectado: false, qr: 'data:qr' });
  assert.equal(mem.t.avisos.filter((x) => x.tipo === 'robo_offline').length, 1, 'não repete o aviso');
});

/* ---------- mensagem ---------- */
test('mensagem duplicada (mesmo id_whatsapp) não cria nada novo', async () => {
  const { deps, mem } = await cenario();
  const m = msg({ id_whatsapp: 'ABC1' });
  assert.equal((await chama(deps, m)).j.resultado, 'sugerida');
  const n = mem.t.mensagens.length;
  const d = await chama(deps, m);
  assert.equal(d.status, 200);
  assert.equal(d.j.resultado, 'duplicada');
  assert.equal(mem.t.mensagens.length, n);
});

test('mensagem de grupo é registrada como ignorada', async () => {
  const { deps, mem, chamadasIA } = await cenario();
  const r = await chama(deps, msg({ jid: '123@g.us' }));
  assert.equal(r.j.resultado, 'ignorada');
  assert.equal(mem.t.mensagens[0].status, 'ignorada');
  assert.equal(chamadasIA.length, 0);
});

test('modo sugerir: IA responde como sugerida, contato atualizado, aviso sugestao_nova, prompt sem chaves', async () => {
  const { deps, mem, chamadasIA } = await cenario();
  const r = await chama(deps, msg({ telefone: '11912345678' })); // sem 55: normaliza
  assert.equal(r.j.resultado, 'sugerida');
  const ent = mem.t.mensagens.find((m) => m.direcao === 'entrada')!;
  const sai = mem.t.mensagens.find((m) => m.direcao === 'saida')!;
  assert.equal(ent.status, 'recebida');
  assert.equal(ent.cliente_id, 'beto');
  assert.equal(sai.status, 'sugerida');
  assert.equal(sai.origem, 'ia');
  assert.equal(sai.responde_a, ent.id);
  assert.equal(sai.texto, 'Oi! Tem sim 😀');
  const ct = mem.t.contatos[0];
  assert.equal(ct.telefone, TEL_BETO);
  assert.equal(ct.nao_lidas, 1);
  assert.equal(ct.nome_contato, 'Beto Zap');
  assert.ok(mem.t.avisos.some((a) => a.tipo === 'sugestao_nova'));
  assert.equal(chamadasIA.length, 1);
  assert.ok(!chamadasIA[0].system.includes('chave-g'));
  assert.match(chamadasIA[0].system, /Domingo fechado/);
});

test('modo automático: aprovada com atraso, emojis removidos e assinatura; agrupa saídas anteriores', async () => {
  const { deps, mem } = await cenario({ cfg: { modo: 'automatico', usar_emojis: false, assinatura: '— Campos', atraso_resposta_seg: { min: 10, max: 20 } } });
  await chama(deps, msg());
  const r = await chama(deps, msg({ texto: 'e quinta?' }));
  assert.equal(r.j.resultado, 'respondida');
  const saidas = mem.t.mensagens.filter((m) => m.direcao === 'saida');
  assert.equal(saidas.length, 2);
  assert.equal(saidas[0].status, 'ignorada');
  assert.equal(saidas[0].motivo, 'substituída');
  assert.equal(saidas[1].status, 'aprovada');
  assert.equal(saidas[1].enviar_apos, '2026-10-27T13:00:15.000Z');
  assert.equal(saidas[1].texto, 'Oi! Tem sim\n— Campos');
  assert.equal(mem.t.contatos[0].nao_lidas, 2);
});

test('de_mim: registra saída do dono, pausa o contato e descarta sugestões da IA', async () => {
  const { deps, mem, chamadasIA } = await cenario();
  await chama(deps, msg());
  const r = await chama(deps, msg({ de_mim: true, texto: 'Oi Beto, tem sim', id_whatsapp: 'EU1', nome_contato: 'Dono' }));
  assert.equal(r.j.resultado, 'registrada');
  const dono = mem.t.mensagens.find((m) => m.id_whatsapp === 'EU1')!;
  assert.equal(dono.direcao, 'saida');
  assert.equal(dono.origem, 'dono');
  assert.equal(dono.status, 'enviada');
  assert.equal(dono.enviada_em, '2026-10-27T13:00:00.000Z');
  const ia = mem.t.mensagens.find((m) => m.origem === 'ia')!;
  assert.equal(ia.status, 'ignorada');
  assert.equal(ia.motivo, 'dono respondeu');
  const ct = mem.t.contatos[0];
  assert.equal(ct.pausado_ate, '2026-10-27T13:30:00.000Z');
  assert.equal(ct.motivo_pausa, 'dono respondeu');
  assert.equal(ct.nome_contato, 'Beto Zap', 'de_mim não troca o nome do contato');
  // próxima mensagem do cliente: pausado → ignora sem chamar IA
  const n = chamadasIA.length;
  const p = await chama(deps, msg({ texto: 'valeu' }));
  assert.equal(p.j.resultado, 'ignorada');
  assert.equal(p.j.motivo, 'pausado');
  assert.equal(chamadasIA.length, n);
});

test('IA desligada: entrada registrada e ignorada', async () => {
  const { deps, mem, chamadasIA } = await cenario({ cfg: { ia_ligada: false } });
  const r = await chama(deps, msg());
  assert.deepEqual(r.j, { ok: true, resultado: 'ignorada', motivo: 'IA desligada' });
  assert.equal(mem.t.mensagens.length, 1);
  assert.equal(chamadasIA.length, 0);
});

test('falar com o dono: mensagem fixa, pausa e aviso', async () => {
  const { deps, mem, chamadasIA } = await cenario({ cfg: { nome_dono: 'Zé' } });
  const r = await chama(deps, msg({ texto: 'quero falar com o DONO' }));
  assert.equal(r.j.resultado, 'sugerida');
  assert.equal(chamadasIA.length, 0);
  const sai = mem.t.mensagens.find((m) => m.direcao === 'saida')!;
  assert.match(sai.texto, /Zé/);
  assert.ok(mem.t.contatos[0].pausado_ate > '2026-10-27T16:59');
  assert.ok(mem.t.avisos.some((a) => a.tipo === 'falar_com_dono'));
});

test('desconhecido é cadastrado como avulso origem ia; boas-vindas sai uma vez', async () => {
  const { deps, mem } = await cenario({ cfg: { boas_vindas_desconhecidos: 'Bem-vindo aos Campos!' } });
  await chama(deps, msg({ telefone: '5521988887777', jid: '5521988887777@s.whatsapp.net', nome_contato: 'Novo' }));
  const c = mem.t.clientes.find((x) => x.telefone === '5521988887777')!;
  assert.equal(c.origem, 'ia');
  assert.equal(c.tipo, 'avulso');
  assert.equal(c.nome, 'Novo');
  const saidas = mem.t.mensagens.filter((m) => m.direcao === 'saida');
  assert.deepEqual(saidas.map((s) => s.texto), ['Bem-vindo aos Campos!', 'Oi! Tem sim 😀']);
  assert.ok(mem.t.contatos.find((x) => x.telefone === '5521988887777')!.boas_vindas_em);
  await chama(deps, msg({ telefone: '5521988887777', jid: '5521988887777@s.whatsapp.net', texto: 'oi de novo' }));
  assert.equal(mem.t.mensagens.filter((m) => m.texto === 'Bem-vindo aos Campos!').length, 1);
});

test('IA falha: entrada recebe erro e aviso erro_ia', async () => {
  const { deps, mem } = await cenario({ ia: async () => { throw new Error('Gemini: limite grátis atingido.'); } });
  const r = await chama(deps, msg());
  assert.equal(r.j.resultado, 'ignorada');
  const ent = mem.t.mensagens[0];
  assert.match(ent.erro, /limite/);
  assert.ok(mem.t.avisos.some((a) => a.tipo === 'erro_ia'));
  assert.equal(mem.t.mensagens.filter((m) => m.direcao === 'saida').length, 0);
});

test('automático + reservar permitido: aplica a reserva; recusada vira sugerida', async () => {
  const resp = (acao: unknown) => async () => ({ texto: JSON.stringify({ resposta: 'Reservado!', acao, precisa_dono: false }) });
  // quarta 28/10 21h campo 2 está livre
  const a = await cenario({ cfg: { modo: 'automatico', permitir_ia_reservar: true }, ia: resp({ tipo: 'reservar_avulso', data: '2026-10-28', hora: 21, campo: 2 }) });
  const r1 = await chama(a.deps, msg());
  assert.equal(r1.j.resultado, 'respondida');
  assert.equal(a.mem.t.reservas.length, 1);
  assert.equal(a.mem.t.reservas[0].cliente_id, 'beto');
  assert.equal(a.mem.t.reservas[0].origem, 'ia');
  const s1 = a.mem.t.mensagens.find((m) => m.direcao === 'saida')!;
  assert.equal(s1.acao_status, 'aplicada');
  assert.equal(s1.status, 'aprovada');
  assert.ok(a.mem.t.avisos.some((x) => x.tipo === 'nova_reserva'));
  // fixo da Ana (quarta 20h campo 1): inválida
  const b = await cenario({ cfg: { modo: 'automatico', permitir_ia_reservar: true }, ia: resp({ tipo: 'reservar_avulso', data: '2026-10-28', hora: 20, campo: 1 }) });
  const r2 = await chama(b.deps, msg());
  assert.equal(r2.j.resultado, 'sugerida');
  const s2 = b.mem.t.mensagens.find((m) => m.direcao === 'saida')!;
  assert.equal(s2.status, 'sugerida');
  assert.equal(s2.acao_status, 'recusada');
  assert.match(s2.acao_erro, /fixo/);
  assert.equal(b.mem.t.reservas.length, 0);
});

test('precisa_dono força sugerida mesmo no automático', async () => {
  const { deps, mem } = await cenario({ cfg: { modo: 'automatico' }, ia: async () => ({ texto: '{"resposta":"Vou ver com o dono","acao":{"tipo":"nenhuma"},"precisa_dono":true}' }) });
  const r = await chama(deps, msg());
  assert.equal(r.j.resultado, 'sugerida');
  assert.ok(mem.t.avisos.some((a) => a.tipo === 'precisa_dono'));
});

test('resposta de confirmação "sim" confirma o fixo sem chamar a IA', async () => {
  const { deps, mem, chamadasIA } = await cenario({ cfg: { confirmacao_auto: true, modo: 'automatico' } });
  mem.t.confirmacoes.push({ data: '2026-10-28', hora: 20, campo: 1, cliente_id: 'ana', status: 'manha', manha_em: '2026-10-27T12:00:00.000Z', tarde_em: null });
  const r = await chama(deps, msg({ telefone: '551187654321', jid: '551187654321@s.whatsapp.net', texto: 'Sim, confirmado 👍' })); // sem o 9
  assert.equal(r.j.resultado, 'respondida');
  assert.equal(chamadasIA.length, 0);
  assert.equal(mem.t.confirmacoes[0].status, 'confirmado');
  const sai = mem.t.mensagens.find((m) => m.direcao === 'saida')!;
  assert.equal(sai.origem, 'confirmacao');
  assert.match(sai.texto, /Ana/);
});

/* ---------- pendentes / enviada ---------- */
test('pendentes: aprovada vencida vira enviando (com jid), futura fica; enviando velha vira erro', async () => {
  const { deps, mem } = await cenario();
  mem.t.contatos.push({ telefone: TEL_BETO, jid: TEL_BETO + '@s.whatsapp.net', nao_lidas: 0 });
  await mem.ins('mensagens', { telefone: TEL_BETO, direcao: 'saida', texto: 'já', status: 'aprovada', origem: 'dono', enviar_apos: '2026-10-27T12:59:00.000Z' });
  await mem.ins('mensagens', { telefone: TEL_ANA, direcao: 'saida', texto: 'depois', status: 'aprovada', origem: 'ia', enviar_apos: '2026-10-27T13:10:00.000Z' });
  await mem.ins('mensagens', { telefone: TEL_ANA, direcao: 'saida', texto: 'presa', status: 'enviando', origem: 'ia', enviar_apos: '2026-10-27T12:50:00.000Z' });
  await mem.ins('mensagens', { telefone: TEL_ANA, direcao: 'saida', texto: 'sug', status: 'sugerida', origem: 'ia' });
  const r = await chama(deps, { acao: 'pendentes' });
  assert.equal(r.status, 200);
  assert.equal(r.j.mensagens.length, 1);
  assert.deepEqual(r.j.mensagens[0], { id: mem.t.mensagens[0].id, telefone: TEL_BETO, jid: TEL_BETO + '@s.whatsapp.net', texto: 'já' });
  assert.deepEqual(mem.t.mensagens.map((m) => m.status), ['enviando', 'aprovada', 'erro', 'sugerida']);
  assert.equal(mem.t.mensagens[2].erro, 'sem confirmação de envio');
  // segunda chamada não devolve de novo
  assert.equal((await chama(deps, { acao: 'pendentes' })).j.mensagens.length, 0);
});

test('pendentes limita a 10 por vez, na ordem de enviar_apos', async () => {
  const { deps, mem } = await cenario();
  for (let i = 0; i < 12; i++) await mem.ins('mensagens', { telefone: TEL_BETO, direcao: 'saida', texto: 'm' + i, status: 'aprovada', origem: 'dono',
    enviar_apos: new Date(Date.parse('2026-10-27T12:00:00Z') + (12 - i) * 1000).toISOString() });
  const r = await chama(deps, { acao: 'pendentes' });
  assert.equal(r.j.mensagens.length, 10);
  assert.equal(r.j.mensagens[0].texto, 'm11');
  assert.equal(r.j.mensagens[0].jid, null);
});

test('pendentes com confirmação automática gera a mensagem da manhã uma vez só', async () => {
  const { deps, mem } = await cenario({ cfg: { confirmacao_auto: true } }); // terça 10:00 → quarta 20h da Ana
  const r = await chama(deps, { acao: 'pendentes' });
  assert.equal(r.j.mensagens.length, 1);
  assert.equal(r.j.mensagens[0].telefone, TEL_ANA);
  assert.match(r.j.mensagens[0].texto, /Bom dia Ana/);
  assert.equal(mem.t.confirmacoes[0].status, 'manha');
  assert.equal(mem.t.mensagens[0].origem, 'confirmacao');
  assert.equal((await chama(deps, { acao: 'pendentes' })).j.mensagens.length, 0);
  assert.equal(mem.t.mensagens.length, 1);
});

test('enviada: ok grava enviada_em e id_whatsapp (dedupe do eco); erro grava erro', async () => {
  const { deps, mem } = await cenario();
  const a = await mem.ins('mensagens', { telefone: TEL_BETO, direcao: 'saida', texto: 'x', status: 'enviando', origem: 'ia' });
  const b = await mem.ins('mensagens', { telefone: TEL_BETO, direcao: 'saida', texto: 'y', status: 'enviando', origem: 'ia' });
  assert.deepEqual((await chama(deps, { acao: 'enviada', id: a.id, ok: true, id_whatsapp: 'WA9' })).j, { ok: true });
  await chama(deps, { acao: 'enviada', id: b.id, ok: false, erro: 'número sem WhatsApp' });
  const [x, y] = mem.t.mensagens;
  assert.equal(x.status, 'enviada');
  assert.equal(x.enviada_em, '2026-10-27T13:00:00.000Z');
  assert.equal(x.id_whatsapp, 'WA9');
  assert.equal(y.status, 'erro');
  assert.equal(y.erro, 'número sem WhatsApp');
  // eco da mensagem enviada pelo robô volta como de_mim → duplicada
  assert.equal((await chama(deps, msg({ de_mim: true, id_whatsapp: 'WA9' }))).j.resultado, 'duplicada');
  assert.equal((await chama(deps, { acao: 'enviada', id: 'x', ok: true })).status, 400);
});

/* ---------- aprovar / simular ---------- */
test('aprovar (dono): aplica ação pendente, edita texto e põe aprovada', async () => {
  const { deps, mem } = await cenario({ cfg: { permitir_ia_reservar: false } });
  const s = await mem.ins('mensagens', { telefone: TEL_BETO, cliente_id: 'beto', direcao: 'saida', texto: 'vou anotar', status: 'sugerida', origem: 'ia',
    acao: { tipo: 'reservar_avulso', data: '2026-10-28', hora: 21, campo: 2 }, acao_status: 'pendente' });
  const r = await chama(deps, { acao: 'aprovar', mensagem_id: s.id, texto: 'Reservado, Beto!' }, { authorization: 'Bearer tok-dono' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.j, { ok: true, acao_status: 'aplicada' });
  const m = mem.t.mensagens[0];
  assert.equal(m.status, 'aprovada');
  assert.equal(m.texto, 'Reservado, Beto!');
  assert.equal(m.enviar_apos, '2026-10-27T13:00:00.000Z');
  assert.equal(mem.t.reservas.length, 1);
  assert.equal(mem.t.reservas[0].origem, 'dono');
  // de novo: já tratada
  assert.equal((await chama(deps, { acao: 'aprovar', mensagem_id: s.id }, { authorization: 'Bearer tok-dono' })).status, 400);
});

test('aprovar com ação inválida devolve recusada e ainda envia; aplicar_acao=false não aplica', async () => {
  const { deps, mem } = await cenario();
  const s = await mem.ins('mensagens', { telefone: TEL_BETO, cliente_id: 'beto', direcao: 'saida', texto: 't', status: 'sugerida', origem: 'ia',
    acao: { tipo: 'reservar_avulso', data: '2026-10-28', hora: 20, campo: 1 }, acao_status: 'pendente' });
  const r = await chama(deps, { acao: 'aprovar', mensagem_id: s.id }, { authorization: 'Bearer tok-dono' });
  assert.equal(r.j.acao_status, 'recusada');
  assert.match(r.j.acao_erro, /fixo/);
  assert.equal(mem.t.mensagens[0].status, 'aprovada');
  const s2 = await mem.ins('mensagens', { telefone: TEL_BETO, cliente_id: 'beto', direcao: 'saida', texto: 't', status: 'sugerida', origem: 'ia',
    acao: { tipo: 'reservar_avulso', data: '2026-10-28', hora: 21, campo: 2 }, acao_status: 'pendente' });
  const r2 = await chama(deps, { acao: 'aprovar', mensagem_id: s2.id, aplicar_acao: false }, { authorization: 'Bearer tok-dono' });
  assert.equal(r2.j.acao_status, 'recusada');
  assert.equal(mem.t.reservas.length, 0);
});

test('simular (dono) não grava nada', async () => {
  const { deps, mem } = await cenario({ ia: async () => ({ texto: '{"resposta":"Tem 21h","acao":{"tipo":"reservar_avulso","data":"2026-10-28","hora":21,"campo":2}}' }) });
  const antes = JSON.stringify(mem.t);
  const r = await chama(deps, { acao: 'simular', texto: 'tem quarta?', telefone: TEL_BETO }, { authorization: 'Bearer tok-dono' });
  assert.equal(r.status, 200);
  assert.equal(r.j.ok, true);
  assert.equal(r.j.resposta, 'Tem 21h');
  assert.equal(r.j.acao.tipo, 'reservar_avulso');
  assert.equal(r.j.valida, false); // permitir_ia_reservar=false no padrão
  assert.equal(typeof r.j.prompt_chars, 'number');
  assert.equal(r.j.decisao.tipo, 'ia');
  assert.equal(JSON.stringify(mem.t), antes);
});

/* ---------- banco / ia ---------- */
test('carregaDb monta o Db do contrato; aplicaEfeitos traduz conflito único', async () => {
  const { mem } = await cenario();
  mem.t.confirmacoes.push({ data: '2026-10-28', hora: 20, campo: 1, cliente_id: 'ana', status: 'manha', manha_em: 'X', tarde_em: null });
  const db = await carregaDb(mem);
  assert.equal(db.cfg.nome_negocio, 'Campos de Futebol');
  assert.deepEqual(db.clientes[0].fixos, [{ dia: 3, hora: 20, campo: 1 }]);
  assert.deepEqual(db.confirmacoes['2026-10-28|20|1'], { status: 'manha', manhaEm: 'X', tardeEm: null });
  assert.equal(JSON.stringify(db).includes('chave-g'), false);
  const ef = [{ op: 'insert' as const, tabela: 'reservas', linha: { data: '2026-10-28', hora: 21, campo: 2, cliente_id: 'beto' } }];
  assert.deepEqual(await aplicaEfeitos(mem, ef), { ok: true });
  const r = await aplicaEfeitos(mem, ef);
  assert.equal(r.ok, false);
  assert.match(r.erro!, /ocupado/);
  assert.equal(CONFLITO.confirmacoes, 'data,hora,campo');
});

test('chamarIA: Gemini falha (429) → cai no Groq; timeout; sem chave', async () => {
  const cfg = structuredClone(CFG_PADRAO);
  const urls: string[] = [];
  const f429 = async (url: string) => {
    urls.push(url);
    if (url.includes('generativelanguage')) return { ok: false, status: 429, text: async () => '{}' };
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '{"resposta":"oi"}' } }] }) };
  };
  const r = await chamarIA(cfg, { gemini: 'g', groq: 'q' }, 'sys', [{ role: 'user', parts: [{ text: 'oi' }] }], f429);
  assert.equal(r.provedor, 'groq');
  assert.equal(r.texto, '{"resposta":"oi"}');
  assert.match(r.erros[0], /limite/);
  assert.equal(urls.length, 2);
  // reserva desligada
  await assert.rejects(chamarIA({ ...cfg, ia: { ...cfg.ia, usar_reserva_groq: false } }, { gemini: 'g', groq: 'q' }, 's', [], f429), /limite/);
  // timeout
  const lento = (_u: string, init: any) => new Promise<any>((_, rej) => { init.signal.addEventListener('abort', () => rej(new Error('abortado'))); });
  await assert.rejects(chamarIA({ ...cfg, ia: { ...cfg.ia, timeout_seg: 0.05 } }, { gemini: 'g', groq: '' }, 's', [], lento), /tempo|passou/);
  // gemini ok
  const ok = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"resposta":"g"}' }] } }] }) });
  assert.equal((await chamarIA(cfg, { gemini: 'g', groq: '' }, 's', [], ok)).provedor, 'gemini');
  await assert.rejects(chamarIA(cfg, { gemini: '', groq: '' }, 's', [], ok), /sem chave/);
});

/* ---------- IA desligada para tudo ---------- */
test('IA desligada: não responde confirmação, não gera confirmações e segura saídas automáticas', async () => {
  const { deps, mem, chamadasIA } = await cenario({ cfg: { ia_ligada: false, confirmacao_auto: true, modo: 'automatico' } });
  mem.t.confirmacoes.push({ data: '2026-10-28', hora: 20, campo: 1, cliente_id: 'ana', status: 'manha', manha_em: '2026-10-27T12:00:00.000Z', tarde_em: null });
  const r = await chama(deps, msg({ telefone: TEL_ANA, jid: TEL_ANA + '@s.whatsapp.net', texto: 'sim' }));
  assert.equal(r.j.resultado, 'ignorada');
  assert.equal(mem.t.confirmacoes[0].status, 'manha');
  assert.equal(chamadasIA.length, 0);
  mem.t.confirmacoes = [];
  await mem.ins('mensagens', { telefone: TEL_BETO, direcao: 'saida', texto: 'ia', status: 'aprovada', origem: 'ia', enviar_apos: '2026-10-27T12:00:00.000Z' });
  await mem.ins('mensagens', { telefone: TEL_BETO, direcao: 'saida', texto: 'conf', status: 'aprovada', origem: 'confirmacao', enviar_apos: '2026-10-27T12:00:00.000Z' });
  await mem.ins('mensagens', { telefone: TEL_BETO, direcao: 'saida', texto: 'dono', status: 'aprovada', origem: 'dono', enviar_apos: '2026-10-27T12:00:00.000Z' });
  const p = await chama(deps, { acao: 'pendentes' });
  assert.deepEqual(p.j.mensagens.map((m: any) => m.texto), ['dono']);
  assert.equal(mem.t.confirmacoes.length, 0, 'não gerou confirmação da manhã');
  const ia = mem.t.mensagens.filter((m) => m.origem === 'ia' || m.origem === 'confirmacao');
  assert.ok(ia.every((m) => m.status === 'ignorada' && m.motivo === 'IA desligada'));
});

test('confirmação automática não responde contato pausado nem ignorado', async () => {
  for (const extra of [{ pausa: true }, { ignorado: true }]) {
    const { deps, mem } = await cenario({ cfg: { confirmacao_auto: true, modo: 'automatico', ignorados: extra.ignorado ? [TEL_ANA] : [] } });
    mem.t.confirmacoes.push({ data: '2026-10-28', hora: 20, campo: 1, cliente_id: 'ana', status: 'manha', manha_em: '2026-10-27T12:00:00.000Z', tarde_em: null });
    if (extra.pausa) mem.t.contatos.push({ telefone: TEL_ANA, jid: null, nao_lidas: 0, pausado_ate: '2026-10-27T15:00:00.000Z' });
    const r = await chama(deps, msg({ telefone: TEL_ANA, jid: TEL_ANA + '@s.whatsapp.net', texto: 'sim' }));
    assert.equal(r.j.resultado, 'ignorada');
    assert.equal(mem.t.confirmacoes[0].status, 'manha');
  }
});

test('erro interno devolve 500 com texto genérico', async () => {
  const { deps } = await cenario();
  const quebrado = { ...deps, tab: { ...deps.tab, sel: async () => { throw new Error('segredo do banco'); } } as any };
  const orig = console.error; console.error = () => {};
  try {
    const r = await chama(quebrado, { acao: 'pulso', conectado: true });
    assert.equal(r.status, 500);
    assert.deepEqual(r.j, { ok: false, erro: 'Erro interno, tente de novo.' });
  } finally { console.error = orig; }
});
