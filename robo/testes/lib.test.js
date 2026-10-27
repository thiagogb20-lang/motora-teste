'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');
const lib = require('../lib.js');
const { montaPagina } = require('../pagina.js');

test('extraiTexto: conversa, texto estendido, legendas, embrulhos e vazio', () => {
  assert.equal(lib.extraiTexto({ message: { conversation: ' oi ' } }), 'oi');
  assert.equal(lib.extraiTexto({ message: { extendedTextMessage: { text: 'tem horário?' } } }), 'tem horário?');
  assert.equal(lib.extraiTexto({ message: { imageMessage: { caption: 'foto' } } }), 'foto');
  assert.equal(lib.extraiTexto({ message: { videoMessage: { caption: 'vid' } } }), 'vid');
  assert.equal(lib.extraiTexto({ message: { ephemeralMessage: { message: { conversation: 'efêmera' } } } }), 'efêmera');
  assert.equal(lib.extraiTexto({ message: { audioMessage: {} } }), '');
  assert.equal(lib.extraiTexto({ message: { imageMessage: {} } }), '');
  assert.equal(lib.extraiTexto(null), '');
  assert.equal(lib.extraiTexto({ conversation: 'direto' }), 'direto');
});

test('ehIndividual', () => {
  assert.equal(lib.ehIndividual('5511987654321@s.whatsapp.net'), true);
  assert.equal(lib.ehIndividual('123456789@lid'), true);
  assert.equal(lib.ehIndividual('1203630@g.us'), false);
  assert.equal(lib.ehIndividual('status@broadcast'), false);
  assert.equal(lib.ehIndividual('123@broadcast'), false);
  assert.equal(lib.ehIndividual('123@newsletter'), false);
  assert.equal(lib.ehIndividual(''), false);
  assert.equal(lib.ehIndividual(undefined), false);
});

test('telefoneDoJid: normal, com device, @lid com senderPn / remoteJidAlt', () => {
  assert.equal(lib.telefoneDoJid('5511987654321@s.whatsapp.net'), '5511987654321');
  assert.equal(lib.telefoneDoJid('5511987654321:12@s.whatsapp.net'), '5511987654321');
  assert.equal(lib.telefoneDoJid('999@lid', { senderPn: '5511911112222@s.whatsapp.net' }), '5511911112222');
  assert.equal(lib.telefoneDoJid('999@lid', { remoteJidAlt: '5521933334444@s.whatsapp.net' }), '5521933334444');
  assert.equal(lib.telefoneDoJid('999@lid', {}), '');
});

test('pausaAleatoria em ms, limites e ordem trocada', () => {
  assert.equal(lib.pausaAleatoria(3, 9, () => 0), 3000);
  assert.equal(lib.pausaAleatoria(3, 9, () => 1), 9000);
  assert.equal(lib.pausaAleatoria(9, 3, () => 0), 3000);
  assert.equal(lib.pausaAleatoria(5, 5), 5000);
  for (let i = 0; i < 50; i++) { const v = lib.pausaAleatoria(1, 2); assert.ok(v >= 1000 && v <= 2000); }
  assert.equal(lib.pausaAleatoria('x', undefined, () => 0.5), 0);
});

test('normalizaCodigo e codigoValido', () => {
  assert.equal(lib.normalizaCodigo(' ab cd-ef2h '), 'ABCDEF2H');
  assert.equal(lib.normalizaCodigo(null), '');
  assert.equal(lib.codigoValido('abcd ef23'), true);
  assert.equal(lib.codigoValido('ABC'), false);
});

test('paraPost: filtra grupo, antiga, sem texto, eco do robô; monta corpo', () => {
  const agora = 1_800_000_000_000;
  const base = { key: { remoteJid: '5511987654321@s.whatsapp.net', id: 'ID1', fromMe: false },
    messageTimestamp: Math.floor(agora / 1000) - 30, pushName: 'João', message: { conversation: 'oi' } };
  const c = lib.paraPost(base, agora, new Set());
  assert.deepEqual(c, { telefone: '5511987654321', jid: '5511987654321@s.whatsapp.net', nome_contato: 'João',
    texto: 'oi', id_whatsapp: 'ID1', de_mim: false, ts: (Math.floor(agora / 1000) - 30) * 1000 });
  assert.equal(lib.paraPost({ ...base, key: { ...base.key, remoteJid: '1@g.us' } }, agora, new Set()), null);
  assert.equal(lib.paraPost({ ...base, messageTimestamp: Math.floor(agora / 1000) - 11 * 60 }, agora, new Set()), null);
  assert.equal(lib.paraPost({ ...base, message: { audioMessage: {} } }, agora, new Set()), null);
  const meu = { ...base, key: { ...base.key, fromMe: true } };
  assert.equal(lib.paraPost(meu, agora, new Set(['ID1'])), null);
  assert.equal(lib.paraPost(meu, agora, new Set()).de_mim, true);
  const lid = { ...base, key: { remoteJid: '77@lid', id: 'L', senderPn: '5511900001111@s.whatsapp.net' } };
  const cl = lib.paraPost(lid, agora, new Set());
  assert.equal(cl.telefone, '5511900001111');
  assert.equal(cl.jid, '77@lid');
});

