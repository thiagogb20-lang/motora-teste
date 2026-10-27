// nucleo.ts — port puro do <script id="core"> do app (sem IO, sem rede, sem Deno.*).
// Datas: strings "AAAA-MM-DD" no fuso America/Sao_Paulo; contas com Date.UTC.

export type Agora = { data: string; hora: number; minuto: number; hhmm: string; dia: number; iso: string };
export type Cfg = Record<string, any>;
export type Fixo = { dia: number; hora: number; campo: number };
export type Cliente = {
  id: string; nome: string; telefone: string; tipo: 'fixo' | 'avulso'; ignorar: boolean; fixos: Fixo[];
};
export type Reserva = { id: string; data: string; hora: number; campo: number; clienteId: string; pago: boolean };
export type Excecao = { data: string; hora: number; campo: number; clienteId: string };
export type Db = {
  cfg: Cfg;
  regras: { texto: string; ativa: boolean; ordem: number }[];
  clientes: Cliente[];
  reservas: Reserva[];
  excecoes: Excecao[];
  confirmacoes: Record<string, { status: string; manhaEm?: string | null; tardeEm?: string | null }>;
  exemplos: { nomeArquivo: string; texto: string }[];
};
export type TipoAcao = 'nenhuma' | 'reservar_avulso' | 'nao_vem' | 'confirmar' | 'cancelar';
export type Acao = { tipo: TipoAcao; data?: string; hora?: number; campo?: number };
export type Efeito = {
  op: 'insert' | 'upsert' | 'delete' | 'update'; tabela: string;
  linha?: Record<string, unknown>; filtro?: Record<string, unknown>;
};
export type Ocupante =
  | { tipo: 'avulso'; reserva: Reserva; cliente: Cliente | null }
  | { tipo: 'fixo'; cliente: Cliente; status: string }
  | { tipo: 'livre'; naoVem?: Cliente };

export const DIAS_CURTO = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const DIAS_LONGO = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
export const TIPOS_ACAO: TipoAcao[] = ['nenhuma', 'reservar_avulso', 'nao_vem', 'confirmar', 'cancelar'];

export function ehObj(o: unknown): o is Record<string, any> {
  return o !== null && typeof o === 'object' && !Array.isArray(o);
}
export function p2(n: number): string { return (n < 10 ? '0' : '') + n; }

/* ---------- Tempo ---------- */
const FMT_SP = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function agoraSP(d: Date): Agora {
  const p: Record<string, string> = {};
  for (const x of FMT_SP.formatToParts(d)) p[x.type] = x.value;
  const data = p.year + '-' + p.month + '-' + p.day;
  const hora = Number(p.hour) % 24, minuto = Number(p.minute);
  return { data, hora, minuto, hhmm: p2(hora) + ':' + p2(minuto), dia: diaSemana(data), iso: d.toISOString() };
}

function partes(s: string): [number, number, number] {
  const a = String(s).split('-').map(Number);
  return [a[0], a[1], a[2]];
}
function utc(s: string, h = 0, m = 0): number { const [y, mo, d] = partes(s); return Date.UTC(y, mo - 1, d, h, m); }
function dataDeUTC(ms: number): string {
  const d = new Date(ms);
  return d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate());
}
export function dataValida(s: unknown): boolean {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return dataDeUTC(utc(s)) === s;
}
export function somaDias(s: string, n: number): string { const [y, m, d] = partes(s); return dataDeUTC(Date.UTC(y, m - 1, d + n)); }
export function diaSemana(s: string): number { return new Date(utc(s)).getUTCDay(); }
export function nomeDia(s: string): string { return DIAS_CURTO[diaSemana(s)]; }
export function formataDataBR(s: string): string { const a = String(s).split('-'); return a[2] + '/' + a[1]; }
/** Minutos (relógio de SP) de agora até data às hora:00. Negativo se já passou. */
export function minutosAte(agora: Agora, data: string, hora: number): number {
  return (utc(data, Number(hora)) - utc(agora.data, agora.hora, agora.minuto)) / 60000;
}
/** Minutos decorridos entre um ISO e agora (Infinity se ausente/ inválido). */
export function minutosDesde(agora: Agora, iso: string | null | undefined): number {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  if (isNaN(t)) return Infinity;
  return (Date.parse(agora.iso) - t) / 60000;
}
function hhmmMin(s: unknown): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s == null ? '' : s).trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
/** Compara "HH:MM" (agora.hhmm) >= limite. Limite inválido => false. */
export function hhmmMaiorIgual(hhmm: string, limite: unknown): boolean {
  const a = hhmmMin(hhmm), b = hhmmMin(limite);
  return a != null && b != null && a >= b;
}

