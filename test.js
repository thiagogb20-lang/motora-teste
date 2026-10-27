/* Testes do núcleo do Campos. Rodar: TZ=America/Sao_Paulo node test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = __dirname;
const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
const m = html.match(/<script id="core">([\s\S]*?)<\/script>/);
if (!m) { console.error('Bloco <script id="core"> não encontrado'); process.exit(1); }
const coreSrc = m[1];
const mod = { exports: {} };
vm.runInNewContext(coreSrc, { module: mod, exports: mod.exports, Date, JSON, Math, Object, Array, String, Number, encodeURIComponent });
const C = mod.exports;

let ok = 0, falhas = 0;
function t(nome, fn) {
  try { fn(); ok++; console.log('  ok  ' + nome); }
  catch (e) { falhas++; console.log('FALHA ' + nome + '\n      ' + (e && e.message)); }
}
function eq(a, b, msg) { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((msg || '') + ' esperado ' + B + ' obtido ' + A); }
function sim(v, msg) { if (!v) throw new Error(msg || 'esperado verdadeiro'); }

function novoDb() {
  const db = C.defaults();
  db.clientes = [
    { id: 'c1', nome: 'João Silva', telefone: '5511912345678', tipo: 'fixo', fixos: [{ dia: 1, hora: 20, campo: 1 }, { dia: 6, hora: 8, campo: 2 }], historico: [] },
    { id: 'c2', nome: 'Pedro', telefone: '5511988887777', tipo: 'avulso', fixos: [], historico: [] },
    { id: 'c3', nome: 'Ana', telefone: '5511977776666', tipo: 'fixo', fixos: [{ dia: 2, hora: 21, campo: 2 }], historico: [] }
  ];
  return db;
}
// 2026-10-26 é segunda-feira
const SEG = new Date(2026, 9, 26, 10, 0);

console.log('TZ=' + process.env.TZ);

/* --- módulo --- */
t('core não usa DOM/window/localStorage', () => {
  sim(!/\b(document|window|localStorage|navigator)\s*\./.test(coreSrc), 'core contém API do navegador');
});
t('core termina exportando module.exports', () => {
  sim(/if \(typeof module !== ?'undefined'\) module\.exports\s*=/.test(coreSrc.replace(/!==/g, '!==')), 'sem export');
  sim(typeof C.ocupante === 'function' && typeof C.montaPrompt === 'function');
});

/* --- datas --- */
t('TZ é America/Sao_Paulo', () => eq(process.env.TZ, 'America/Sao_Paulo'));
t('dataLocal usa data local (23h30 não vira dia seguinte)', () => {
  eq(C.dataLocal(new Date(2026, 9, 26, 23, 30)), '2026-10-26');
  eq(C.dataLocal(new Date(2026, 0, 1, 0, 5)), '2026-01-01');
});
t('parseData meio-dia local', () => { const d = C.parseData('2026-10-26'); eq([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()], [2026, 9, 26, 12]); });
t('somaDias virada de ano', () => { eq(C.somaDias('2026-12-31', 1), '2027-01-01'); eq(C.somaDias('2027-01-01', -1), '2026-12-31'); });
t('somaDias ano bissexto', () => { eq(C.somaDias('2028-02-28', 1), '2028-02-29'); eq(C.somaDias('2028-02-29', 1), '2028-03-01'); eq(C.somaDias('2027-02-28', 1), '2027-03-01'); });
t('somaDias atravessa mês/30 dias', () => { eq(C.somaDias('2026-10-26', 7), '2026-11-02'); eq(C.somaDias('2026-03-01', -1), '2026-02-28'); });
t('diaSemana / nomeDia / formataDataBR', () => {
  eq(C.diaSemana('2026-10-26'), 1); eq(C.diaSemana('2026-11-01'), 0); eq(C.diaSemana('2026-10-31'), 6);
  eq(C.nomeDia('2026-10-26'), 'Seg'); eq(C.nomeDia('2026-10-31'), 'Sáb'); eq(C.formataDataBR('2026-10-05'), '05/10');
});
t('dataValida', () => { sim(C.dataValida('2028-02-29')); sim(!C.dataValida('2027-02-29')); sim(!C.dataValida('26/10/2026')); sim(!C.dataValida(undefined)); });

