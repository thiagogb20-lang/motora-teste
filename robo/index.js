'use strict';
/*
 * Motora Teste – Robô
 * Liga o WhatsApp (Baileys) ao servidor dos Campos (Supabase Edge Function "robo").
 * Ele só conhece o código de pareamento; nenhuma chave de IA passa por aqui.
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const lib = require('./lib.js');
const pagina = require('./pagina.js');

const VERSAO = (() => { try { return require('./package.json').version; } catch (e) { return '0.0.0'; } })();
const PASTA = process.env.ROBO_PASTA ? path.resolve(process.env.ROBO_PASTA) : __dirname;
const ARQ_CONFIG = path.join(PASTA, 'config.json');
const PASTA_SESSAO = path.join(PASTA, 'sessao');
const PORTA = Number(process.env.ROBO_PORTA || 3210);
const WHATSAPP_FALSO = process.env.ROBO_WHATSAPP_FALSO === '1';
const URL_INICIAL = process.env.ROBO_SUPABASE_URL || lib.URL_PADRAO;

function log(t) { console.log(lib.linhaLog(t)); }
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- estado ---------- */
const estado = {
  conectado: false, qr: null, qrDataUrl: null, numero: null, mensagem: 'Iniciando...',
  resumo: { ia_ligada: false, modo: 'sugerir', pausa_envio_seg: { min: 3, max: 9 }, max_envios_por_minuto: 8,
    intervalo_pendentes_seg: 15, intervalo_pulso_seg: 60 }
};
let config = null;
let sock = null;
const enviadosPeloRobo = new Set();
const historicoEnvios = [];
let pedindoCodigo = null;

/* ---------- config.json ---------- */
function lerConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(ARQ_CONFIG, 'utf8'));
    return { supabase_url: c.supabase_url || URL_INICIAL, codigo: lib.normalizaCodigo(c.codigo) };
  } catch (e) { return { supabase_url: URL_INICIAL, codigo: '' }; }
}
function salvarConfig(c) {
  fs.writeFileSync(ARQ_CONFIG, JSON.stringify({ supabase_url: c.supabase_url, codigo: c.codigo }, null, 2));
}
function perguntar(texto) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let respondeu = false;
    rl.question(texto, (r) => { respondeu = true; rl.close(); resolve(r); });
    rl.on('close', () => { if (!respondeu) resolve(null); });
  });
}
async function pedirCodigo(aviso) {
  if (pedindoCodigo) return pedindoCodigo;
  pedindoCodigo = (async () => {
    if (aviso) log(aviso);
    for (;;) {
      const r = await perguntar('Digite o código de 8 letras que aparece no app: ');
      if (r === null) { log('Não consigo ler o teclado. Feche e abra o robô de novo.'); await espera(60000); continue; }
      if (lib.codigoValido(r)) {
        config.codigo = lib.normalizaCodigo(r);
        salvarConfig(config);
        log('Código salvo.');
        return config.codigo;
      }
      log('O código tem 8 letras/números. Tente de novo.');
    }
  })();
  try { return await pedindoCodigo; } finally { pedindoCodigo = null; }
}

/* ---------- servidor ---------- */
async function chamar(acao, dados) {
  if (!config.codigo) await pedirCodigo();
  let res;
  try {
    res = await fetch(lib.urlFuncao(config.supabase_url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-robo-codigo': config.codigo },
      body: JSON.stringify(Object.assign({ acao }, dados || {})),
      signal: AbortSignal.timeout(30000)
    });
  } catch (e) {
    throw new Error('sem internet ou servidor fora do ar (' + (e && e.message) + ')');
  }
  let j = null;
  try { j = await res.json(); } catch (e) { j = null; }
  if (res.status === 401) {
    config.codigo = '';
    salvarConfig(config);
    await pedirCodigo('Código inválido, gere outro no app');
    const e = new Error('código inválido'); e.status = 401; throw e;
  }
  if (!res.ok || !j || j.ok === false) throw new Error((j && j.erro) || ('erro ' + res.status));
  return j;
}