/* ---------- Agenda ---------- */
export function chave(data: string, hora: number, campo: number): string { return data + '|' + Number(hora) + '|' + Number(campo); }
export function nomeCampo(cfg: Cfg, campo: number): string { return (cfg.campos && cfg.campos[campo]) || ('Campo ' + campo); }
export function listaCampos(cfg: Cfg): number[] {
  return Object.keys(cfg.campos || { 1: 1, 2: 2 }).map(Number).sort((a, b) => a - b);
}
export function horariosDoDia(db: Db, data: string): number[] {
  const g = (db.cfg.grade || {})[diaSemana(data)] || [];
  return (g as unknown[]).map(Number).sort((a, b) => a - b);
}
export function clientePorId(db: Db, id: string | null | undefined): Cliente | null {
  return db.clientes.find((c) => c.id === id) || null;
}
export function fixoDe(db: Db, data: string, hora: number, campo: number): Cliente | null {
  const dia = diaSemana(data);
  for (const c of db.clientes) {
    if (c.tipo !== 'fixo' || !Array.isArray(c.fixos)) continue;
    for (const f of c.fixos) {
      if (Number(f.dia) === dia && Number(f.hora) === Number(hora) && Number(f.campo) === Number(campo)) return c;
    }
  }
  return null;
}
export function temExcecao(db: Db, data: string, hora: number, campo: number, clienteId?: string | null): boolean {
  return db.excecoes.some((e) => e.data === data && Number(e.hora) === Number(hora) && Number(e.campo) === Number(campo) &&
    (clienteId == null || e.clienteId === clienteId));
}
export function reservaEm(db: Db, data: string, hora: number, campo: number): Reserva | null {
  return db.reservas.find((r) => r.data === data && Number(r.hora) === Number(hora) && Number(r.campo) === Number(campo)) || null;
}
export function statusDe(db: Db, data: string, hora: number, campo: number): string {
  const c = db.confirmacoes[chave(data, hora, campo)];
  return (c && c.status) || 'pendente';
}
export function ocupante(db: Db, data: string, hora: number, campo: number): Ocupante {
  const r = reservaEm(db, data, hora, campo);
  if (r) return { tipo: 'avulso', reserva: r, cliente: clientePorId(db, r.clienteId) };
  const f = fixoDe(db, data, hora, campo);
  if (f && !temExcecao(db, data, hora, campo, f.id)) return { tipo: 'fixo', cliente: f, status: statusDe(db, data, hora, campo) };
  if (f) return { tipo: 'livre', naoVem: f };
  return { tipo: 'livre' };
}
export function livresProximosDias(db: Db, n: number, agora: Agora): { data: string; dia: string; hora: number; campo: number }[] {
  const out: { data: string; dia: string; hora: number; campo: number }[] = [];
  const campos = listaCampos(db.cfg);
  for (let i = 0; i < n; i++) {
    const data = somaDias(agora.data, i);
    for (const h of horariosDoDia(db, data)) {
      if (i === 0 && h <= agora.hora) continue;
      for (const c of campos) if (ocupante(db, data, h, c).tipo === 'livre') out.push({ data, dia: nomeDia(data), hora: h, campo: c });
    }
  }
  return out;
}
export function conflitoFixo(db: Db, f: Fixo, ignorarClienteId?: string | null): Cliente | null {
  for (const c of db.clientes) {
    if (c.id === ignorarClienteId || c.tipo !== 'fixo' || !Array.isArray(c.fixos)) continue;
    for (const x of c.fixos) {
      if (Number(x.dia) === Number(f.dia) && Number(x.hora) === Number(f.hora) && Number(x.campo) === Number(f.campo)) return c;
    }
  }
  return null;
}

