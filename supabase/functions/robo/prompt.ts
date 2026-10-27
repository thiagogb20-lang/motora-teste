// prompt.ts — monta o prompt e as requisições das IAs; lê a resposta (puro).
import type { Acao, Agora, Cfg, Cliente, Db } from './nucleo.ts';
import {
  DIAS_LONGO, TIPOS_ACAO, cortaConversa, diaSemana, ehObj, formataDataBR, formataReais, listaCampos,
  livresProximosDias, nomeCampo, nomeDia, precoDe, somaDias, statusDe, temExcecao,
} from './nucleo.ts';

export type Content = { role: 'user' | 'model'; parts: { text: string }[] };
export type MsgHist = { direcao: 'entrada' | 'saida'; texto: string };
export type Req = { url: string; init: { method: 'POST'; headers: Record<string, string>; body: string } };
export type SaidaIA = { resposta: string; acao: Acao; precisa_dono: boolean };

const ORDEM_DIAS = [1, 2, 3, 4, 5, 6, 0];

function gradeDe(cfg: Cfg, d: number): number[] {
  return ((ehObj(cfg.grade) ? cfg.grade[d] : null) || []).map(Number).sort((a: number, b: number) => a - b);
}

function linhasPreco(db: Db): string[] {
  const cfg = db.cfg, L: string[] = [], hoje = '2026-01-04'; // um domingo qualquer, só para achar o dia da semana
  let algum = false;
  for (const d of ORDEM_DIAS) {
    const g = gradeDe(cfg, d);
    if (!g.length) continue;
    const data = somaDias(hoje, d);
    const partes: string[] = [];
    for (const h of g) {
      const porCampo = listaCampos(cfg).map((c) => {
        const a = precoDe(cfg, data, h, c, 'avulso'), f = precoDe(cfg, data, h, c, 'fixo');
        return (a == null ? '?' : formataReais(a)) + '/' + (f == null ? '?' : formataReais(f));
      });
      if (porCampo.some((x) => x !== '?/?')) algum = true;
      const iguais = porCampo.every((x) => x === porCampo[0]);
      partes.push(h + 'h ' + (iguais ? porCampo[0] : porCampo.map((x, i) => 'campo ' + listaCampos(cfg)[i] + ' ' + x).join(', ')));
    }
    L.push('- ' + DIAS_LONGO[d] + ': ' + partes.join('; '));
  }
  return algum ? L : [];
}

