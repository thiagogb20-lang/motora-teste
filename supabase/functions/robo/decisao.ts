// decisao.ts — decide o que fazer com uma mensagem recebida (puro).
import type { Agora, Cfg, Cliente } from './nucleo.ts';
import { chaveTelefone, dentroDoHorarioIA, ehObj, minutosDesde, normalizaTexto, preencheModelo } from './nucleo.ts';

export type ContatoCtx = {
  telefone: string;
  pausado_ate?: string | null;
  boas_vindas_em?: string | null;
  fora_horario_em?: string | null;
};
export type DecisaoCtx = {
  cfg: Cfg;
  agora: Agora;
  cliente: Cliente | null;
  contato: ContatoCtx;
  texto: string;
  saidasIaUltimaHora: number;
  ehPrimeiraMensagem: boolean;
  /** opcional: true se o dono já foi avisado do limite nesta hora (evita aviso repetido). */
  avisouLimite?: boolean;
};
export type Aviso = { tipo: string; texto: string };
export type Decisao = {
  tipo: 'ignorar' | 'texto' | 'ia';
  motivo: string;
  texto?: string;
  pausar_min?: number;
  aviso?: Aviso;
  boas_vindas?: string;
};

function notifica(cfg: Cfg, chave: string): boolean {
  const n = ehObj(cfg.notificar_dono) ? cfg.notificar_dono : {};
  return n[chave] !== false;
}

function nomeContato(ctx: DecisaoCtx): string {
  return (ctx.cliente && ctx.cliente.nome) || ctx.contato.telefone;
}

export function decidir(ctx: DecisaoCtx): Decisao {
  const { cfg, agora, cliente, contato } = ctx;
  const texto = String(ctx.texto == null ? '' : ctx.texto);

  // 1. IA desligada
  if (!cfg.ia_ligada) return { tipo: 'ignorar', motivo: 'IA desligada' };
  // 2. texto vazio
  if (!texto.trim()) return { tipo: 'ignorar', motivo: 'texto vazio' };
  // 3. ignorados
  const k = chaveTelefone(contato.telefone);
  const ign = Array.isArray(cfg.ignorados) ? cfg.ignorados : [];
  if ((cliente && cliente.ignorar) || ign.some((t: unknown) => chaveTelefone(t) === k)) {
    return { tipo: 'ignorar', motivo: 'contato ignorado' };
  }
  // 4. só cadastrados
  if (cfg.atender === 'so_cadastrados' && !cliente) return { tipo: 'ignorar', motivo: 'não cadastrado' };
  // 5. pausado
  if (contato.pausado_ate) {
    const t = Date.parse(contato.pausado_ate);
    if (!isNaN(t) && t > Date.parse(agora.iso)) return { tipo: 'ignorar', motivo: 'pausado' };
  }
  // 6. falar com o dono
  const fd = ehObj(cfg.falar_com_dono) ? cfg.falar_com_dono : {};
  const palavras: unknown[] = Array.isArray(fd.palavras) ? fd.palavras : [];
  const tn = normalizaTexto(texto);
  if (palavras.some((p) => { const pn = normalizaTexto(p).trim(); return pn !== '' && tn.indexOf(pn) >= 0; })) {
    const d: Decisao = {
      tipo: 'texto', motivo: 'falar com o dono',
      texto: preencheModelo(fd.mensagem || 'Certo! Vou chamar o {dono}, ele já te responde.', {
        dono: cfg.nome_dono || 'dono', nome: cliente ? cliente.nome : '',
      }),
      pausar_min: Number(fd.pausa_min) > 0 ? Number(fd.pausa_min) : 0,
    };
    if (notifica(cfg, 'falar_com_dono')) d.aviso = { tipo: 'falar_com_dono', texto: nomeContato(ctx) + ' quer falar com você: "' + texto.slice(0, 200) + '"' };
    return d;
  }
  // 7. fora do horário da IA
  if (!dentroDoHorarioIA(cfg, agora)) {
    const msg = String(cfg.mensagem_fora_do_horario || '').trim();
    if (msg && minutosDesde(agora, contato.fora_horario_em) > 12 * 60) {
      return { tipo: 'texto', motivo: 'fora do horário', texto: preencheModelo(msg, { dono: cfg.nome_dono || '', nome: cliente ? cliente.nome : '', endereco: cfg.endereco || '' }) };
    }
    return { tipo: 'ignorar', motivo: 'fora do horário' };
  }
  // 8. limite por contato/hora
  const lim = Number(cfg.limite_respostas_por_contato_hora);
  if (lim > 0 && ctx.saidasIaUltimaHora >= lim) {
    const d: Decisao = { tipo: 'ignorar', motivo: 'limite' };
    if (!ctx.avisouLimite) d.aviso = { tipo: 'limite', texto: nomeContato(ctx) + ' passou do limite de ' + lim + ' respostas da IA por hora. A IA parou de responder.' };
    return d;
  }
  // 9. IA
  const d: Decisao = { tipo: 'ia', motivo: 'ia' };
  const bv = String(cfg.boas_vindas_desconhecidos || '').trim();
  if (ctx.ehPrimeiraMensagem && bv && !contato.boas_vindas_em) {
    d.boas_vindas = preencheModelo(bv, { dono: cfg.nome_dono || '', nome: cliente ? cliente.nome : '', endereco: cfg.endereco || '' });
  }
  return d;
}