/* ---------- Textos ---------- */
export function normalizaTelefone(s: unknown): string {
  let d = String(s == null ? '' : s).replace(/\D/g, '').replace(/^0+/, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  return d;
}
/** Chave de comparação: 55 + DDD + 9 + 8 dígitos => tira o 9. */
export function chaveTelefone(tel: unknown): string {
  const d = normalizaTelefone(tel);
  const m = /^55(\d{2})9(\d{8})$/.exec(d);
  return m ? '55' + m[1] + m[2] : d;
}
export function mesmoTelefone(a: unknown, b: unknown): boolean {
  const x = chaveTelefone(a);
  return x !== '' && x === chaveTelefone(b);
}
export function preencheModelo(tpl: unknown, v?: Record<string, unknown>): string {
  const vals = v || {};
  return String(tpl == null ? '' : tpl)
    .replace(/\{(nome|dia|hora|campo|dono|pagamento|endereco)\}/g, (_m, k: string) => (vals[k] == null ? '' : String(vals[k])))
    .replace(/[ \t]{2,}/g, ' ').trim();
}
export function primeiroNome(nome: unknown): string { return String(nome || '').trim().split(/\s+/)[0] || ''; }
export function cortaConversa(texto: unknown, max = 15000): string {
  const t = String(texto == null ? '' : texto);
  return t.length > max ? t.slice(t.length - max) : t;
}
export function removeEmojis(s: unknown): string {
  return String(s == null ? '' : s)
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}‍️⃣]/gu, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([,.!?;:])/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}
export function normalizaTexto(s: unknown): string {
  return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/* ---------- Preço ---------- */
function numOuNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}
function listaBate(lista: unknown, v: number): boolean {
  return !Array.isArray(lista) || lista.length === 0 || lista.map(Number).indexOf(Number(v)) >= 0;
}
/** Preço em reais ou null. Vale a primeira regra especial que bater (listas vazias = tudo). */
export function precoDe(cfg: Cfg, data: string, hora: number, campo: number, tipo: 'avulso' | 'fixo'): number | null {
  const pr = ehObj(cfg.precos) ? cfg.precos : {};
  const dia = diaSemana(data);
  const esp = Array.isArray(pr.especiais) ? pr.especiais : [];
  for (const e of esp) {
    if (!ehObj(e)) continue;
    if (listaBate(e.dias, dia) && listaBate(e.horas, hora) && listaBate(e.campos, campo)) {
      const v = numOuNull(e[tipo]);
      if (v != null) return v;
      break; // bateu mas sem valor para este tipo: usa o preço base
    }
  }
  return numOuNull(pr[tipo]);
}
export function formataReais(v: number): string {
  return 'R$ ' + (Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ','));
}

/* ---------- Horário da IA ---------- */
export function dentroDoHorarioIA(cfg: Cfg, agora: Agora): boolean {
  const h = cfg.horario_ia;
  if (!ehObj(h) || h.modo === 'sempre' || !ehObj(h.janelas)) return true;
  const j = h.janelas[String(agora.dia)];
  if (!ehObj(j)) return false; // null/ausente: IA calada no dia
  const a = hhmmMin(agora.hhmm), ini = hhmmMin(j.inicio), fim = hhmmMin(j.fim);
  if (a == null || ini == null || fim == null) return false;
  if (fim > ini) return a >= ini && a < fim;
  if (fim < ini) return a >= ini || a < fim; // janela que vira a meia-noite
  return true; // inicio == fim: dia todo
}

/* ---------- Ações ---------- */
type Res = { ok: boolean; erro?: string };