export function montaPrompt(db: Db, cliente: Cliente | null, agora: Agora): string {
  const cfg = db.cfg, L: string[] = [];
  const negocio = cfg.nome_negocio || 'Campos de Futebol';
  const emojis = cfg.usar_emojis !== false;

  // 1. papel
  L.push('Você é o atendente de WhatsApp de "' + negocio + '"' + (cfg.nome_dono ? ', falando em nome de ' + cfg.nome_dono : '') + '.');
  L.push('Responda em português do Brasil. Tom: ' + (cfg.tom_de_voz || 'simpático, curto e direto') + '. ' +
    (emojis ? 'Pode usar emojis com moderação.' : 'NÃO use emojis.'));
  // 2. data
  L.push('Hoje é ' + DIAS_LONGO[agora.dia] + ', ' + formataDataBR(agora.data) + ' (' + agora.data + '), ' + agora.hhmm + '.');
  // 3. regras do dono
  const regras = (db.regras || []).filter((r) => r.ativa).sort((a, b) => a.ordem - b.ordem);
  L.push('\nREGRAS DO DONO (valem mais que tudo, exceto o FORMATO da resposta):');
  if (regras.length) regras.forEach((r, i) => L.push((i + 1) + '. ' + r.texto));
  else L.push('- (nenhuma regra extra)');
  // 4. endereço
  if (cfg.endereco || cfg.link_mapa) {
    L.push('\nENDEREÇO: ' + (cfg.endereco || '(não informado)') + (cfg.link_mapa ? ' | Mapa: ' + cfg.link_mapa : ''));
  }
  // 5. preços
  const pr = ehObj(cfg.precos) ? cfg.precos : {};
  const lp = linhasPreco(db);
  L.push('\nPREÇOS (avulso/fixo, por hora):');
  if (lp.length) { lp.forEach((x) => L.push(x)); L.push('"?" = não informado: NUNCA invente preço; diga que vai confirmar o valor.'); }
  else L.push('- não informado. NUNCA invente preço; diga que vai confirmar o valor.');
  if (pr.observacao) L.push('Obs.: ' + pr.observacao);
  // 6. pagamento
  const pg = ehObj(cfg.pagamento) ? cfg.pagamento : {};
  if (pg.texto || pg.pix_chave || pg.sinal_obrigatorio) {
    L.push('\nPAGAMENTO: ' + [pg.texto, pg.pix_chave ? 'Chave Pix: ' + pg.pix_chave : '',
      pg.sinal_obrigatorio ? 'Sinal obrigatório' + (pg.sinal_valor != null ? ' de ' + formataReais(Number(pg.sinal_valor)) : '') : '']
      .filter(Boolean).join(' | '));
  }
  // 7. campos e grade
  L.push('\nCAMPOS: ' + listaCampos(cfg).map((c) => c + ' = ' + nomeCampo(cfg, c)).join('; '));
  L.push('GRADE (horários de início, cada jogo dura ' + (cfg.duracao_min || 60) + ' min):');
  for (const d of ORDEM_DIAS) {
    const g = gradeDe(cfg, d);
    L.push('- ' + DIAS_LONGO[d] + ': ' + (g.length ? g.map((h) => h + 'h').join(', ') : 'fechado'));
  }
  // 8. livres
  const n = Number(cfg.dias_livres_no_prompt) > 0 ? Number(cfg.dias_livres_no_prompt) : 7;
  const porData: Record<string, string[]> = {};
  for (const l of livresProximosDias(db, n, agora)) (porData[l.data] = porData[l.data] || []).push(l.hora + 'h campo ' + l.campo);
  L.push('\nHORÁRIOS LIVRES NOS PRÓXIMOS ' + n + ' DIAS (só estes podem ser oferecidos a avulsos):');
  const ds = Object.keys(porData);
  if (!ds.length) L.push('- nenhum horário livre');
  ds.forEach((d) => L.push('- ' + nomeDia(d) + ' ' + formataDataBR(d) + ' (' + d + '): ' + porData[d].join(', ')));
  // 9. o que a IA pode fazer
  const auto = cfg.modo === 'automatico';
  L.push('\nO QUE VOCÊ PODE FAZER:');
  L.push('- Reservar horário avulso: ' + (cfg.permitir_ia_reservar
    ? 'sim, só horários da lista de livres, com no mínimo ' + (cfg.antecedencia_minima_reserva_h ?? 0) + 'h de antecedência e até ' + (cfg.max_dias_reserva_frente ?? 14) + ' dias para frente.'
    : 'não. Anote o pedido e diga que o dono vai confirmar.'));
  L.push('- Cancelar reserva avulsa do cliente: ' + (cfg.permitir_ia_cancelar
    ? 'sim, com no mínimo ' + (cfg.cancelamento_regra_h ?? 0) + 'h de antecedência.'
    : 'não. Diga que vai passar para o dono.'));
  L.push('- Confirmar presença ou avisar "não vem" no horário fixo do cliente: ' + (cfg.permitir_ia_confirmar ? 'sim.' : 'não. Diga que vai passar para o dono.'));
  if (auto) L.push('Quando a ação for permitida e estiver correta, pode dizer que está reservado/confirmado. Se não for permitida, diga "vou anotar e confirmar".');
  else L.push('Nunca diga que algo foi reservado com certeza: diga "vou anotar e confirmar". O dono revisa antes.');
  // 10. cliente
  L.push('\nCLIENTE DESTA CONVERSA:');
  if (cliente) {
    L.push('- Nome: ' + (cliente.nome || '(sem nome)') + ' | tipo: ' + (cliente.tipo === 'fixo' ? 'fixo' : 'avulso'));
    if (cliente.tipo === 'fixo' && cliente.fixos && cliente.fixos.length) {
      L.push('- Horários fixos: ' + cliente.fixos.map((f) => DIAS_LONGO[f.dia] + ' ' + f.hora + 'h ' + nomeCampo(cfg, f.campo)).join('; '));
      for (let i = 0; i < 7; i++) {
        const d = somaDias(agora.data, i);
        for (const f of cliente.fixos) {
          if (Number(f.dia) !== diaSemana(d)) continue;
          if (i === 0 && Number(f.hora) <= agora.hora) continue;
          const st = temExcecao(db, d, f.hora, f.campo, cliente.id) ? 'nao_vem' : statusDe(db, d, f.hora, f.campo);
          L.push('  • ' + nomeDia(d) + ' ' + formataDataBR(d) + ' (' + d + ') ' + f.hora + 'h campo ' + f.campo + ': status ' + st);
        }
      }
    }
    const futuras = db.reservas.filter((r) => r.clienteId === cliente.id && r.data >= agora.data);
    if (futuras.length) L.push('- Reservas avulsas: ' + futuras.map((r) => r.data + ' ' + r.hora + 'h campo ' + r.campo + (r.pago ? ' (pago)' : ' (a pagar)')).join('; '));
  } else {
    L.push('- Contato novo, ainda não cadastrado.');
  }
  // 11. exemplos
  const conv = db.exemplos || [];
  const max = Number(cfg.ia && cfg.ia.exemplos_chars) > 0 ? Number(cfg.ia.exemplos_chars) : 6000;
  if (conv.length) {
    const cota = Math.floor(max / conv.length);
    let ex = '';
    conv.forEach((c) => { ex += '\n--- ' + (c.nomeArquivo || 'conversa') + ' ---\n' + cortaConversa(c.texto, cota); });
    L.push('\nEXEMPLOS DE CONVERSAS ANTIGAS DO DONO (imite o jeito de falar, não copie dados):' + cortaConversa(ex, max));
  }
  // 12. formato
  L.push('\nFORMATO: responda SOMENTE com um JSON válido, sem texto fora dele:');
  L.push('{"resposta":"texto para o cliente","acao":{"tipo":"nenhuma|reservar_avulso|nao_vem|confirmar|cancelar","data":"AAAA-MM-DD","hora":20,"campo":1},"precisa_dono":false}');
  L.push('Use "reservar_avulso" só se o cliente pediu claramente e o horário está na lista de livres. Use "confirmar" ou "nao_vem" para o horário fixo do cliente. Use "cancelar" para uma reserva avulsa dele. Em dúvida, use "nenhuma" e pergunte.');
  L.push('Use "precisa_dono": true quando não souber responder, quando o cliente reclamar ou pedir algo fora das regras.');
  return L.join('\n');
}