test('paraPost: @lid sem número loga e ignora; lembraId guarda só os últimos', () => {
  const agora = 1_800_000_000_000, logs = [];
  const m = { key: { remoteJid: '77@lid', id: 'X' }, messageTimestamp: Math.floor(agora / 1000), message: { conversation: 'oi' } };
  assert.equal(lib.paraPost(m, agora, new Set(), (t) => logs.push(t)), null);
  assert.deepEqual(logs, ['Mensagem de contato sem número visível (ignorada)']);
  const s = new Set();
  for (let i = 0; i < 510; i++) lib.lembraId(s, 'id' + i, 500);
  assert.equal(s.size, 500);
  assert.ok(!s.has('id9') && s.has('id10') && s.has('id509'));
});

test('tsMs aceita Long e string', () => {
  assert.equal(lib.tsMs({ low: 100, high: 0 }), 100000);
  assert.equal(lib.tsMs('200'), 200000);
  assert.equal(lib.tsMs({ toNumber: () => 300 }), 300000);
  assert.equal(lib.tsMs(null), 0);
});

test('esperaLimite por minuto', () => {
  const t = 1_000_000;
  assert.equal(lib.esperaLimite([], 8, t), 0);
  assert.equal(lib.esperaLimite([t - 1000, t - 500], 3, t), 0);
  const w = lib.esperaLimite([t - 10000, t - 5000], 2, t);
  assert.ok(w > 49000 && w <= 50050, String(w));
  assert.equal(lib.esperaLimite([t - 70000, t - 65000], 2, t), 0);
});

test('linhaLog com hora de Brasília, urlFuncao, nome', () => {
  assert.equal(lib.linhaLog('x', new Date('2026-10-28T02:30:00Z')), '[23:30] x');
  assert.equal(lib.urlFuncao('https://abc.supabase.co/'), 'https://abc.supabase.co/functions/v1/robo');
  assert.equal(lib.urlFuncao(), 'https://vsfvwyycacfofnwfpajm.supabase.co/functions/v1/robo');
  assert.equal(lib.NOME_ROBO, 'Motora Teste – Robô');
});

test('montaPagina: QR, conectado, escapa HTML, recarrega 5s', () => {
  const p = montaPagina({ qrDataUrl: 'data:image/png;base64,AAA' });
  assert.match(p, /<img alt="QR do WhatsApp" src="data:image\/png;base64,AAA">/);
  assert.match(p, /http-equiv="refresh" content="5"/);
  assert.match(p, /Motora Teste – Robô/);
  assert.match(montaPagina({ conectado: true, numero: '55<b>' }), /55&lt;b&gt;/);
});

test('nenhuma chave secreta nos arquivos do robô', () => {
  const dir = path.join(__dirname, '..');
  for (const f of ['index.js', 'lib.js', 'pagina.js', 'package.json', 'LEIA-ME.txt', 'INICIAR.bat', 'INICIAR-COM-WINDOWS.bat']) {
    const t = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/AIza|gsk_|service_role|eyJhbGci/.test(t), f);
  }
  for (const f of ['INICIAR.bat', 'INICIAR-COM-WINDOWS.bat']) {
    const t = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(t.includes('\r\n') && !/[^\r]\n/.test(t), f + ' precisa ser CRLF');
  }
});

/* ---------- integração: index.js contra um Supabase FALSO local ---------- */
function servidorFalso(opcoes) {
  const chamadas = [];
  const fila = (opcoes && opcoes.pendentes) || [];
  const srv = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => { corpo += c; });
    req.on('end', () => {
      let j = {}; try { j = JSON.parse(corpo || '{}'); } catch (e) { /* vazio */ }
      chamadas.push({ url: req.url, codigo: req.headers['x-robo-codigo'], corpo: j });
      res.setHeader('Content-Type', 'application/json');
      if (req.headers['x-robo-codigo'] !== 'ABCD2345') { res.statusCode = 401; return res.end(JSON.stringify({ ok: false, erro: 'código inválido' })); }
      if (j.acao === 'pulso') return res.end(JSON.stringify({ ok: true, config_resumo: { ia_ligada: true, modo: 'sugerir',
        pausa_envio_seg: { min: 0, max: 0 }, max_envios_por_minuto: 8, intervalo_pendentes_seg: 1, intervalo_pulso_seg: 1 } }));
      if (j.acao === 'pendentes') return res.end(JSON.stringify({ ok: true, mensagens: fila.splice(0) }));
      if (j.acao === 'enviada') return res.end(JSON.stringify({ ok: true }));
      res.statusCode = 400; res.end(JSON.stringify({ ok: false, erro: 'acao' }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, chamadas, url: 'http://127.0.0.1:' + srv.address().port })));
}