export function validaAcao(db: Db, acao: Acao | null | undefined, clienteId: string | null, agora: Agora, porIA = false): Res {
  if (!acao || acao.tipo === 'nenhuma') return { ok: true };
  if (TIPOS_ACAO.indexOf(acao.tipo) < 0) return { ok: false, erro: 'Ação desconhecida.' };
  const cfg = db.cfg;
  if (porIA) {
    if (acao.tipo === 'reservar_avulso' && !cfg.permitir_ia_reservar) return { ok: false, erro: 'A IA não tem permissão para reservar.' };
    if (acao.tipo === 'cancelar' && !cfg.permitir_ia_cancelar) return { ok: false, erro: 'A IA não tem permissão para cancelar.' };
    if ((acao.tipo === 'confirmar' || acao.tipo === 'nao_vem') && !cfg.permitir_ia_confirmar) return { ok: false, erro: 'A IA não tem permissão para confirmar.' };
  }
  if (!dataValida(acao.data)) return { ok: false, erro: 'Data inválida.' };
  const data = acao.data as string, h = Number(acao.hora), c = Number(acao.campo);
  if (!Number.isInteger(h) || !Number.isInteger(c)) return { ok: false, erro: 'Horário inválido.' };
  if (data < agora.data || (data === agora.data && h <= agora.hora)) return { ok: false, erro: 'Esse horário já passou.' };
  if (listaCampos(cfg).indexOf(c) < 0) return { ok: false, erro: 'Campo inválido.' };
  if (horariosDoDia(db, data).indexOf(h) < 0) return { ok: false, erro: 'Fora do horário de funcionamento.' };
  const oc = ocupante(db, data, h, c);
  if (acao.tipo !== 'reservar_avulso' && !clienteId) return { ok: false, erro: 'Cliente não identificado.' };
  if (acao.tipo === 'reservar_avulso') {
    const maxDias = numOuNull(cfg.max_dias_reserva_frente);
    if (maxDias != null && data > somaDias(agora.data, maxDias)) return { ok: false, erro: 'Só dá para reservar até ' + maxDias + ' dias para frente.' };
    const ant = numOuNull(cfg.antecedencia_minima_reserva_h);
    if (ant != null && ant > 0 && minutosAte(agora, data, h) < ant * 60) return { ok: false, erro: 'Reservas precisam de ' + ant + 'h de antecedência.' };
    if (oc.tipo !== 'livre') return { ok: false, erro: oc.tipo === 'fixo' ? 'Esse horário já é de um cliente fixo.' : 'Esse horário já está reservado.' };
    return { ok: true };
  }
  if (acao.tipo === 'nao_vem' || acao.tipo === 'confirmar') {
    const f = fixoDe(db, data, h, c);
    if (!f || f.id !== clienteId) return { ok: false, erro: 'Esse não é um horário fixo deste cliente.' };
    if (acao.tipo === 'confirmar' && oc.tipo !== 'fixo') return { ok: false, erro: 'Esse horário está marcado como "não vem".' };
    return { ok: true };
  }
  // cancelar
  const r = reservaEm(db, data, h, c);
  if (!r || r.clienteId !== clienteId) return { ok: false, erro: 'Não achei reserva avulsa deste cliente nesse horário.' };
  const regra = numOuNull(cfg.cancelamento_regra_h);
  if (regra != null && regra > 0 && minutosAte(agora, data, h) < regra * 60) return { ok: false, erro: 'Cancelamento só com ' + regra + 'h de antecedência.' };
  return { ok: true };
}

export function efeitosDaAcao(db: Db, acao: Acao | null | undefined, clienteId: string | null, agora: Agora, porIA: boolean):
  { ok: boolean; erro?: string; efeitos: Efeito[] } {
  const v = validaAcao(db, acao, clienteId, agora, porIA);
  if (!v.ok) return { ok: false, erro: v.erro, efeitos: [] };
  if (!acao || acao.tipo === 'nenhuma') return { ok: true, efeitos: [] };
  if (!clienteId) return { ok: false, erro: 'Cliente não identificado.', efeitos: [] };
  const data = acao.data as string, hora = Number(acao.hora), campo = Number(acao.campo);
  const k = { data, hora, campo };
  if (acao.tipo === 'reservar_avulso') {
    return { ok: true, efeitos: [{ op: 'insert', tabela: 'reservas',
      linha: { ...k, cliente_id: clienteId, pago: false, origem: porIA ? 'ia' : 'dono' } }] };
  }
  if (acao.tipo === 'cancelar') {
    const r = reservaEm(db, data, hora, campo) as Reserva;
    return { ok: true, efeitos: [{ op: 'delete', tabela: 'reservas', filtro: { id: r.id } }] };
  }
  if (acao.tipo === 'nao_vem') {
    return { ok: true, efeitos: [
      { op: 'upsert', tabela: 'excecoes', linha: { ...k, cliente_id: clienteId } },
      { op: 'upsert', tabela: 'confirmacoes', linha: { ...k, cliente_id: clienteId, status: 'nao_vem', respondido_em: agora.iso, atualizado_em: agora.iso } },
    ] };
  }
  return { ok: true, efeitos: [
    { op: 'upsert', tabela: 'confirmacoes', linha: { ...k, cliente_id: clienteId, status: 'confirmado', respondido_em: agora.iso, atualizado_em: agora.iso } },
  ] };
}