/** Histórico (mais antigo primeiro) + mensagem nova -> contents do Gemini (alternando user/model, começando por user). */
export function montaContents(historico: MsgHist[], msgNova: string): Content[] {
  const out: Content[] = [];
  for (const m of historico || []) {
    const role = m.direcao === 'saida' ? 'model' : 'user', t = String(m.texto || '');
    if (!t) continue;
    if (!out.length && role === 'model') continue;
    const ult = out[out.length - 1];
    if (ult && ult.role === role) ult.parts[0].text += '\n' + t;
    else out.push({ role, parts: [{ text: t }] });
  }
  const u = out[out.length - 1];
  const nova = String(msgNova == null ? '' : msgNova);
  if (u && u.role === 'user') { if (nova) u.parts[0].text += '\n' + nova; }
  else out.push({ role: 'user', parts: [{ text: nova }] });
  return out;
}

export function contentsParaMessages(system: string, contents: Content[]): { role: string; content: string }[] {
  return [{ role: 'system', content: system }].concat(contents.map((c) => ({
    role: c.role === 'model' ? 'assistant' : 'user', content: c.parts.map((p) => p.text).join('\n'),
  })));
}

function iaCfg(cfg: Cfg): { temperatura: number; max_tokens: number } {
  const ia = ehObj(cfg && cfg.ia) ? cfg.ia : {};
  return {
    temperatura: typeof ia.temperatura === 'number' ? ia.temperatura : 0.4,
    max_tokens: Number(ia.max_tokens) > 0 ? Number(ia.max_tokens) : 600,
  };
}

export function montaReqGemini(modelo: string, chaveApi: string, system: string, contents: Content[], cfg: Cfg = {}): Req {
  const p = iaCfg(cfg);
  return {
    url: 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(modelo) + ':generateContent',
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chaveApi },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] }, contents,
        generationConfig: { temperature: p.temperatura, maxOutputTokens: p.max_tokens, responseMimeType: 'application/json' },
      }),
    },
  };
}

export function montaReqGroq(modelo: string, chaveApi: string, system: string, contents: Content[], cfg: Cfg = {}): Req {
  const p = iaCfg(cfg);
  return {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + chaveApi },
      body: JSON.stringify({
        model: modelo, messages: contentsParaMessages(system, contents),
        response_format: { type: 'json_object' }, temperature: p.temperatura, max_tokens: p.max_tokens,
      }),
    },
  };
}

export function textoGemini(j: any): string {
  try { return (j.candidates[0].content.parts || []).map((p: any) => p.text || '').join(''); } catch { return ''; }
}
export function textoGroq(j: any): string {
  try { return j.choices[0].message.content || ''; } catch { return ''; }
}

export function extraiJSON(texto: unknown): SaidaIA {
  const t = String(texto == null ? '' : texto).trim();
  let obj: Record<string, any> | null = null;
  const tentativas = [t, t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()];
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) tentativas.push(t.slice(a, b + 1));
  for (const x of tentativas) {
    if (obj) break;
    try { const o = JSON.parse(x); if (ehObj(o)) obj = o; } catch { /* tenta a próxima */ }
  }
  if (!obj || typeof obj.resposta !== 'string') return { resposta: t, acao: { tipo: 'nenhuma' }, precisa_dono: false };
  let ac: Acao = ehObj(obj.acao) ? (obj.acao as Acao) : { tipo: 'nenhuma' };
  if (TIPOS_ACAO.indexOf(ac.tipo) < 0) ac = { tipo: 'nenhuma' };
  if (ac.tipo !== 'nenhuma') ac = { tipo: ac.tipo, data: ac.data, hora: Number(ac.hora), campo: Number(ac.campo) };
  else ac = { tipo: 'nenhuma' };
  const pd = obj.precisa_dono === true || obj.precisa_dono === 'true';
  return { resposta: obj.resposta, acao: ac, precisa_dono: pd };
}