function iniciaRobo(pasta, env, porta) {
  const p = spawn(process.execPath, [path.join(__dirname, '..', 'index.js')], {
    env: Object.assign({}, process.env, { ROBO_PASTA: pasta, ROBO_PORTA: String(porta) }, env),
    stdio: ['pipe', 'pipe', 'pipe']
  });
  p.saida = '';
  p.stdout.on('data', (d) => { p.saida += d; });
  p.stderr.on('data', (d) => { p.saida += d; });
  return p;
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
async function ate(cond, ms) { const fim = Date.now() + ms; while (Date.now() < fim) { if (cond()) return true; await espera(100); } return false; }
function pegaPagina(porta) {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:' + porta + '/', (r) => { let b = ''; r.on('data', (d) => { b += d; }); r.on('end', () => resolve(b)); }).on('error', reject);
  });
}

test('integração: com WhatsApp de teste faz pulso, pega pendentes e confirma envio', { timeout: 30000 }, async () => {
  const f = await servidorFalso({ pendentes: [{ id: 7, telefone: '5511987654321', jid: null, texto: 'Olá!' }] });
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'robo-'));
  fs.writeFileSync(path.join(pasta, 'config.json'), JSON.stringify({ supabase_url: f.url, codigo: 'abcd2345' }));
  const porta = 33000 + Math.floor(Math.random() * 1000);
  const p = iniciaRobo(pasta, { ROBO_WHATSAPP_FALSO: '1' }, porta);
  try {
    const ok = await ate(() => f.chamadas.some((c) => c.corpo.acao === 'enviada'), 15000);
    assert.ok(ok, 'não chegou "enviada". Saída:\n' + p.saida);
    const pulsos = f.chamadas.filter((c) => c.corpo.acao === 'pulso');
    assert.ok(pulsos.length >= 1);
    assert.equal(pulsos[0].url, '/functions/v1/robo');
    assert.equal(pulsos[0].codigo, 'ABCD2345');
    assert.equal(typeof pulsos[0].corpo.versao, 'string');
    assert.ok(pulsos.some((c) => c.corpo.conectado === true));
    const env = f.chamadas.find((c) => c.corpo.acao === 'enviada').corpo;
    assert.deepEqual(env, { acao: 'enviada', id: 7, ok: true, id_whatsapp: 'FALSO1' });
    assert.match(p.saida, /\[\d\d:\d\d\] Pulso enviado/);
    assert.match(p.saida, /Motora Teste – Robô/);
    assert.match(await pegaPagina(porta), /WhatsApp conectado/);
    // continua vivo e pulsando (intervalo 1s vindo do servidor)
    const n = f.chamadas.length;
    await espera(2500);
    assert.ok(f.chamadas.length > n, 'parou de chamar o servidor');
    assert.equal(p.exitCode, null);
  } finally { p.kill(); f.srv.close(); fs.rmSync(pasta, { recursive: true, force: true }); }
});

test('integração: sem WhatsApp não trava, pulsa desconectado e não pede pendentes', { timeout: 30000 }, async () => {
  const f = await servidorFalso();
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'robo-'));
  fs.writeFileSync(path.join(pasta, 'config.json'), JSON.stringify({ supabase_url: f.url, codigo: 'ABCD2345' }));
  const porta = 34000 + Math.floor(Math.random() * 1000);
  const p = iniciaRobo(pasta, { NODE_PATH: '' }, porta);
  try {
    assert.ok(await ate(() => f.chamadas.filter((c) => c.corpo.acao === 'pulso').length >= 2, 15000), p.saida);
    assert.ok(f.chamadas.every((c) => c.corpo.acao !== 'pendentes'));
    assert.ok(f.chamadas.every((c) => c.corpo.conectado === false));
    assert.match(await pegaPagina(porta), /<title>Motora Teste – Robô<\/title>/);
    assert.equal(p.exitCode, null);
  } finally { p.kill(); f.srv.close(); fs.rmSync(pasta, { recursive: true, force: true }); }
});

test('integração: sem config.json pede o código; 401 pede de novo e salva o correto', { timeout: 30000 }, async () => {
  const f = await servidorFalso();
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'robo-'));
  const porta = 35000 + Math.floor(Math.random() * 1000);
  const p = iniciaRobo(pasta, { ROBO_WHATSAPP_FALSO: '1', ROBO_SUPABASE_URL: f.url }, porta);
  try {
    assert.ok(await ate(() => /Digite o código de 8 letras que aparece no app/.test(p.saida), 10000), p.saida);
    p.stdin.write('errado99\n');
    assert.ok(await ate(() => /Código inválido, gere outro no app/.test(p.saida), 10000), p.saida);
    p.stdin.write('abcd-2345\n');
    assert.ok(await ate(() => f.chamadas.some((c) => c.codigo === 'ABCD2345'), 10000), p.saida);
    const cfg = JSON.parse(fs.readFileSync(path.join(pasta, 'config.json'), 'utf8'));
    assert.equal(cfg.codigo, 'ABCD2345');
    assert.equal(cfg.supabase_url, f.url);
  } finally { p.kill(); f.srv.close(); fs.rmSync(pasta, { recursive: true, force: true }); }
});