let pulsoAgendado = null;
async function pulso() {
  try {
    const j = await chamar('pulso', {
      conectado: estado.conectado, qr: estado.qrDataUrl || estado.qr || null, numero: estado.numero, versao: VERSAO
    });
    if (j.config_resumo) estado.resumo = Object.assign({}, estado.resumo, j.config_resumo);
    log('Pulso enviado (' + (estado.conectado ? 'WhatsApp conectado' : 'WhatsApp desconectado') +
      ', IA ' + (estado.resumo.ia_ligada ? 'ligada' : 'desligada') + ', modo ' + estado.resumo.modo + ')');
  } catch (e) {
    if (e.status !== 401) log('Falha no pulso: ' + e.message);
  }
}
function pulsoJa() {
  if (pulsoAgendado) return;
  pulsoAgendado = setTimeout(() => { pulsoAgendado = null; pulso(); }, 300);
}

/* ---------- envio ---------- */
async function resolveJid(m) {
  if (m.jid && /@(s\.whatsapp\.net|lid)$/.test(m.jid)) return m.jid;
  const tel = String(m.telefone || '').replace(/\D/g, '');
  try {
    const r = await sock.onWhatsApp(tel);
    if (r && r[0] && r[0].exists) return r[0].jid;
    if (Array.isArray(r) && r.length === 0) return null;
  } catch (e) { /* usa o padrão */ }
  return tel + '@s.whatsapp.net';
}

let ciclando = false;
async function cicloPendentes() {
  if (ciclando || !estado.conectado || !sock) return;
  ciclando = true;
  try {
    const j = await chamar('pendentes', {});
    const lista = Array.isArray(j.mensagens) ? j.mensagens : [];
    if (lista.length) log(lista.length + ' mensagem(ns) para enviar');
    for (const m of lista) {
      const p = estado.resumo.pausa_envio_seg || { min: 3, max: 9 };
      const lim = lib.esperaLimite(historicoEnvios, estado.resumo.max_envios_por_minuto, Date.now());
      if (lim > 0) await espera(lim);
      let ok = false, erro, idw;
      try {
        if (!estado.conectado) throw new Error('WhatsApp desconectado');
        const jid = await resolveJid(m);
        if (!jid) throw new Error('número sem WhatsApp');
        const r = await sock.sendMessage(jid, { text: String(m.texto || '') });
        idw = r && r.key && r.key.id;
        lib.lembraId(enviadosPeloRobo, idw, 500);
        ok = true;
        historicoEnvios.push(Date.now());
        log('Mensagem enviada para ' + lib.mascaraTelefone(m.telefone));
      } catch (e) {
        erro = String((e && e.message) || e);
        log('Não consegui enviar para ' + lib.mascaraTelefone(m.telefone) + ': ' + erro);
      }
      try { await chamar('enviada', ok ? { id: m.id, ok: true, id_whatsapp: idw } : { id: m.id, ok: false, erro }); }
      catch (e) { log('Falha ao avisar o servidor do envio: ' + e.message); }
      await espera(lib.pausaAleatoria(p.min, p.max));
    }
    if (historicoEnvios.length > 50) historicoEnvios.splice(0, historicoEnvios.length - 50);
  } catch (e) {
    if (e.status !== 401) log('Falha ao buscar pendentes: ' + e.message);
  } finally { ciclando = false; }
}

/* ---------- mensagens recebidas ---------- */
async function recebida(msg) {
  const corpo = lib.paraPost(msg, Date.now(), enviadosPeloRobo, log);
  if (!corpo) return;
  log((corpo.de_mim ? 'Mensagem sua para ' : 'Mensagem de ') + lib.mascaraTelefone(corpo.telefone) + ' recebida');
  try {
    const j = await chamar('mensagem', corpo);
    if (j.resultado && j.resultado !== 'registrada') log('  → ' + j.resultado + (j.motivo ? ' (' + j.motivo + ')' : ''));
  } catch (e) {
    if (e.status !== 401) log('Falha ao mandar a mensagem para o servidor: ' + e.message);
  }
}

/* ---------- WhatsApp ---------- */
function carregaBaileys() {
  try {
    return { B: require('@whiskeysockets/baileys'), pino: require('pino') };
  } catch (e) {
    return null;
  }
}
function opcional(nome) { try { return require(nome); } catch (e) { return null; } }

async function mostraQR(qr) {
  estado.qr = qr; estado.qrDataUrl = null;
  const qt = opcional('qrcode-terminal');
  if (qt) qt.generate(qr, { small: true });
  const qrcode = opcional('qrcode');
  if (qrcode) { try { estado.qrDataUrl = await qrcode.toDataURL(qr, { margin: 1, width: 300 }); } catch (e) { /* fica o texto */ } }
  log('Escaneie o QR (também em http://localhost:' + PORTA + ' e no app).');
  pulsoJa();
}

