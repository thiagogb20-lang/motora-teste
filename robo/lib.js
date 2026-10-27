'use strict';
/* Funções puras do robô (sem rede, sem WhatsApp). Testadas em testes/lib.test.js */

const NOME_ROBO = 'Motora Teste – Robô';
const URL_PADRAO = 'https://vsfvwyycacfofnwfpajm.supabase.co';
const MAX_IDADE_MS = 10 * 60 * 1000;

function desembrulha(m) {
  let x = m;
  for (let i = 0; i < 5 && x && typeof x === 'object'; i++) {
    const dentro =
      (x.ephemeralMessage && x.ephemeralMessage.message) ||
      (x.viewOnceMessage && x.viewOnceMessage.message) ||
      (x.viewOnceMessageV2 && x.viewOnceMessageV2.message) ||
      (x.viewOnceMessageV2Extension && x.viewOnceMessageV2Extension.message) ||
      (x.documentWithCaptionMessage && x.documentWithCaptionMessage.message) ||
      (x.editedMessage && x.editedMessage.message);
    if (!dentro) break;
    x = dentro;
  }
  return x;
}

/** Texto de uma mensagem do Baileys (msg.message ou a mensagem inteira). '' se não houver. */
function extraiTexto(msg) {
  if (!msg || typeof msg !== 'object') return '';
  let m = msg.message && typeof msg.message === 'object' ? msg.message : msg;
  m = desembrulha(m);
  if (!m || typeof m !== 'object') return '';
  const t =
    (typeof m.conversation === 'string' && m.conversation) ||
    (m.extendedTextMessage && m.extendedTextMessage.text) ||
    (m.imageMessage && m.imageMessage.caption) ||
    (m.videoMessage && m.videoMessage.caption) ||
    (m.documentMessage && m.documentMessage.caption) ||
    '';
  return String(t || '').trim();
}

/** true só para conversa de uma pessoa (não grupo, lista, canal ou status). */
function ehIndividual(jid) {
  if (typeof jid !== 'string' || !jid.includes('@')) return false;
  if (jid === 'status@broadcast') return false;
  if (/@(g\.us|broadcast|newsletter)$/.test(jid)) return false;
  return /@(s\.whatsapp\.net|c\.us|lid)$/.test(jid);
}

function digitosDoJid(j) {
  if (typeof j !== 'string' || !j) return '';
  return j.split('@')[0].split(':')[0].replace(/\D/g, '');
}

/** Telefone (só dígitos) a partir do jid. Para @lid usa key.senderPn ou key.remoteJidAlt. */
function telefoneDoJid(jid, key) {
  if (typeof jid !== 'string') return '';
  if (/@lid$/.test(jid)) {
    const k = key || {};
    return digitosDoJid(k.senderPn) || digitosDoJid(k.remoteJidAlt) || digitosDoJid(k.participantPn) || '';
  }
  return digitosDoJid(jid);
}

/** Pausa aleatória em MILISSEGUNDOS entre min e max SEGUNDOS. */
function pausaAleatoria(min, max, aleatorio) {
  let a = Number(min), b = Number(max);
  if (!Number.isFinite(a) || a < 0) a = 0;
  if (!Number.isFinite(b) || b < 0) b = a;
  if (b < a) { const t = a; a = b; b = t; }
  const r = typeof aleatorio === 'function' ? aleatorio() : Math.random();
  return Math.round((a + (b - a) * r) * 1000);
}

/** Código de pareamento: tira espaços/traços e põe em maiúsculas. */
function normalizaCodigo(s) {
  return String(s == null ? '' : s).replace(/[^0-9a-zA-Z]/g, '').toUpperCase();
}

function codigoValido(s) {
  return /^[A-Z0-9]{8}$/.test(normalizaCodigo(s));
}

/** Segundos do messageTimestamp (number, string ou Long) → ms. */
function tsMs(messageTimestamp) {
  if (messageTimestamp == null) return 0;
  let n;
  if (typeof messageTimestamp === 'object' && typeof messageTimestamp.toNumber === 'function') n = messageTimestamp.toNumber();
  else if (typeof messageTimestamp === 'object' && 'low' in messageTimestamp) n = Number(messageTimestamp.low) >>> 0;
  else n = Number(messageTimestamp);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n < 1e12 ? n * 1000 : n;
}

/**
 * Converte uma mensagem do messages.upsert no corpo da rota `mensagem`.
 * Devolve null quando deve ser ignorada (grupo, antiga, sem texto, eco do robô, @lid sem número).
 */
function paraPost(msg, agoraMs, enviadosPeloRobo, log) {
  if (!msg || !msg.key) return null;
  const key = msg.key;
  const jid = key.remoteJid;
  if (!ehIndividual(jid)) return null;
  const ts = tsMs(msg.messageTimestamp) || agoraMs;
  if (agoraMs - ts > MAX_IDADE_MS) return null;
  if (key.fromMe && enviadosPeloRobo && enviadosPeloRobo.has(key.id)) return null;
  const texto = extraiTexto(msg);
  if (!texto) return null;
  const telefone = telefoneDoJid(jid, key);
  if (!telefone) {
    if (/@lid$/.test(jid) && typeof log === 'function') log('Mensagem de contato sem número visível (ignorada)');
    return null;
  }
  return {
    telefone, jid, nome_contato: String(msg.pushName || ''), texto,
    id_whatsapp: String(key.id || ''), de_mim: !!key.fromMe, ts
  };
}

/** Hora HH:MM de Brasília para o log. */
function horaAgora(d) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false })
    .format(d || new Date());
}

function linhaLog(texto, d) { return '[' + horaAgora(d) + '] ' + texto; }

/** Guarda o id no Set mantendo só os últimos `max` (Set preserva a ordem de inserção). */
function lembraId(set, id, max) {
  if (!id) return;
  set.add(id);
  const lim = Number(max) > 0 ? Number(max) : 500;
  while (set.size > lim) set.delete(set.values().next().value);
}

/** Controle de "no máximo N envios por minuto". Devolve quantos ms esperar (0 = pode enviar). */
function esperaLimite(historicoMs, maxPorMinuto, agoraMs) {
  const max = Math.max(1, Number(maxPorMinuto) || 1);
  const recentes = historicoMs.filter((t) => agoraMs - t < 60000);
  if (recentes.length < max) return 0;
  recentes.sort((a, b) => a - b);
  return 60000 - (agoraMs - recentes[recentes.length - max]) + 50;
}

/** Endereço da função a partir da URL do Supabase. */
function urlFuncao(supabaseUrl) {
  return String(supabaseUrl || URL_PADRAO).replace(/\/+$/, '') + '/functions/v1/robo';
}

function mascaraTelefone(t) {
  const s = String(t || '');
  return s.length > 6 ? s.slice(0, s.length - 4) + '****' : s;
}

module.exports = {
  NOME_ROBO, URL_PADRAO, MAX_IDADE_MS,
  extraiTexto, ehIndividual, telefoneDoJid, pausaAleatoria, normalizaCodigo, codigoValido,
  tsMs, paraPost, lembraId, horaAgora, linhaLog, esperaLimite, urlFuncao, mascaraTelefone
};
