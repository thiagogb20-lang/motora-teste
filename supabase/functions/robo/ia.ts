// ia.ts — chamadas HTTP às IAs (Gemini e Groq) com timeout e reserva.
// Sem import de rede: o fetch é injetado (padrão: globalThis.fetch).
import type { Cfg } from './nucleo.ts';
import { ehObj } from './nucleo.ts';
import type { Content } from './prompt.ts';
import { montaReqGemini, montaReqGroq, textoGemini, textoGroq } from './prompt.ts';

export type FetchFn = (url: string, init: Record<string, unknown>) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
export type Chaves = { gemini: string; groq: string };
export type ResultadoIA = { texto: string; provedor: 'gemini' | 'groq'; erros: string[] };

export function erroAmigavel(provedor: string, status: number, corpo: string): string {
  const p = provedor === 'groq' ? 'Groq' : 'Gemini';
  if (status === 404) return p + ': modelo não encontrado. Troque o modelo em Ajustes › IA.';
  if (status === 429) return p + ': limite grátis atingido.';
  if (status === 401 || status === 403 || /api[_ ]?key/i.test(corpo)) return p + ': chave inválida. Confira em Ajustes › IA.';
  if (status === 0) return p + ': sem resposta (internet ou tempo esgotado).';
  return p + ': erro ' + status + '.';
}

async function chamar(provedor: 'gemini' | 'groq', req: { url: string; init: Record<string, unknown> }, timeoutMs: number,
  fetchFn: FetchFn): Promise<string> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tempo = new Promise<never>((_, rej) => {
    timer = setTimeout(() => { ctrl.abort(); rej(new Error(erroAmigavel(provedor, 0, '') + ' (passou de ' + Math.round(timeoutMs / 1000) + 's)')); }, timeoutMs);
  });
  try {
    const res = await Promise.race([fetchFn(req.url, { ...req.init, signal: ctrl.signal }), tempo]);
    const corpo = await Promise.race([res.text(), tempo]);
    if (!res.ok) throw new Error(erroAmigavel(provedor, res.status, corpo));
    let j: unknown;
    try { j = JSON.parse(corpo); } catch { throw new Error(erroAmigavel(provedor, res.status, '') + ' Resposta não é JSON.'); }
    const t = provedor === 'gemini' ? textoGemini(j) : textoGroq(j);
    if (!t.trim()) throw new Error((provedor === 'gemini' ? 'Gemini' : 'Groq') + ': resposta vazia.');
    return t;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/^(Gemini|Groq):/.test(msg)) throw e;
    throw new Error(erroAmigavel(provedor, 0, '') + ' ' + msg);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function iaDe(cfg: Cfg): Record<string, any> { return ehObj(cfg.ia) ? cfg.ia : {}; }
function timeoutDe(cfg: Cfg): number { const s = Number(iaDe(cfg).timeout_seg); return (s > 0 ? s : 25) * 1000; }

export function chamarGemini(cfg: Cfg, chave: string, system: string, contents: Content[], fetchFn: FetchFn = globalThis.fetch as unknown as FetchFn): Promise<string> {
  const modelo = String(iaDe(cfg).gemini_modelo || 'gemini-2.5-flash');
  return chamar('gemini', montaReqGemini(modelo, chave, system, contents, cfg), timeoutDe(cfg), fetchFn);
}

export function chamarGroq(cfg: Cfg, chave: string, system: string, contents: Content[], fetchFn: FetchFn = globalThis.fetch as unknown as FetchFn): Promise<string> {
  const modelo = String(iaDe(cfg).groq_modelo || 'llama-3.3-70b-versatile');
  return chamar('groq', montaReqGroq(modelo, chave, system, contents, cfg), timeoutDe(cfg), fetchFn);
}

/**
 * Provedor principal (cfg.ia.provedor, padrão gemini) e, se falhar, o outro quando houver chave
 * (para cair do Gemini no Groq é preciso usar_reserva_groq ligado). Lança Error com todos os motivos.
 */
export async function chamarIA(cfg: Cfg, chaves: Chaves, system: string, contents: Content[],
  fetchFn: FetchFn = globalThis.fetch as unknown as FetchFn): Promise<ResultadoIA> {
  const ia = iaDe(cfg);
  const ordem: ('gemini' | 'groq')[] = ia.provedor === 'groq' ? ['groq', 'gemini'] : ['gemini', 'groq'];
  const erros: string[] = [];
  for (let i = 0; i < ordem.length; i++) {
    const p = ordem[i];
    const chave = String((p === 'gemini' ? chaves.gemini : chaves.groq) || '').trim();
    if (i > 0 && p === 'groq' && ia.usar_reserva_groq === false) continue;
    if (!chave) { if (i === 0) erros.push((p === 'gemini' ? 'Gemini' : 'Groq') + ': sem chave.'); continue; }
    try {
      const texto = p === 'gemini' ? await chamarGemini(cfg, chave, system, contents, fetchFn) : await chamarGroq(cfg, chave, system, contents, fetchFn);
      return { texto, provedor: p, erros };
    } catch (e) {
      erros.push(e instanceof Error ? e.message : String(e));
    }
  }
  throw new Error(erros.join(' ') || 'Nenhuma chave de IA configurada.');
}