async function conectar() {
  if (WHATSAPP_FALSO) return conectarFalso();
  const dep = carregaBaileys();
  if (!dep) {
    estado.mensagem = 'Faltam os arquivos do WhatsApp. Feche e rode o INICIAR.bat de novo.';
    log('Não achei a biblioteca do WhatsApp (rode "npm install"). O robô fica ligado, mas sem WhatsApp.');
    pulsoJa();
    return;
  }
  const B = dep.B;
  const makeWASocket = B.default || B.makeWASocket;
  const { state, saveCreds } = await B.useMultiFileAuthState(PASTA_SESSAO);
  let version;
  try { version = (await B.fetchLatestBaileysVersion()).version; } catch (e) { version = undefined; }
  sock = makeWASocket({
    version, auth: state, printQRInTerminal: false, logger: dep.pino({ level: 'silent' }),
    browser: [lib.NOME_ROBO, 'Chrome', '120.0'], markOnlineOnConnect: false, syncFullHistory: false
  });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async (u) => {
    if (u.qr) await mostraQR(u.qr);
    if (u.connection === 'open') {
      estado.conectado = true; estado.qr = null; estado.qrDataUrl = null;
      estado.numero = sock.user && sock.user.id ? String(sock.user.id).split(':')[0].split('@')[0] : null;
      log('WhatsApp conectado' + (estado.numero ? ' (' + estado.numero + ')' : '') + '.');
      pulsoJa();
    }
    if (u.connection === 'close') {
      estado.conectado = false;
      const code = u.lastDisconnect && u.lastDisconnect.error && u.lastDisconnect.error.output && u.lastDisconnect.error.output.statusCode;
      if (code === B.DisconnectReason.loggedOut) {
        log('O WhatsApp foi desconectado pelo celular. Vou mostrar um QR novo.');
        try { fs.rmSync(PASTA_SESSAO, { recursive: true, force: true }); } catch (e) { /* ok */ }
      } else {
        log('Conexão com o WhatsApp caiu. Tentando de novo em 5 segundos...');
      }
      pulsoJa();
      setTimeout(() => conectar().catch((e) => log('Erro ao reconectar: ' + e.message)), 5000);
    }
  });
  sock.ev.on('messages.upsert', async (ev) => {
    if (!ev || ev.type !== 'notify') return;
    for (const m of ev.messages || []) await recebida(m);
  });
}

/* WhatsApp de mentira (só para testes: ROBO_WHATSAPP_FALSO=1). Não envia nada de verdade. */
function conectarFalso() {
  let n = 0;
  sock = {
    onWhatsApp: async (tel) => [{ exists: true, jid: tel + '@s.whatsapp.net' }],
    sendMessage: async (jid, c) => { n++; log('(teste) enviaria para ' + jid + ': ' + c.text); return { key: { id: 'FALSO' + n } }; }
  };
  estado.conectado = true; estado.numero = '5500000000000';
  log('WhatsApp de teste conectado.');
  pulsoJa();
}

/* ---------- laços ---------- */
function intervalo(nome, padrao) {
  const s = Number(estado.resumo[nome]);
  return Math.max(1, Number.isFinite(s) && s > 0 ? s : padrao) * 1000;
}
function laco(fn, nome, padrao) {
  const rodar = async () => { try { await fn(); } catch (e) { log('Erro: ' + e.message); } setTimeout(rodar, intervalo(nome, padrao)); };
  setTimeout(rodar, intervalo(nome, padrao));
}

async function principal() {
  console.log('==========================================');
  console.log('  ' + lib.NOME_ROBO + '  (versão ' + VERSAO + ')');
  console.log('  Deixe esta janela aberta. Para parar, feche-a.');
  console.log('==========================================');
  config = lerConfig();
  if (!config.codigo) await pedirCodigo('No app, vá em Mais › Ajustes › Robô e toque em "Gerar código".');
  pagina.criaServidor(() => estado, PORTA);
  await pulso();
  laco(pulso, 'intervalo_pulso_seg', 60);
  laco(cicloPendentes, 'intervalo_pendentes_seg', 15);
  try { await conectar(); } catch (e) { log('Erro ao abrir o WhatsApp: ' + e.message); }
}

process.on('unhandledRejection', (e) => log('Erro inesperado: ' + ((e && e.message) || e)));
process.on('uncaughtException', (e) => log('Erro inesperado: ' + ((e && e.message) || e)));

if (require.main === module) principal();

module.exports = { principal, estado };