/* --- grade --- */
t('grade por dia (regras do negócio)', () => {
  const db = C.defaults();
  eq(C.horariosDoDia(db, '2026-10-26'), [19, 20, 21, 22]); // seg
  eq(C.horariosDoDia(db, '2026-10-27'), [20, 21, 22]);     // ter
  eq(C.horariosDoDia(db, '2026-10-28'), [19, 20, 21, 22]); // qua
  eq(C.horariosDoDia(db, '2026-10-29'), [20, 21, 22]);     // qui
  eq(C.horariosDoDia(db, '2026-10-30'), [17, 18, 19, 20, 21, 22]); // sex
  eq(C.horariosDoDia(db, '2026-10-31'), [8, 9]);           // sáb
  eq(C.horariosDoDia(db, '2026-11-01'), []);               // dom fechado
});
t('regras pré-preenchidas citam horários, 2 campos, prioridade, confirmação e preço', () => {
  const r = C.defaults().config.regras;
  ['Segunda e quarta: 19h', 'Terça e quinta: 20h', 'Sexta: 17h', 'Sábado: 8h e 9h', 'Domingo: fechado', '1 hora', '2 campos', 'prioridade', 'livres', 'dia anterior de manhã', 'à tarde', 'NUNCA invente']
    .forEach((p) => sim(r.indexOf(p) >= 0, 'faltou: ' + p));
  eq(C.defaults().config.preco, '');
});
t('fixoDe encontra cliente fixo', () => {
  const db = novoDb();
  eq(C.fixoDe(db, '2026-10-26', 20, 1).id, 'c1');
  eq(C.fixoDe(db, '2026-10-26', 20, 2), null);
  eq(C.fixoDe(db, '2026-11-02', 20, 1).id, 'c1');
});

/* --- ocupante / não vem / avulso --- */
t('ocupante: livre, fixo, status', () => {
  const db = novoDb();
  eq(C.ocupante(db, '2026-10-26', 19, 1).tipo, 'livre');
  const o = C.ocupante(db, '2026-10-26', 20, 1);
  eq([o.tipo, o.cliente.id, o.status], ['fixo', 'c1', 'pendente']);
});
t('marcarNaoVem libera o horário só nessa data', () => {
  const db = novoDb();
  const r = C.marcarNaoVem(db, '2026-10-26', 20, 1, 1);
  sim(r.ok);
  eq(C.ocupante(r.db, '2026-10-26', 20, 1).tipo, 'livre');
  eq(C.ocupante(r.db, '2026-11-02', 20, 1).tipo, 'fixo');
  eq(C.ocupante(db, '2026-10-26', 20, 1).tipo, 'fixo', 'original alterado');
  sim(!C.marcarNaoVem(db, '2026-10-26', 19, 1).ok, 'sem fixo deveria falhar');
});
t('avulso só em horário livre; depois do "não vem" pode', () => {
  const db = novoDb();
  const r1 = C.reservarAvulso(db, { data: '2026-10-26', hora: 20, campo: 1, clienteId: 'c2' });
  sim(!r1.ok, 'reservou em cima de fixo');
  const nv = C.marcarNaoVem(db, '2026-10-26', 20, 1).db;
  const r2 = C.reservarAvulso(nv, { data: '2026-10-26', hora: 20, campo: 1, clienteId: 'c2' }, 5);
  sim(r2.ok, r2.erro);
  const o = C.ocupante(r2.db, '2026-10-26', 20, 1);
  eq([o.tipo, o.cliente.id, o.reserva.pago], ['avulso', 'c2', false]);
  sim(!C.reservarAvulso(r2.db, { data: '2026-10-26', hora: 20, campo: 1, clienteId: 'c2' }).ok, 'reserva dupla');
  sim(!C.reservarAvulso(db, { data: '2026-11-01', hora: 20, campo: 1, clienteId: 'c2' }).ok, 'domingo');
  sim(!C.reservarAvulso(db, { data: '2026-10-26', hora: 18, campo: 1, clienteId: 'c2' }).ok, 'fora da grade');
});
t('ordem: avulso > fixo sem exceção > livre', () => {
  const db = novoDb();
  db.reservas.push({ id: 'rX', data: '2026-10-26', hora: 20, campo: 1, clienteId: 'c2', pago: false, criadoEm: 1 });
  eq(C.ocupante(db, '2026-10-26', 20, 1).tipo, 'avulso');
});
t('desfazerNaoVem bloqueado se houver avulso', () => {
  const db = novoDb();
  const nv = C.marcarNaoVem(db, '2026-10-26', 20, 1).db;
  const d1 = C.desfazerNaoVem(nv, '2026-10-26', 20, 1);
  sim(d1.ok); eq(C.ocupante(d1.db, '2026-10-26', 20, 1).tipo, 'fixo');
  const av = C.reservarAvulso(nv, { data: '2026-10-26', hora: 20, campo: 1, clienteId: 'c2' }).db;
  const d2 = C.desfazerNaoVem(av, '2026-10-26', 20, 1);
  sim(!d2.ok && /avulso/i.test(d2.erro));
});
t('marcarPago e cancelarReserva', () => {
  const db = novoDb();
  const r = C.reservarAvulso(db, { data: '2026-10-27', hora: 20, campo: 1, clienteId: 'c2' });
  const p = C.marcarPago(r.db, r.reserva.id);
  sim(p.ok); eq(p.db.reservas[0].pago, true); eq(r.db.reservas[0].pago, false, 'mutou');
  const c = C.cancelarReserva(p.db, r.reserva.id);
  sim(c.ok); eq(c.db.reservas.length, 0);
  sim(!C.cancelarReserva(db, 'nada').ok);
});
t('confirmação: status e proximoStatus', () => {
  eq(C.proximoStatus('pendente'), 'manha'); eq(C.proximoStatus('manha'), 'tarde'); eq(C.proximoStatus('tarde'), 'tarde');
  const db = novoDb();
  let n = C.registrarEnvio(db, '2026-10-27', 21, 2, 1).db;
  eq(C.statusDe(n, '2026-10-27', 21, 2), 'manha');
  n = C.registrarEnvio(n, '2026-10-27', 21, 2, 2).db;
  eq(C.statusDe(n, '2026-10-27', 21, 2), 'tarde');
  n = C.marcarConfirmado(n, '2026-10-27', 21, 2, 3).db;
  eq(C.ocupante(n, '2026-10-27', 21, 2).status, 'confirmado');
});
t('não confirmação não libera sozinho', () => {
  const db = novoDb();
  const n = C.registrarEnvio(C.registrarEnvio(db, '2026-10-27', 21, 2).db, '2026-10-27', 21, 2).db;
  eq(C.ocupante(n, '2026-10-27', 21, 2).tipo, 'fixo');
});

