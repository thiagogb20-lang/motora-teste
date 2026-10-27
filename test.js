/* Testes do núcleo do Motora Teste (PWA). Rodar: TZ=America/Sao_Paulo node test.js */
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
  sim(typeof C.ocupante === 'function' && typeof C.montaDb === 'function' && typeof C.paraLinhas === 'function');
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
  eq(m.config.nomeDono, 'Zé'); eq(m.config.ia.geminiKey, 'k'); eq(m.config.ia.geminiModel, 'gemini-3.5-flash-lite');
  eq(m.config.grade[6], [8, 9]); eq(m.reservas, []); eq(m.confirmacoes, {});
  eq(C.mesclaDefaults('lixo').versao, 1);
});
t('parseGrade', () => { eq(C.parseGrade('20, 19,19 ;22 x 25'), [19, 20, 22]); eq(C.parseGrade(''), []); });

t('esc evita XSS', () => eq(C.esc('<img src=x onerror="a()">&\''), '&lt;img src=x onerror=&quot;a()&quot;&gt;&amp;&#39;'));

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

/* --- Motora Teste v3: ponte com o Supabase --- */
function antigoCompleto() {
  let db = novoDb();
  db.config.nomeDono = 'Seu Zé'; db.config.preco = 'R$ 150 a hora';
  db.config.regras = 'Regra um\n\n  Regra dois  \r\nRegra três';
  db.config.msgManha = 'Bom dia {nome} (manhã)'; db.config.msgTarde = 'Oi {nome} (tarde)';
  db.config.campos = { 1: 'Society', 2: 'Grama' };
  db.config.grade[6] = [8, 9, 10];
  db.config.ia.geminiKey = 'CHAVE-G'; db.config.ia.groqKey = 'CHAVE-Q'; db.config.ia.geminiModel = 'gemini-x';
  db.conversas = [{ nomeArquivo: 'a.txt', texto: 'oi tudo bem', importadoEm: 1 }];
  db = C.reservarAvulso(db, { data: '2026-10-27', hora: 20, campo: 1, clienteId: 'c2' }, 5).db;
  db = C.marcarPago(db, db.reservas[0].id).db;
  db = C.marcarNaoVem(db, '2026-11-02', 20, 1, 9).db;
  db = C.registrarEnvio(db, '2026-10-27', 21, 2, 9).db;
  return db;
}
t('paraLinhas: formato das linhas (tabelas do contrato)', () => {
  const l = C.paraLinhas(antigoCompleto());
  eq(Object.keys(l).sort(), ['chaves', 'clientes', 'configDados', 'confirmacoes', 'conversas_exemplo', 'excecoes', 'horarios_fixos', 'regras', 'reservas'].sort());
  eq(l.clientes.map((c) => [c.id, c.tipo, c.origem]), [['c1', 'fixo', 'migracao'], ['c2', 'avulso', 'migracao'], ['c3', 'fixo', 'migracao']]);
  eq(Object.keys(l.clientes[0]).sort(), ['id', 'ignorar', 'nome', 'observacao', 'origem', 'telefone', 'tipo']);
  eq(l.horarios_fixos, [{ cliente_id: 'c1', dia: 1, hora: 20, campo: 1 }, { cliente_id: 'c1', dia: 6, hora: 8, campo: 2 }, { cliente_id: 'c3', dia: 2, hora: 21, campo: 2 }]);
  eq(l.reservas.length, 1); eq([l.reservas[0].cliente_id, l.reservas[0].pago, l.reservas[0].origem], ['c2', true, 'migracao']);
  eq(l.excecoes, [{ data: '2026-11-02', hora: 20, campo: 1, cliente_id: 'c1' }]);
  eq(l.confirmacoes.map((c) => [c.data, c.status, c.cliente_id]).sort(), [['2026-10-27', 'manha', 'c3'], ['2026-11-02', 'nao_vem', 'c1']]);
  eq(l.regras, [{ texto: 'Regra um', ativa: true, ordem: 1 }, { texto: 'Regra dois', ativa: true, ordem: 2 }, { texto: 'Regra três', ativa: true, ordem: 3 }]);
  eq(l.configDados.precos, { observacao: 'R$ 150 a hora' });
  eq(l.configDados.modelos, { manha: 'Bom dia {nome} (manhã)', tarde: 'Oi {nome} (tarde)' });
  eq(l.configDados.nome_dono, 'Seu Zé'); eq(l.configDados.ia.gemini_modelo, 'gemini-x');
  eq(l.chaves, { gemini_key: 'CHAVE-G', groq_key: 'CHAVE-Q' });
  sim(!JSON.stringify(l.configDados).includes('CHAVE'), 'chave dentro de configDados');
  eq(l.conversas_exemplo, [{ nome_arquivo: 'a.txt', texto: 'oi tudo bem' }]);
});
t('montaDb(paraLinhas(db)) ida e volta mantém agenda, clientes e config', () => {
  const ant = antigoCompleto(), l = C.paraLinhas(ant);
  const n = C.montaDb({ config: { dados: l.configDados, gemini_key: l.chaves.gemini_key, groq_key: l.chaves.groq_key }, clientes: l.clientes,
    horarios_fixos: l.horarios_fixos, reservas: l.reservas, excecoes: l.excecoes, confirmacoes: l.confirmacoes,
    conversas_exemplo: l.conversas_exemplo.map((c, i) => Object.assign({ id: i + 1 }, c)), regras: l.regras.map((r, i) => Object.assign({ id: i + 1 }, r)) });
  eq(n.clientes.map((c) => [c.id, c.nome, c.telefone, c.tipo, c.fixos]), ant.clientes.map((c) => [c.id, c.nome, c.telefone, c.tipo, c.fixos]));
  eq(n.reservas.map((r) => [r.id, r.data, r.hora, r.campo, r.clienteId, r.pago]), ant.reservas.map((r) => [r.id, r.data, r.hora, r.campo, r.clienteId, r.pago]));
  eq(n.excecoes, ant.excecoes);
  eq(Object.keys(n.confirmacoes).sort(), Object.keys(ant.confirmacoes).sort());
  Object.keys(ant.confirmacoes).forEach((k) => eq(n.confirmacoes[k].status, ant.confirmacoes[k].status, k));
  eq(n.config.campos, { 1: 'Society', 2: 'Grama' }); eq(n.config.grade[6], [8, 9, 10]); eq(n.config.grade[1], [19, 20, 21, 22]);
  eq([n.config.nomeDono, n.config.preco, n.config.msgManha, n.config.msgTarde], ['Seu Zé', 'R$ 150 a hora', 'Bom dia {nome} (manhã)', 'Oi {nome} (tarde)']);
  eq(n.config.regras, 'Regra um\nRegra dois\nRegra três');
  eq([n.config.ia.geminiKey, n.config.ia.groqKey, n.config.ia.geminiModel], ['CHAVE-G', 'CHAVE-Q', 'gemini-x']);
  eq(n.conversas.map((c) => [c.nomeArquivo, c.texto]), [['a.txt', 'oi tudo bem']]);
  // as funções do core continuam valendo sobre o db montado
  for (const [d, h, c] of [['2026-10-27', 20, 1], ['2026-10-27', 21, 2], ['2026-11-02', 20, 1], ['2026-10-26', 20, 1], ['2026-10-31', 8, 2], ['2026-10-31', 9, 1]]) {
    const a = C.ocupante(ant, d, h, c), b = C.ocupante(n, d, h, c);
    eq([b.tipo, b.cliente && b.cliente.id, b.status, b.naoVem && b.naoVem.id], [a.tipo, a.cliente && a.cliente.id, a.status, a.naoVem && a.naoVem.id], d + ' ' + h + ' ' + c);
  }
  eq(C.livresProximosDias(n, 7, SEG), C.livresProximosDias(ant, 7, SEG));
  eq(C.fixosDeAmanha(n, SEG).map((x) => [x.cliente.id, x.status]), C.fixosDeAmanha(ant, SEG).map((x) => [x.cliente.id, x.status]));
});
t('paraLinhas(montaDb(linhas)) volta às mesmas linhas', () => {
  const l1 = C.paraLinhas(antigoCompleto());
  const d = C.montaDb({ configDados: l1.configDados, clientes: l1.clientes, horarios_fixos: l1.horarios_fixos, reservas: l1.reservas,
    excecoes: l1.excecoes, confirmacoes: l1.confirmacoes, conversas_exemplo: l1.conversas_exemplo, regras: l1.regras, config: { dados: l1.configDados, gemini_key: 'CHAVE-G', groq_key: 'CHAVE-Q' } });
  const l2 = C.paraLinhas(d);
  ['clientes', 'horarios_fixos', 'reservas', 'excecoes', 'conversas_exemplo', 'regras', 'chaves'].forEach((k) => eq(l2[k], l1[k], k));
  eq(l2.confirmacoes.sort((a, b) => a.data.localeCompare(b.data)), l1.confirmacoes.sort((a, b) => a.data.localeCompare(b.data)));
  eq(l2.configDados.grade, l1.configDados.grade); eq(l2.configDados.campos, l1.configDados.campos); eq(l2.configDados.modelos, l1.configDados.modelos);
});
t('paraLinhas: dados ruins/duplicados não quebram o banco', () => {
  const ant = novoDb();
  ant.clientes.push({ id: 'c1', nome: 'Dup', tipo: 'avulso' });                                   // id repetido
  ant.clientes.push({ id: 'c9', nome: '', telefone: '(11) 91234-5678', tipo: 'fixo', fixos: [{ dia: 1, hora: 20, campo: 1 }, { dia: 9, hora: 30, campo: 0 }] }); // tel repetido, slot repetido, inválido
  ant.reservas.push({ id: 'rz', data: '2026-13-01', hora: 20, campo: 1, clienteId: 'c2' }, { id: 'ry', data: '2026-10-27', hora: 20, campo: 1, clienteId: 'nao-existe' });
  ant.confirmacoes['lixo'] = { status: 'x' };
  const l = C.paraLinhas(ant);
  eq(l.clientes.map((c) => c.id), ['c1', 'c2', 'c3', 'c9']);
  eq(l.clientes[3].nome, 'Sem nome'); eq(l.clientes[3].telefone, '', 'telefone duplicado vira vazio (índice único)');
  eq(l.horarios_fixos.filter((h) => h.cliente_id === 'c9'), []);
  eq(l.reservas, []); eq(l.confirmacoes, []);
  eq(C.paraLinhas(null).clientes, []);
  eq(C.paraLinhas({ versao: 1, config: { regras: '' }, clientes: [], reservas: [] }).regras, []);
});
t('ajustaMigracao: usa o id do banco quando o telefone já existe e não repete regras', () => {
  const l = C.paraLinhas(antigoCompleto());
  const a = C.ajustaMigracao(l, { clientes: [{ id: 'uuid-1', telefone: '5511912345678' }], regras: [{ texto: 'Regra dois', ordem: 7 }], conversas_exemplo: [{ nome_arquivo: 'a.txt' }] });
  sim(!a.clientes.some((c) => c.id === 'c1'), 'c1 deveria sumir');
  sim(a.horarios_fixos.filter((h) => h.cliente_id === 'uuid-1').length === 2, 'fixos para o id do banco');
  eq(a.excecoes[0].cliente_id, 'uuid-1');
  eq(a.regras, [{ texto: 'Regra um', ativa: true, ordem: 8 }, { texto: 'Regra três', ativa: true, ordem: 9 }]);
  eq(a.conversas_exemplo, []); eq(l.clientes.length, 3, 'mutou a entrada');
});
t('montaDb vazio usa a config padrão do contrato', () => {
  const d = C.montaDb({});
  eq([d.cfg.ia_ligada, d.cfg.modo, d.cfg.atender, d.cfg.permitir_ia_reservar], [false, 'sugerir', 'todos_menos_ignorados', false]);
  eq(d.config.grade[5], [17, 18, 19, 20, 21, 22]); eq(d.config.campos, { 1: 'Campo 1', 2: 'Campo 2' });
  eq(d.cfg.horario_ia.janelas['0'], null); eq(d.cfg.ia.gemini_modelo, 'gemini-3.5-flash-lite');
  eq(d.clientes, []); eq(C.horariosDoDia(d, '2026-11-01'), []);
  eq(Object.keys(C.CFG_PADRAO).length, 41);
});
t('montaDb: regras em ordem, só ativas no texto; cliente avulso não leva fixos', () => {
  const d = C.montaDb({ regras: [{ id: 2, texto: 'B', ativa: true, ordem: 2 }, { id: 1, texto: 'A', ativa: true, ordem: 1 }, { id: 3, texto: 'C', ativa: false, ordem: 3 }],
    clientes: [{ id: 'x', nome: 'X', telefone: '', tipo: 'avulso' }], horarios_fixos: [{ cliente_id: 'x', dia: 1, hora: 20, campo: 1 }] });
  eq(d.regras.map((r) => r.texto), ['A', 'B', 'C']); eq(d.config.regras, 'A\nB'); eq(d.clientes[0].fixos, []);
});
t('mescla/mesclaCfg: merge profundo, listas substituem, janela null preservada', () => {
  const m = C.mescla({ a: { b: 1, c: [1, 2] }, d: 1 }, { a: { c: [3] }, e: null });
  eq(m, { a: { b: 1, c: [3] }, d: 1, e: null });
  const c = C.mesclaCfg({ horario_ia: { janelas: { 1: null } }, precos: { avulso: 150 } });
  eq(c.horario_ia.janelas['1'], null); eq(c.horario_ia.janelas['2'], { inicio: '08:00', fim: '23:00' });
  eq([c.precos.avulso, c.precos.fixo, c.precos.especiais], [150, null, []]);
  eq(C.CFG_PADRAO.precos.avulso, null, 'mutou o padrão');
});
t('pegaCaminho/poeCaminho/horaOk/parseNums/numOuNulo', () => {
  const o = {}; C.poeCaminho(o, 'a.b.c', 5); eq(o, { a: { b: { c: 5 } } }); eq(C.pegaCaminho(o, 'a.b.c'), 5); eq(C.pegaCaminho(o, 'x.y'), undefined);
  sim(C.horaOk('09:00') && C.horaOk('23:59')); sim(!C.horaOk('24:00') && !C.horaOk('9:00') && !C.horaOk(''));
  eq(C.parseNums('6, 0, 9, 6', 0, 6), [0, 6]);
  eq([C.numOuNulo('R$ 150,50'), C.numOuNulo(''), C.numOuNulo('abc'), C.numOuNulo('0')], [150.5, null, null, 0]);
});
t('chaveTelefone com e sem o 9; formataTel', () => {
  eq(C.chaveTelefone('5511912345678'), '551112345678'); eq(C.chaveTelefone('551112345678'), '551112345678');
  eq(C.chaveTelefone('(11) 91234-5678'), C.chaveTelefone('55 11 1234-5678'));
  eq(C.formataTel('5511912345678'), '(11) 91234-5678'); eq(C.formataTel('551134567890'), '(11) 3456-7890'); eq(C.formataTel(''), '');
});
t('estadoRobo: online < 150s, qr, offline, nunca', () => {
  const T = Date.parse('2026-10-27T12:00:00Z');
  eq(C.estadoRobo(null, T), 'nunca'); eq(C.estadoRobo({ online_em: null }, T), 'nunca');
  eq(C.estadoRobo({ online_em: '2026-10-27T11:58:00Z', conectado: true }, T), 'online');
  eq(C.estadoRobo({ online_em: '2026-10-27T11:57:00Z', conectado: true }, T), 'offline');
  eq(C.estadoRobo({ online_em: '2026-10-27T11:59:30Z', conectado: false, qr: 'data:image/png;base64,AA' }, T), 'qr');
  eq(C.estadoRobo({ online_em: '2026-10-27T11:59:30Z', conectado: false, qr: null }, T), 'conectando');
});
t('qrSeguro só aceita imagem data:', () => {
  eq(C.qrSeguro('data:image/png;base64,iVBOR+/='), 'data:image/png;base64,iVBOR+/=');
  eq(C.qrSeguro('javascript:alert(1)'), ''); eq(C.qrSeguro('data:image/png;base64,AA" onerror="x'), ''); eq(C.qrSeguro('2@abc,def'), ''); eq(C.qrSeguro(null), '');
});
t('contadoresHoje', () => {
  const hoje = C.dataLocal(new Date(2026, 9, 27, 10));
  const iso = (h) => new Date(2026, 9, 27, h).toISOString(), ontem = new Date(2026, 9, 26, 22).toISOString();
  const c = C.contadoresHoje([{ direcao: 'entrada', status: 'recebida', criada_em: iso(9) }, { direcao: 'entrada', status: 'recebida', criada_em: ontem },
    { direcao: 'saida', status: 'enviada', criada_em: iso(9), enviada_em: iso(9) }, { direcao: 'saida', status: 'sugerida', criada_em: iso(9) }],
    [{ criadoEm: iso(8) }, { criadoEm: ontem }, { criadoEm: null }], hoje);
  eq(c, { recebidas: 1, respondidas: 1, reservas: 1, sugeridas: 1 });
});
t('pausaAte: 1h/4h/24h/até eu tirar; estaPausado', () => {
  const T = Date.parse('2026-10-27T12:00:00Z');
  eq(C.pausaAte('1h', T), '2026-10-27T13:00:00.000Z'); eq(C.pausaAte('4h', T), '2026-10-27T16:00:00.000Z'); eq(C.pausaAte('24h', T), '2026-10-28T12:00:00.000Z');
  sim(C.pausaAte('sempre', T).startsWith('2099-01-01')); eq(C.pausaAte('x', T), null);
  sim(C.estaPausado({ pausado_ate: '2099-01-01T00:00:00Z' }, T)); sim(!C.estaPausado({ pausado_ate: '2026-10-27T11:00:00Z' }, T)); sim(!C.estaPausado({}, T));
});
t('descreveAcao, nomeContato, textoDaConfirmacao com placeholders novos', () => {
  const d = C.montaDb({ clientes: [{ id: 'a', nome: 'Ana Souza', telefone: '5511977776666', tipo: 'fixo' }], horarios_fixos: [{ cliente_id: 'a', dia: 2, hora: 21, campo: 2 }],
    config: { dados: { nome_dono: 'Zé', modelos: { manha: 'Oi {nome}, {dia} {hora}h {campo}. {dono}' } } } });
  eq(C.descreveAcao(d, { tipo: 'reservar_avulso', data: '2026-10-27', hora: 20, campo: 1 }), 'Reservar avulso: Ter 27/10 · 20h · Campo 1');
  eq(C.descreveAcao(d, { tipo: 'nenhuma' }), ''); eq(C.descreveAcao(d, null), '');
  eq(C.nomeContato(d, { telefone: '55119', cliente_id: 'a' }), 'Ana Souza'); eq(C.nomeContato(d, { telefone: '55119', nome_contato: 'Zezinho' }), 'Zezinho');
  const it = C.fixosDeAmanha(d, SEG)[0];
  eq(C.textoDaConfirmacao(d, it), 'Oi Ana, terça 27/10 21h Campo 2. Zé');
  eq(C.preencheModelo('{dono} {pagamento} {endereco}', { dono: 'Z', pagamento: 'Pix', endereco: 'Rua 1' }), 'Z Pix Rua 1');
});

