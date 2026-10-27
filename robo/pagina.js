'use strict';
/* Página local http://localhost:3210 com o QR do WhatsApp (só escuta em 127.0.0.1). */
const http = require('http');
const { NOME_ROBO } = require('./lib.js');

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function montaPagina(estado) {
  const e = estado || {};
  let corpo;
  if (e.conectado) {
    corpo = '<p class="ok">WhatsApp conectado' + (e.numero ? ' (' + esc(e.numero) + ')' : '') + '.</p>' +
      '<p>Pode fechar esta página. Deixe a janela preta do robô aberta.</p>';
  } else if (e.qrDataUrl) {
    corpo = '<p>No celular, abra o WhatsApp &rsaquo; <b>Aparelhos conectados</b> &rsaquo; <b>Conectar um aparelho</b> e aponte para o código:</p>' +
      '<img alt="QR do WhatsApp" src="' + esc(e.qrDataUrl) + '">';
  } else {
    corpo = '<p>' + esc(e.mensagem || 'Aguardando o WhatsApp...') + '</p>';
  }
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta http-equiv="refresh" content="5"><title>' + esc(NOME_ROBO) + '</title>' +
    '<style>body{font-family:system-ui,sans-serif;background:#f4f6f4;color:#1b1f1b;margin:0;padding:24px;text-align:center}' +
    'h1{font-size:22px}img{width:300px;max-width:90vw;background:#fff;padding:12px;border-radius:12px}' +
    '.ok{color:#1a7f37;font-weight:700;font-size:20px}</style></head><body>' +
    '<h1>' + esc(NOME_ROBO) + '</h1>' + corpo + '</body></html>';
}

function criaServidor(pegaEstado, porta) {
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(montaPagina(pegaEstado()));
  });
  srv.on('error', (err) => {
    console.log('Não consegui abrir a página do QR na porta ' + porta + ' (' + err.code + '). O QR continua aparecendo aqui e no app.');
  });
  srv.listen(porta, '127.0.0.1');
  return srv;
}

module.exports = { montaPagina, criaServidor };