/* --- livres --- */
t('livresProximosDias exclui horas passadas de hoje', () => {
  const db = novoDb();
  const l = C.livresProximosDias(db, 1, new Date(2026, 9, 26, 20, 30));
  eq(l.map((x) => x.hora + '/' + x.campo), ['21/1', '21/2', '22/1', '22/2']);
  const l2 = C.livresProximosDias(db, 1, new Date(2026, 9, 26, 10, 0));
  eq(l2.length, 7, 'seg tem 8 vagas, 1 do João');
  sim(!l2.some((x) => x.hora === 20 && x.campo === 1));
});
t('livresProximosDias 7 dias: domingo vazio, sábado só 8 e 9', () => {
  const db = novoDb();
  const l = C.livresProximosDias(db, 7, SEG);
  sim(!l.some((x) => x.data === '2026-11-01'), 'domingo');
  const sab = l.filter((x) => x.data === '2026-10-31');
  eq(sab.map((x) => x.hora + '/' + x.campo), ['8/1', '9/1', '9/2']);
  eq(l[0].dia, 'Seg');
});

/* --- conflitos --- */
t('conflitoFixo', () => {
  const db = novoDb();
  eq(C.conflitoFixo(db, { dia: 1, hora: 20, campo: 1 }).id, 'c1');
  eq(C.conflitoFixo(db, { dia: 1, hora: 20, campo: 1 }, 'c1'), null);
  eq(C.conflitoFixo(db, { dia: 1, hora: 20, campo: 2 }), null);
});
t('salvarCliente bloqueia conflito de fixo e normaliza telefone', () => {
  const db = novoDb();
  const r = C.salvarCliente(db, { nome: 'Novo', telefone: '(11) 9 1111-2222', tipo: 'fixo', fixos: [{ dia: 1, hora: 20, campo: 1 }] });
  sim(!r.ok && /outro cliente fixo/.test(r.erro));
  const r2 = C.salvarCliente(db, { nome: ' Novo ', telefone: '(11) 9 1111-2222', tipo: 'fixo', fixos: [{ dia: 1, hora: 21, campo: 1 }] }, 99);
  sim(r2.ok); eq(r2.cliente.telefone, '5511911112222'); eq(r2.cliente.nome, 'Novo'); eq(r2.db.clientes.length, 4); eq(db.clientes.length, 3);
  sim(!C.salvarCliente(db, { nome: 'X', tipo: 'fixo', fixos: [{ dia: 0, hora: 20, campo: 1 }] }).ok, 'domingo na grade');
  sim(!C.salvarCliente(db, { nome: '', tipo: 'avulso' }).ok);
});