/* --- arquivos do projeto --- */
function arquivos(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === 'sessao' || e.name === 'testes' ? [] : arquivos(p);
    return [p];
  });
}
t('nenhuma chave secreta (AIza / gsk_ / service_role) no app nem no robô', () => {
  const lista = ['index.html', 'sw.js', 'manifest.json'].map((f) => path.join(DIR, f)).concat(arquivos(path.join(DIR, 'robo')));
  lista.forEach((f) => {
    const s = fs.readFileSync(f, 'utf8');
    sim(!/AIza/.test(s) && !/gsk_/.test(s) && !/service_role/.test(s), 'segredo em ' + path.relative(DIR, f));
  });
});
t('index.html: supabase-js do jsDelivr, URL e chave publicável, função robo', () => {
  sim(html.includes('<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js" crossorigin="anonymous"></script>'), 'versão exata + crossorigin');
  sim(html.includes("SB_URL = 'https://vsfvwyycacfofnwfpajm.supabase.co'") && /SB_KEY = 'sb_publishable_[A-Za-z0-9_-]+'/.test(html));
  sim(/functions\.invoke\('robo'/.test(html) && html.includes("acao: 'aprovar'") && html.includes("acao: 'simular'"));
  sim(html.includes("rpc('reivindicar_dono')") && html.includes("rpc('gerar_codigo_robo')"));
  sim(html.includes('Esta conta não é a do dono (ou o e-mail ainda não foi confirmado)') && html.includes('Criar minha conta'));
  sim(html.includes('Enviamos um e-mail de confirmação. Abra o e-mail, toque no link e depois entre aqui.'));
  sim(html.includes('não manda confirmação aos fixos e cancela as mensagens que estavam na fila'), 'texto IA desligada');
  sim(html.includes("true, TX_RISCO);") && /Testar a IA<\/b>\.<\/p>' \+ TX_RISCO/.test(html), 'risco no automático e no guia');
  sim(html.includes('p.liberar_fixo_sem_resposta.hora > p.confirmacao_ultima_hora'), 'validação liberar <= última');
  ['mensagens', 'robo', 'avisos'].forEach((t2) => sim(html.includes("table: '" + t2 + "'"), 'realtime ' + t2));
  sim(html.includes('30000') && html.includes('visibilitychange'), 'polling/visibilitychange');
  sim(html.includes("localStorage.getItem(CHAVE_LS)") && html.includes("CHAVE_LS = 'campos_v1'") && html.includes('Trazer meus dados deste celular'));
  sim(!/<link[^>]+href="https?:/.test(html), 'css externo');
  const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((x) => x[1]);
  eq(srcs, ['https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js']);
});
t('index.html: nome Motora Teste, meta, manifest, sw relativo', () => {
  sim(/<title>Motora Teste<\/title>/.test(html));
  sim(/name="viewport"/.test(html) && /name="theme-color"/.test(html) && /rel="manifest" href="manifest.json"/.test(html) && /rel="apple-touch-icon"/.test(html));
  sim(/register\('\.\/sw\.js'\)/.test(html));
  sim(!/href="\/[a-z]/.test(html) && !/src="\/[a-z]/.test(html), 'caminho absoluto');
});
t('index.html: telas e textos do contrato', () => {
  ['IA LIGADA', 'IA DESLIGADA', 'Sugerir', 'Automático', 'Escaneie o QR', 'Robô online', 'Robô offline', 'Sugestões aguardando', 'Avisos',
   'Aprovar', 'Editar', 'Descartar', 'Responder pelo robô', 'Pausar IA neste contato', 'Por 1 hora', 'Por 4 horas', 'Por 24 horas', 'Até eu tirar',
   'Adicionar regra', 'Testar a IA', '↑', '↓', 'Gerar código', 'INICIAR.bat', 'Aparelhos conectados', 'Negócio', 'Preços', 'Pagamento',
   'Atendimento da IA', 'Horários da IA', 'Quem atender', 'Reservas pela IA', 'Confirmação automática', 'Modelos de mensagem', 'Avisos para você',
   'Grade e campos', 'Chaves da IA', 'Exemplos de conversa', 'aistudio.google.com/apikey', 'Create API key', 'Como começar', 'Exportar conversa', 'Sem mídia',
   'não oficial', 'bloquear o número', 'Privacidade', 'melhorar os modelos', 'gemini_key', 'groq_key', "'2099-01-01", 'nao_lidas: 0']
    .forEach((x) => sim(html.includes(x), 'faltou ' + x));
});
t('Ajustes cobre todas as chaves de config.dados', () => {
  const ui = html.slice(html.indexOf('/* ===== Interface'));
  const folhas = [];
  (function anda(o, pre) {
    Object.keys(o).forEach((k) => {
      const v = o[k], cam = pre ? pre + '.' + k : k;
      if (v && typeof v === 'object' && !Array.isArray(v) && !['janelas', 'grade', 'campos'].includes(k)) anda(v, cam); else folhas.push(cam);
    });
  })(C.CFG_PADRAO, '');
  const fora = ['versao', 'ia_ligada', 'modo'];
  const faltam = folhas.filter((k) => !fora.includes(k) && !ui.includes("'" + k + "'") && !(k === 'grade' && ui.includes('grade.')) && !(k === 'campos' && ui.includes('p.campos'))
    && !(k === 'horario_ia.janelas' && ui.includes('horario_ia.janelas')) && !(k === 'precos.especiais' && ui.includes('precos.especiais')));
  eq(faltam, [], 'chaves sem campo em Ajustes');
  sim(ui.includes('salvaCfg({ ia_ligada') && ui.includes("salvaCfg({ modo: 'automatico' })"));
});
t('UI escapa HTML: todo innerHTML vem de esc() ou texto fixo (amostragem)', () => {
  const ui = html.slice(html.indexOf('/* ===== Interface'));
  ['esc(m.texto)', 'esc(a.texto)', 'esc(r.texto)', 'esc(c.nome)', 'esc(nomeContato(db, c))', 'esc(r.resposta)', 'esc(est.codigo)', 'esc(img)', 'esc(cv.nomeArquivo)']
    .forEach((x) => sim(ui.includes(x), 'faltou ' + x));
  sim(!/innerHTML\s*=\s*[^;]*\+\s*(m|a|r|c)\.(texto|nome)\b/.test(ui), 'texto cru em innerHTML');
});
t('manifest Motora Teste com caminhos relativos e ícones maskable', () => {
  const mf = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
  eq([mf.name, mf.short_name, mf.start_url, mf.scope, mf.display], ['Motora Teste – Campos e IA', 'Motora Teste', './', './', 'standalone']);
  eq(mf.icons.map((i) => i.sizes + ' ' + i.purpose), ['192x192 any', '512x512 any', '192x192 maskable', '512x512 maskable']);
  sim(mf.icons.every((i) => !i.src.startsWith('/')));
  mf.icons.forEach((i) => sim(fs.existsSync(path.join(DIR, i.src)), 'falta ' + i.src));
});
t('sw.js v4: nunca supabase.co/Gemini/Groq; cache só do próprio site e do supabase-js', () => {
  const s = fs.readFileSync(path.join(DIR, 'sw.js'), 'utf8');
  sim(/const VERSAO = 'motora-teste-v4'/.test(s), 'versão');
  sim(s.includes("const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js'") && s.includes('url.href === LIB'), 'mesma URL fixa');
  sim(/mude VERSAO a cada publica/.test(s.slice(0, 400)), 'comentário no topo');
  sim(/supabase\\\.co/.test(s) && /googleapis\\\.com/.test(s) && /groq\\\.com/.test(s), 'lista NUNCA');
  sim(/if \(NUNCA\.test\(url\.hostname\)\) return;/.test(s));
  sim(/url\.origin !== self\.location\.origin && !ehCdn\) return/.test(s));
  sim(!/['"]\/[a-z]/.test(s.replace(/\.\//g, '')), 'caminho absoluto');
  sim(/caches\.delete/.test(s) && /req\.method !== 'GET'\) return/.test(s));
  sim(/req\.mode === 'navigate'/.test(s) && (s.match(/Response\.error\(\)/g) || []).length >= 2);
  // simula a decisão do SW
  const NUNCA = new RegExp(s.match(/const NUNCA = \/(.+)\/;/)[1]);
  ['vsfvwyycacfofnwfpajm.supabase.co', 'generativelanguage.googleapis.com', 'api.groq.com'].forEach((h) => sim(NUNCA.test(h), h));
  sim(!NUNCA.test('cdn.jsdelivr.net') && !NUNCA.test('thiagogb20-lang.github.io'));
});

console.log('\n' + ok + ' passaram / ' + (ok + falhas) + ' total');
process.exit(falhas ? 1 : 0);
