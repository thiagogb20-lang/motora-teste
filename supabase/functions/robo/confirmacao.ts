// confirmacao.ts — confirmação automática dos fixos (puro).
import type { Agora, Db } from './nucleo.ts';
import {
  DIAS_LONGO, chave, diaSemana, ehObj, fixoDe, formataDataBR, hhmmMaiorIgual, horariosDoDia, listaCampos,
  minutosDesde, nomeCampo, normalizaTexto, preencheModelo, primeiroNome, somaDias, temExcecao,
} from './nucleo.ts';

export type Etapa = 'manha' | 'tarde' | 'liberar';
export type ItemConfirmacao = {
  data: string; hora: number; campo: number; cliente_id: string; telefone: string; etapa: Etapa;
  /** manha/tarde: mensagem para o cliente. liberar: texto do aviso para o dono (não é enviado ao cliente). */
  texto: string;
};

const MODELO_MANHA = 'Bom dia {nome}! Confirma o futebol amanhã ({dia}) às {hora}h no {campo}?';
const MODELO_TARDE = 'Oi {nome}, ainda não tive retorno: amanhã ({dia}) {hora}h no {campo}, confirma?';

export function valoresModelo(db: Db, nome: string, data: string, hora: number, campo: number): Record<string, unknown> {
  const cfg = db.cfg;
  return {
    nome: primeiroNome(nome), dia: DIAS_LONGO[diaSemana(data)] + ' ' + formataDataBR(data), hora,
    campo: nomeCampo(cfg, campo), dono: cfg.nome_dono || '', endereco: cfg.endereco || '',
    pagamento: ehObj(cfg.pagamento) ? (cfg.pagamento.texto || '') : '',
  };
}

export function gerarConfirmacoes(db: Db, agora: Agora): ItemConfirmacao[] {
  const cfg = db.cfg, out: ItemConfirmacao[] = [];
  const ultima = cfg.confirmacao_ultima_hora || '21:00';
  if (hhmmMaiorIgual(agora.hhmm, ultima) && agora.hhmm !== ultima) return [];
  const modelos = ehObj(cfg.modelos) ? cfg.modelos : {};
  const lib = ehObj(cfg.liberar_fixo_sem_resposta) ? cfg.liberar_fixo_sem_resposta : {};
  const data = somaDias(agora.data, 1);
  for (const h of horariosDoDia(db, data)) {
    for (const c of listaCampos(cfg)) {
      const f = fixoDe(db, data, h, c);
      if (!f || temExcecao(db, data, h, c, f.id) || !f.telefone) continue;
      const conf = db.confirmacoes[chave(data, h, c)];
      const st = (conf && conf.status) || 'pendente';
      const base = { data, hora: h, campo: c, cliente_id: f.id, telefone: f.telefone };
      const v = valoresModelo(db, f.nome, data, h, c);
      if (lib.ligado && (st === 'manha' || st === 'tarde') && hhmmMaiorIgual(agora.hhmm, lib.hora)) {
        out.push({ ...base, etapa: 'liberar',
          texto: 'Liberei ' + v.dia + ' ' + h + 'h no ' + v.campo + ': ' + (f.nome || f.telefone) + ' não respondeu a confirmação.' });
        continue;
      }
      if (st === 'pendente' && hhmmMaiorIgual(agora.hhmm, cfg.confirmacao_manha_hora || '09:00')) {
        out.push({ ...base, etapa: 'manha', texto: preencheModelo(modelos.manha || MODELO_MANHA, v) });
        continue;
      }
      if (st === 'manha' && hhmmMaiorIgual(agora.hhmm, cfg.confirmacao_tarde_hora || '15:00') &&
          minutosDesde(agora, conf && conf.manhaEm) > 60) {
        out.push({ ...base, etapa: 'tarde', texto: preencheModelo(modelos.tarde || MODELO_TARDE, v) });
      }
    }
  }
  return out;
}

// Padrões aplicados sobre normalizaTexto (minúsculas, sem acento).
const NAO = [
  /\bnao\b/, /\bnem\b/, /\bcancela/, /\bsem jogo\b/, /\bnao vai dar\b/, /\bnao da\b/, /\bnegativo\b/,
  /\bdesmarca/, /\bfurou\b/, /\bvou faltar\b/, /\bnao rola\b/, /👎/, /❌/,
];
const SIM = [
  /\bsim\b/, /\bconfirm/, /\bvou\b/, /\bvamos\b/, /\bbora\b/, /\bok\b/, /\bokay\b/, /\bpode deixar\b/, /\bfechado\b/,
  /\bpode ser\b/, /\bcom certeza\b/, /\bpositivo\b/, /\bclaro\b/, /\bss\b/, /\bvai sim\b/, /\bestaremos\b/, /\bestarei\b/,
  /👍/, /✅/, /✔/,
];

/** 'sim' | 'nao' | null (ambíguo, nenhum ou os dois). */
export function interpretaConfirmacao(texto: unknown): 'sim' | 'nao' | null {
  const t = normalizaTexto(texto).replace(/[!?.,;:]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const nao = NAO.some((r) => r.test(t));
  // "nao vou"/"nao vamos" contêm "vou"/"vamos": tira os trechos negados antes de procurar o sim.
  const semNeg = t.replace(/\bnao( \w+)?/g, ' ').replace(/\bnem( \w+)?/g, ' ');
  const sim = SIM.some((r) => r.test(semNeg));
  if (sim && nao) return null;
  if (nao) return 'nao';
  if (sim) return 'sim';
  return null;
}