/* --- textos --- */
t('normalizaTelefone', () => {
  eq(C.normalizaTelefone('(11) 91234-5678'), '5511912345678');
  eq(C.normalizaTelefone('011 3456-7890'), '551134567890');
  eq(C.normalizaTelefone('+55 11 91234-5678'), '5511912345678');
  eq(C.normalizaTelefone('5511912345678'), '5511912345678');
  eq(C.normalizaTelefone('1234'), '1234');
  eq(C.normalizaTelefone(null), '');
  sim(C.telefoneOk('11912345678')); sim(!C.telefoneOk('91234'));
});
t('preencheModelo', () => {
  eq(C.preencheModelo('Oi {nome}, {dia} {hora}h {campo} {x}', { nome: 'Ana', dia: 'terça 27/10', hora: 21, campo: 'Campo 2' }), 'Oi Ana, terça 27/10 21h Campo 2 {x}');
  eq(C.preencheModelo('{nome}{nome}', { nome: 'A' }), 'AA');
  eq(C.preencheModelo('{hora}', {}), '');
});
t('periodoDoDia', () => { eq(C.periodoDoDia(8), 'manha'); eq(C.periodoDoDia(11), 'manha'); eq(C.periodoDoDia(12), 'tarde'); eq(C.periodoDoDia(17), 'tarde'); eq(C.periodoDoDia(18), 'noite'); });
t('fixosDeAmanha: segunda → terça (Ana)', () => {
  const db = novoDb();
  const l = C.fixosDeAmanha(db, SEG);
  eq(l.map((x) => [x.cliente.id, x.data, x.hora, x.campo, x.status]), [['c3', '2026-10-27', 21, 2, 'pendente']]);
  sim(/Bom dia Ana/.test(C.textoConfirmacao(db, l[0])) && /terça 27\/10/.test(C.textoConfirmacao(db, l[0])));
});
t('fixosDeAmanha: sábado → domingo vazio', () => eq(C.fixosDeAmanha(novoDb(), new Date(2026, 9, 31, 9)), []));
t('fixosDeAmanha: sexta → sábado; mostra nao_vem', () => {
  const db = C.marcarNaoVem(novoDb(), '2026-10-31', 8, 2).db;
  const l = C.fixosDeAmanha(db, new Date(2026, 9, 30, 9));
  eq(l.map((x) => [x.cliente.id, x.hora, x.status]), [['c1', 8, 'nao_vem']]);
});
t('fixosDeAmanha: virada de ano', () => {
  const db = novoDb(); // 2027-01-01 é sexta; 2026-12-31 quinta
  db.clientes[0].fixos.push({ dia: 5, hora: 17, campo: 1 });
  const l = C.fixosDeAmanha(db, new Date(2026, 11, 31, 9));
  eq(l.map((x) => x.data + ' ' + x.hora), ['2027-01-01 17']);
});
t('cortaConversa mantém o FINAL', () => {
  const s = 'a'.repeat(20000) + 'FIM';
  const c = C.cortaConversa(s);
  eq(c.length, 15000); sim(c.endsWith('FIM'));
  eq(C.cortaConversa('abc'), 'abc'); eq(C.cortaConversa('abcdef', 2), 'ef'); eq(C.cortaConversa(null), '');
});

