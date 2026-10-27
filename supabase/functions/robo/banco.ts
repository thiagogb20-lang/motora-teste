// banco.ts — acesso ao banco.
// Tudo passa pela interface Tabelas (sel/ins/upd/ups/del), para os testes usarem um banco em memória.
// O supabase-js (npm:) só é importado dentro de criaTabelasSupabase(), assim o Node consegue importar este arquivo.
import type { Db, Efeito, Cliente, Agora } from './nucleo.ts';
import { chave, somaDias } from './nucleo.ts';

declare const Deno: any;

export type Linha = Record<string, any>;
/** Filtro: {col: valor} (igual), {col: null} (is null) ou {col: {in|neq|lt|lte|gt|gte: v}}. */
export type Filtro = Record<string, unknown>;
export type OpcoesSel = { ordem?: { col: string; asc?: boolean }; limite?: number };
export interface Tabelas {
  sel(tabela: string, filtro?: Filtro, opcoes?: OpcoesSel): Promise<Linha[]>;
  /** Lança erro com code '23505' quando bate em chave única. */
  ins(tabela: string, linha: Linha): Promise<Linha>;
  upd(tabela: string, filtro: Filtro, campos: Linha): Promise<Linha[]>;
  ups(tabela: string, linha: Linha, conflito: string): Promise<void>;
  del(tabela: string, filtro: Filtro): Promise<void>;
}

export const CONFLITO: Record<string, string> = {
  excecoes: 'data,hora,campo', confirmacoes: 'data,hora,campo', contatos: 'telefone', robo: 'id', config: 'id',
};

/** Monta o Db do contrato a partir das tabelas. Reservas/exceções/confirmações só de 7 dias atrás em diante. */
export async function carregaDb(tab: Tabelas, agora?: Agora): Promise<Db> {
  const desde = agora ? somaDias(agora.data, -7) : '1900-01-01';
  const [cfgL, regras, clientes, fixos, reservas, excecoes, confs, exemplos] = await Promise.all([
    tab.sel('config', { id: 1 }),
    tab.sel('regras', {}, { ordem: { col: 'ordem', asc: true } }),
    tab.sel('clientes'),
    tab.sel('horarios_fixos'),
    tab.sel('reservas', { data: { gte: desde } }),
    tab.sel('excecoes', { data: { gte: desde } }),
    tab.sel('confirmacoes', { data: { gte: desde } }),
    tab.sel('conversas_exemplo', {}, { ordem: { col: 'id', asc: true } }),
  ]);
  const porCliente: Record<string, { dia: number; hora: number; campo: number }[]> = {};
  for (const f of fixos) (porCliente[f.cliente_id] = porCliente[f.cliente_id] || []).push({ dia: Number(f.dia), hora: Number(f.hora), campo: Number(f.campo) });
  const cls: Cliente[] = clientes.map((c) => ({
    id: String(c.id), nome: c.nome || '', telefone: c.telefone || '', tipo: c.tipo === 'fixo' ? 'fixo' : 'avulso',
    ignorar: !!c.ignorar, fixos: porCliente[c.id] || [],
  }));
  const confirmacoes: Db['confirmacoes'] = {};
  for (const c of confs) confirmacoes[chave(c.data, Number(c.hora), Number(c.campo))] = { status: c.status, manhaEm: c.manha_em ?? null, tardeEm: c.tarde_em ?? null };
  return {
    cfg: (cfgL[0] && cfgL[0].dados) || {},
    regras: regras.map((r) => ({ texto: String(r.texto || ''), ativa: r.ativa !== false, ordem: Number(r.ordem) || 0 })),
    clientes: cls,
    reservas: reservas.map((r) => ({ id: String(r.id), data: r.data, hora: Number(r.hora), campo: Number(r.campo), clienteId: String(r.cliente_id), pago: !!r.pago })),
    excecoes: excecoes.map((e) => ({ data: e.data, hora: Number(e.hora), campo: Number(e.campo), clienteId: String(e.cliente_id) })),
    confirmacoes,
    exemplos: exemplos.map((e) => ({ nomeArquivo: e.nome_arquivo || 'conversa', texto: e.texto || '' })),
  };
}

export async function carregaChaves(tab: Tabelas): Promise<{ gemini: string; groq: string }> {
  const l = (await tab.sel('config', { id: 1 }))[0] || {};
  return { gemini: String(l.gemini_key || ''), groq: String(l.groq_key || '') };
}

/** Aplica os efeitos em ordem. Para no primeiro erro. */
export async function aplicaEfeitos(tab: Tabelas, efeitos: Efeito[]): Promise<{ ok: boolean; erro?: string }> {
  for (const e of efeitos) {
    try {
      if (e.op === 'insert') await tab.ins(e.tabela, e.linha || {});
      else if (e.op === 'upsert') await tab.ups(e.tabela, e.linha || {}, CONFLITO[e.tabela] || 'id');
      else if (e.op === 'delete') await tab.del(e.tabela, e.filtro || {});
      else if (e.op === 'update') await tab.upd(e.tabela, e.filtro || {}, e.linha || {});
    } catch (err: any) {
      if (err && err.code === '23505') return { ok: false, erro: 'Esse horário acabou de ser ocupado.' };
      return { ok: false, erro: String((err && err.message) || err) };
    }
  }
  return { ok: true };
}

/* ---------------- Supabase (só na Edge Function) ---------------- */
function aplicaFiltro(q: any, f: Filtro | undefined): any {
  for (const [k, v] of Object.entries(f || {})) {
    if (v === null) q = q.is(k, null);
    else if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = v as Record<string, any>;
      if ('in' in o) q = q.in(k, o.in);
      if ('neq' in o) q = q.neq(k, o.neq);
      if ('lt' in o) q = q.lt(k, o.lt);
      if ('lte' in o) q = q.lte(k, o.lte);
      if ('gt' in o) q = q.gt(k, o.gt);
      if ('gte' in o) q = q.gte(k, o.gte);
    } else q = q.eq(k, v);
  }
  return q;
}
function falha(error: any): never {
  const e: any = new Error(error.message || 'erro no banco');
  e.code = error.code;
  throw e;
}

export async function criaClienteSupabase(): Promise<any> {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes');
  const mod: any = await import('npm:@supabase/supabase-js@2');
  return mod.createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function criaTabelasSupabase(sb: any): Tabelas {
  return {
    async sel(t, f, o) {
      const out: Linha[] = [];
      const passo = 1000;
      for (let ini = 0; ; ini += passo) {
        let q = aplicaFiltro(sb.from(t).select('*'), f);
        if (o && o.ordem) q = q.order(o.ordem.col, { ascending: o.ordem.asc !== false });
        const fim = o && o.limite ? Math.min(ini + passo, o.limite) - 1 : ini + passo - 1;
        q = q.range(ini, fim);
        const { data, error } = await q;
        if (error) falha(error);
        out.push(...(data || []));
        if (!data || data.length < fim - ini + 1 || (o && o.limite && out.length >= o.limite)) break;
      }
      return out;
    },
    async ins(t, linha) {
      const { data, error } = await sb.from(t).insert(linha).select().single();
      if (error) falha(error);
      return data;
    },
    async upd(t, f, campos) {
      const { data, error } = await aplicaFiltro(sb.from(t).update(campos), f).select();
      if (error) falha(error);
      return data || [];
    },
    async ups(t, linha, conflito) {
      const { error } = await sb.from(t).upsert(linha, { onConflict: conflito });
      if (error) falha(error);
    },
    async del(t, f) {
      const { error } = await aplicaFiltro(sb.from(t).delete(), f);
      if (error) falha(error);
    },
  };
}

/** Devolve o user_id do JWT do app, ou null. */
export function criaUsuarioDoToken(sb: any): (jwt: string) => Promise<string | null> {
  return async (jwt: string) => {
    if (!jwt) return null;
    const { data, error } = await sb.auth.getUser(jwt);
    if (error || !data || !data.user) return null;
    return data.user.id;
  };
}