/* --- IA --- */
t('montaPrompt contém regras, preço não inventado, livres, cliente, JSON, hoje', () => {
  const db = novoDb(); db.config.nomeDono = 'Seu Zé';
  db.conversas = [{ nomeArquivo: 'a.txt', texto: 'x'.repeat(9000), importadoEm: 1 }, { nomeArquivo: 'b.txt', texto: 'Fala parceiro', importadoEm: 1 }];
  const p = C.montaPrompt(db, db.clientes[0], SEG);
  ['Seu Zé', 'REGRAS DO NEGÓCIO', 'NUNCA invente preço', 'HORÁRIOS LIVRES', '2026-10-27', 'João Silva', 'fixo', '"resposta"', '"acao"', 'Hoje é segunda, 26/10', 'sábado: 8h, 9h', 'domingo: fechado', 'Fala parceiro']
    .forEach((x) => sim(p.indexOf(x) >= 0, 'faltou ' + x));
  const ex = p.slice(p.indexOf('EXEMPLOS'));
  sim(ex.length < 6800, 'exemplos grandes demais: ' + ex.length);
});
t('montaPrompt com preço informado e sem chaves', () => {
  const db = novoDb(); db.config.preco = 'R$ 150 a hora';
  db.config.ia.geminiKey = 'CHAVE-SECRETA-123'; db.config.ia.groqKey = 'OUTRA-SECRETA-456'; db.config.evo.apikey = 'EVO-SECRETA-789';
  const p = C.montaPrompt(db, null, SEG);
  sim(p.indexOf('R$ 150 a hora') >= 0); sim(p.indexOf('NUNCA invente preço') < 0);
  sim(!/SECRETA/.test(p), 'vazou chave'); sim(p.indexOf('Contato novo') >= 0);
});
t('montaPrompt não oferece horário de fixo nem passado', () => {
  const db = novoDb();
  const p = C.montaPrompt(db, null, new Date(2026, 9, 26, 20, 30));
  const linhaSeg = p.split('\n').find((l) => l.startsWith('- Seg 26/10'));
  sim(linhaSeg && linhaSeg.indexOf('19h') < 0 && linhaSeg.indexOf('20h') < 0 && linhaSeg.indexOf('21h') >= 0, linhaSeg);
});
t('montaContents alterna user/model e termina com a mensagem nova', () => {
  const c = C.montaContents([{ de: 'dono', texto: 'oi?' }, { de: 'cliente', texto: 'a' }, { de: 'cliente', texto: 'b' }, { de: 'dono', texto: 'c' }], 'nova');
  eq(c, [{ role: 'user', parts: [{ text: 'a\nb' }] }, { role: 'model', parts: [{ text: 'c' }] }, { role: 'user', parts: [{ text: 'nova' }] }]);
  eq(C.montaContents([], 'x'), [{ role: 'user', parts: [{ text: 'x' }] }]);
  eq(C.montaContents([{ de: 'cliente', texto: 'a' }], 'b'), [{ role: 'user', parts: [{ text: 'a\nb' }] }]);
});
t('requisição Gemini', () => {
  const r = C.montaReqGemini('gemini-2.5-flash', 'K', 'SYS', [{ role: 'user', parts: [{ text: 'oi' }] }]);
  eq(r.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
  eq(r.init.method, 'POST'); eq(r.init.headers['x-goog-api-key'], 'K');
  const b = JSON.parse(r.init.body);
  eq(b.systemInstruction, { parts: [{ text: 'SYS' }] }); eq(b.generationConfig, { responseMimeType: 'application/json', temperature: 0.4 });
  eq(C.textoGemini({ candidates: [{ content: { parts: [{ text: '{"a"' }, { text: ':1}' }] } }] }), '{"a":1}');
  eq(C.textoGemini({}), '');
});
t('requisição Groq', () => {
  const r = C.montaReqGroq('llama-3.3-70b-versatile', 'G', 'SYS', [{ role: 'user', parts: [{ text: 'oi' }] }, { role: 'model', parts: [{ text: 'olá' }] }, { role: 'user', parts: [{ text: 'e aí' }] }]);
  eq(r.url, 'https://api.groq.com/openai/v1/chat/completions'); eq(r.init.headers.Authorization, 'Bearer G');
  const b = JSON.parse(r.init.body);
  eq(b.model, 'llama-3.3-70b-versatile'); eq(b.response_format, { type: 'json_object' }); eq(b.temperature, 0.4);
  eq(b.messages.map((x) => x.role), ['system', 'user', 'assistant', 'user']);
  eq(C.textoGroq({ choices: [{ message: { content: 'x' } }] }), 'x');
});
t('erroAmigavel', () => {
  sim(/Limite grátis/.test(C.erroAmigavel(429))); sim(/Chave da IA inválida/.test(C.erroAmigavel(400, 'API key not valid')));
  sim(/inválida/.test(C.erroAmigavel(401))); sim(/Sem internet/.test(C.erroAmigavel(0))); sim(/não respondeu/.test(C.erroAmigavel(500)));
});
t('extraiJSON robusto', () => {
  eq(C.extraiJSON('{"resposta":"Oi","acao":{"tipo":"nenhuma"}}'), { resposta: 'Oi', acao: { tipo: 'nenhuma' } });
  eq(C.extraiJSON('```json\n{"resposta":"Oi","acao":{"tipo":"reservar_avulso","data":"2026-10-27","hora":"20","campo":"1"}}\n```'),
    { resposta: 'Oi', acao: { tipo: 'reservar_avulso', data: '2026-10-27', hora: 20, campo: 1 } });
  eq(C.extraiJSON('Claro! {"resposta":"Tem sim"} espero ajudar').resposta, 'Tem sim');
  eq(C.extraiJSON('texto solto'), { resposta: 'texto solto', acao: { tipo: 'nenhuma' } });
  eq(C.extraiJSON('{"resposta":"x","acao":{"tipo":"apagar_tudo"}}').acao, { tipo: 'nenhuma' });
  eq(C.extraiJSON('{quebrado').acao.tipo, 'nenhuma');
  eq(C.extraiJSON(null).resposta, '');
});
t('validaAcao', () => {
  const db = novoDb();
  sim(C.validaAcao(db, { tipo: 'nenhuma' }, 'c2', SEG).ok);
  sim(C.validaAcao(db, { tipo: 'reservar_avulso', data: '2026-10-27', hora: 20, campo: 1 }, 'c2', SEG).ok);
  sim(!C.validaAcao(db, { tipo: 'reservar_avulso', data: '2026-10-27', hora: 21, campo: 2 }, 'c2', SEG).ok, 'fixo da Ana');
  sim(!C.validaAcao(db, { tipo: 'reservar_avulso', data: '2026-11-01', hora: 20, campo: 1 }, 'c2', SEG).ok, 'domingo');
  sim(!C.validaAcao(db, { tipo: 'reservar_avulso', data: '2026-10-25', hora: 20, campo: 1 }, 'c2', SEG).ok, 'passado');
  sim(!C.validaAcao(db, { tipo: 'reservar_avulso', data: '2026-10-26', hora: 19, campo: 1 }, 'c2', new Date(2026, 9, 26, 19, 30)).ok, 'hora passada');
  sim(!C.validaAcao(db, { tipo: 'reservar_avulso', data: '2026-10-27', hora: 20, campo: 3 }, 'c2', SEG).ok, 'campo 3');
  sim(!C.validaAcao(db, { tipo: 'reservar_avulso', data: '2026-13-40', hora: 20, campo: 1 }, 'c2', SEG).ok, 'data inválida');
  sim(C.validaAcao(db, { tipo: 'nao_vem', data: '2026-10-27', hora: 21, campo: 2 }, 'c3', SEG).ok);
  sim(!C.validaAcao(db, { tipo: 'nao_vem', data: '2026-10-27', hora: 21, campo: 2 }, 'c1', SEG).ok, 'fixo de outro');
  sim(C.validaAcao(db, { tipo: 'confirmar', data: '2026-11-02', hora: 20, campo: 1 }, 'c1', SEG).ok);
  sim(!C.validaAcao(db, { tipo: 'cancelar', data: '2026-10-27', hora: 20, campo: 1 }, 'c2', SEG).ok, 'nada a cancelar');
  sim(!C.validaAcao(db, { tipo: 'xyz' }, 'c2', SEG).ok);
});
t('aplicarAcao é imutável e aplica', () => {
  const db = novoDb(); const antes = JSON.stringify(db);
  const n = C.aplicarAcao(db, { tipo: 'reservar_avulso', data: '2026-10-27', hora: 20, campo: 1 }, 'c2', 7);
  eq(JSON.stringify(db), antes, 'db original mudou');
  sim(n !== db); eq(n.reservas.length, 1); eq(n.reservas[0].clienteId, 'c2');
  const n2 = C.aplicarAcao(n, { tipo: 'cancelar', data: '2026-10-27', hora: 20, campo: 1 }, 'c2');
  eq(n2.reservas.length, 0); eq(n.reservas.length, 1);
  const n3 = C.aplicarAcao(db, { tipo: 'nao_vem', data: '2026-10-27', hora: 21, campo: 2 }, 'c3');
  eq(C.ocupante(n3, '2026-10-27', 21, 2).tipo, 'livre');
  const n4 = C.aplicarAcao(db, { tipo: 'nenhuma' }, 'c2');
  sim(n4 !== db); eq(JSON.stringify(n4), antes);
  const n5 = C.aplicarAcao(db, { tipo: 'reservar_avulso', data: '2026-10-27', hora: 21, campo: 2 }, 'c2');
  eq(n5.reservas.length, 0, 'aplicou ação inválida');
});
t('addHistorico guarda só as últimas 20', () => {
  let db = novoDb();
  for (let i = 0; i < 25; i++) db = C.addHistorico(db, 'c2', i % 2 ? 'dono' : 'cliente', 'm' + i, i);
  const h = C.clientePorId(db, 'c2').historico;
  eq(h.length, 20); eq(h[0].texto, 'm5'); eq(h[19].texto, 'm24');
});

/* --- manutenção / backup --- */
t('limpaAntigos', () => {
  const db = novoDb();
  db.reservas = [{ id: 'a', data: '2026-01-01', hora: 20, campo: 1, clienteId: 'c2', pago: true }, { id: 'b', data: '2026-01-01', hora: 20, campo: 2, clienteId: 'c2', pago: false }, { id: 'c', data: '2026-10-20', hora: 20, campo: 1, clienteId: 'c2', pago: true }];
  db.excecoes = [{ data: '2026-10-01', hora: 20, campo: 1, clienteId: 'c1' }, { data: '2026-10-26', hora: 20, campo: 1, clienteId: 'c1' }];
  db.confirmacoes = { '2026-10-01|20|1': { status: 'confirmado' }, '2026-10-27|21|2': { status: 'manha' } };
  const n = C.limpaAntigos(db, SEG);
  eq(n.reservas.map((r) => r.id), ['b', 'c']); eq(n.excecoes.length, 1); eq(Object.keys(n.confirmacoes), ['2026-10-27|21|2']);
  eq(db.reservas.length, 3, 'mutou');
});
t('validaBackup', () => {
  const db = novoDb();
  sim(C.validaBackup(db)); sim(C.validaBackup(JSON.parse(JSON.stringify(db))));
  sim(!C.validaBackup(null)); sim(!C.validaBackup([])); sim(!C.validaBackup({})); sim(!C.validaBackup({ versao: 2, config: {}, clientes: [], reservas: [] }));
  sim(!C.validaBackup({ versao: 1, config: {}, clientes: 'x', reservas: [] }));
  sim(!C.validaBackup({ versao: 1, config: {}, clientes: [{ nome: 1 }], reservas: [] }));
  sim(C.validaBackup({ versao: 1, config: {}, clientes: [], reservas: [] }));
});
t('mesclaDefaults completa campos faltando', () => {
  const m = C.mesclaDefaults({ versao: 1, config: { nomeDono: 'Zé', ia: { geminiKey: 'k' } }, clientes: [] });
  eq(m.config.nomeDono, 'Zé'); eq(m.config.ia.geminiKey, 'k'); eq(m.config.ia.geminiModel, 'gemini-2.5-flash');
  eq(m.config.grade[6], [8, 9]); eq(m.reservas, []); eq(m.confirmacoes, {});
  eq(C.mesclaDefaults('lixo').versao, 1);
});
t('parseGrade', () => { eq(C.parseGrade('20, 19,19 ;22 x 25'), [19, 20, 22]); eq(C.parseGrade(''), []); });

/* --- WhatsApp / Evolution --- */
t('urlWhatsApp', () => eq(C.urlWhatsApp('(11) 91234-5678', 'Oi & tchau?'), 'https://wa.me/5511912345678?text=Oi%20%26%20tchau%3F'));
t('envio Evolution', () => {
  const evo = { url: 'https://evo.exemplo.com/', apikey: 'AK', instancia: 'campos' };
  sim(C.evoConfigurada(evo)); sim(!C.evoConfigurada({ url: 'x', apikey: '', instancia: 'y' }));
  const r = C.montaEnvioEvo(evo, '11912345678', 'oi');
  eq(r.url, 'https://evo.exemplo.com/message/sendText/campos'); eq(r.init.method, 'POST');
  eq(r.init.headers, { apikey: 'AK', 'Content-Type': 'application/json' });
  eq(JSON.parse(r.init.body), { number: '5511912345678', text: 'oi' });
  eq(C.urlConectarEvo(evo), 'https://evo.exemplo.com/instance/connect/campos');
});
t('extraiQR', () => {
  eq(C.extraiQR({ base64: 'data:image/png;base64,AAA' }), { qr: 'data:image/png;base64,AAA' });
  eq(C.extraiQR({ base64: 'AAA' }), { qr: 'data:image/png;base64,AAA' });
  eq(C.extraiQR({ qrcode: { base64: 'BBB' } }), { qr: 'data:image/png;base64,BBB' });
  eq(C.extraiQR({ instance: { state: 'open' } }), { conectado: true });
  eq(C.extraiQR({}), null); eq(C.extraiQR(null), null);
});
t('esc evita XSS', () => eq(C.esc('<img src=x onerror="a()">&\''), '&lt;img src=x onerror=&quot;a()&quot;&gt;&amp;&#39;'));

/* --- arquivos do projeto --- */
t('nenhuma chave no código (AIza / gsk_)', () => {
  ['index.html', 'sw.js', 'manifest.json'].forEach((f) => {
    const s = fs.readFileSync(path.join(DIR, f), 'utf8');
    sim(!/AIza[0-9A-Za-z_-]{10,}/.test(s) && !/gsk_[0-9A-Za-z]{10,}/.test(s), 'chave em ' + f);
  });
});
t('manifest com caminhos relativos e ícones maskable', () => {
  const mf = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
  eq([mf.name, mf.short_name, mf.start_url, mf.scope, mf.display], ['Campos – Agenda e IA', 'Campos', './', './', 'standalone']);
  eq(mf.icons.map((i) => i.sizes + ' ' + i.purpose), ['192x192 any', '512x512 any', '192x192 maskable', '512x512 maskable']);
  sim(mf.icons.every((i) => !i.src.startsWith('/')));
  mf.icons.forEach((i) => sim(fs.existsSync(path.join(DIR, i.src)), 'falta ' + i.src));
});
t('index.html: meta, manifest, sw relativo, sem libs externas', () => {
  sim(/name="viewport"/.test(html) && /name="theme-color"/.test(html) && /rel="manifest" href="manifest.json"/.test(html) && /rel="apple-touch-icon"/.test(html));
  sim(/register\('\.\/sw\.js'\)/.test(html));
  sim(!/<script[^>]+src=/.test(html) && !/<link[^>]+href="https?:/.test(html), 'lib externa');
});
t('sw.js não intercepta outros domínios', () => {
  const s = fs.readFileSync(path.join(DIR, 'sw.js'), 'utf8');
  sim(/url\.origin !== self\.location\.origin\) return/.test(s)); sim(!/['"]\/[a-z]/.test(s.replace(/\.\//g, '')), 'caminho absoluto');
  sim(/caches\.delete/.test(s));
});
t('sw.js v2: versão, network-first para página, cache-first resto, Response.error', () => {
  const s = fs.readFileSync(path.join(DIR, 'sw.js'), 'utf8');
  sim(/const VERSAO = 'campos-v2'/.test(s), 'versão');
  sim(/mude VERSAO a cada publica/.test(s.slice(0, 400)), 'comentário no topo');
  sim(/req\.mode === 'navigate'/.test(s) && /fetch\(req\)\.then\(\(resp\) => guarda\(req, resp\)\)\.catch\(\(\) =>\s*caches\.match/.test(s), 'network-first');
  sim(/caches\.match\(req, \{ ignoreSearch: true \}\)\.then\(\(emCache\) =>\s*emCache \|\|/.test(s), 'cache-first');
  sim((s.match(/Response\.error\(\)/g) || []).length >= 2, 'Response.error');
});
t('textos de ajuda e privacidade no app', () => {
  ['aistudio.google.com/apikey', 'target="_blank"', 'Create API key', 'Exportar conversa', 'Sem mídia', 'Importar conversas',
   'O que este app faz e não faz', 'Não lê sozinho', 'não manda sozinho', 'Conexão automática (avançado, opcional)', 'https://',
   'Google (Gemini) ou ao Groq', 'melhorar os modelos', 'não decora tudo', 'Abra esta aba de manhã e à tarde', 'visibilitychange']
    .forEach((x) => sim(html.indexOf(x) >= 0, 'faltou ' + x));
});
t('erro 404 sugere trocar modelo; evoUrlOk', () => {
  sim(/Troque o modelo em Ajustes/.test(C.erroAmigavel(404)));
  sim(C.evoUrlOk('https://evo.x.com')); sim(!C.evoUrlOk('http://evo.x.com')); sim(!C.evoUrlOk('evo.x.com'));
});
t('removerCliente limpa reservas, exceções e confirmações dele', () => {
  let db = novoDb();
  db = C.registrarEnvio(db, '2026-10-27', 21, 2).db;               // Ana (c3)
  db = C.marcarConfirmado(db, '2026-10-26', 20, 1).db;             // João (c1)
  db = C.marcarNaoVem(db, '2026-10-31', 8, 2).db;                  // João
  db = C.reservarAvulso(db, { data: '2026-10-27', hora: 20, campo: 1, clienteId: 'c1' }).db;
  const n = C.removerCliente(db, 'c1');
  eq(Object.keys(n.confirmacoes), ['2026-10-27|21|2']); eq(n.excecoes, []); eq(n.reservas, []);
  eq(n.clientes.map((c) => c.id), ['c2', 'c3']); eq(db.clientes.length, 3);
});

console.log('\n' + ok + ' passaram / ' + (ok + falhas) + ' total');
process.exit(falhas ? 1 : 0);
