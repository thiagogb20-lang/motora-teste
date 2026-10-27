import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  agoraSP, somaDias, diaSemana, dataValida, chaveTelefone, normalizaTelefone, mesmoTelefone, ocupante, validaAcao,
  efeitosDaAcao, precoDe, dentroDoHorarioIA, removeEmojis, normalizaTexto, preencheModelo, minutosAte,
  livresProximosDias, horariosDoDia, fixoDe, conflitoFixo,
} from '../nucleo.ts';
import { db, cfg, sp } from './_dados.ts';

test('agoraSP: 2026-10-28T02:30Z => 27/10 23:30 em SP', () => {
  const a = agoraSP(new Date('2026-10-28T02:30:00Z'));
  assert.equal(a.data, '2026-10-27');
  assert.equal(a.hora, 23);
  assert.equal(a.minuto, 30);
  assert.equal(a.hhmm, '23:30');
  assert.equal(a.dia, 2); // terça
  assert.equal(a.iso, '2026-10-28T02:30:00.000Z');
});

test('agoraSP: meia-noite vira 00, não 24', () => {
  const a = agoraSP(new Date('2026-10-28T03:00:00Z'));
  assert.equal(a.data, '2026-10-28');
  assert.equal(a.hhmm, '00:00');
});

test('somaDias: virada do ano, bissexto e negativos', () => {
  assert.equal(somaDias('2026-12-31', 1), '2027-01-01');
  assert.equal(somaDias('2027-01-01', -1), '2026-12-31');
  assert.equal(somaDias('2028-02-28', 1), '2028-02-29');
  assert.equal(somaDias('2028-02-29', 1), '2028-03-01');
  assert.equal(somaDias('2027-02-28', 1), '2027-03-01');
  assert.equal(somaDias('2026-10-27', 0), '2026-10-27');
  assert.equal(somaDias('2026-10-27', 30), '2026-11-26');
});

test('diaSemana e dataValida', () => {
  assert.equal(diaSemana('2026-10-27'), 2);
  assert.equal(diaSemana('2026-11-01'), 0);
  assert.equal(dataValida('2028-02-29'), true);
  assert.equal(dataValida('2027-02-29'), false);
  assert.equal(dataValida('2026-13-01'), false);
  assert.equal(dataValida('26-10-01'), false);
  assert.equal(dataValida(undefined), false);
});

test('normalizaTelefone e chaveTelefone com e sem o 9', () => {
  assert.equal(normalizaTelefone('(11) 98765-4321'), '5511987654321');
  assert.equal(normalizaTelefone('011 98765-4321'), '5511987654321');
  assert.equal(chaveTelefone('5511987654321'), '551187654321');
  assert.equal(chaveTelefone('551187654321'), '551187654321');
  assert.equal(chaveTelefone('(11) 98765-4321'), '551187654321');
  assert.equal(chaveTelefone('+44 7911 123456'), '447911123456');
  assert.equal(mesmoTelefone('5511987654321', '551187654321'), true);
  assert.equal(mesmoTelefone('5511987654321', '551187654322'), false);
  assert.equal(mesmoTelefone('', ''), false);
});

test('horariosDoDia, fixoDe, conflitoFixo', () => {
  const d = db();
  assert.deepEqual(horariosDoDia(d, '2026-10-28'), [19, 20, 21, 22]);
  assert.deepEqual(horariosDoDia(d, '2026-11-01'), []);
  assert.equal(fixoDe(d, '2026-10-28', 20, 1)?.id, 'ana');
  assert.equal(fixoDe(d, '2026-10-28', 20, 2), null);
  assert.equal(conflitoFixo(d, { dia: 3, hora: 20, campo: 1 }, 'outro')?.id, 'ana');
  assert.equal(conflitoFixo(d, { dia: 3, hora: 20, campo: 1 }, 'ana'), null);
});

test('ocupante: avulso, fixo, livre, não vem', () => {
  const d = db({ excecoes: [{ data: '2026-11-04', hora: 20, campo: 1, clienteId: 'ana' }],
    confirmacoes: { '2026-10-28|20|1': { status: 'manha' } } });
  const r = ocupante(d, '2026-10-30', 19, 2);
  assert.equal(r.tipo, 'avulso');
  const f = ocupante(d, '2026-10-28', 20, 1);
  assert.equal(f.tipo, 'fixo');
  assert.equal(f.tipo === 'fixo' && f.status, 'manha');
  assert.deepEqual(ocupante(d, '2026-10-28', 19, 1), { tipo: 'livre' });
  const nv = ocupante(d, '2026-11-04', 20, 1);
  assert.equal(nv.tipo, 'livre');
  assert.equal(nv.tipo === 'livre' && nv.naoVem?.id, 'ana');
});

test('livresProximosDias: pula horas passadas de hoje e ocupados', () => {
  const d = db();
  const l = livresProximosDias(d, 2, sp('2026-10-27T20:30'));
  // terça 27: grade 20,21,22 -> só 21 e 22 restam
  assert.deepEqual(l.filter((x) => x.data === '2026-10-27').map((x) => x.hora + '/' + x.campo), ['21/1', '21/2', '22/1', '22/2']);
  const qua = l.filter((x) => x.data === '2026-10-28').map((x) => x.hora + '/' + x.campo);
  assert.ok(!qua.includes('20/1')); // fixo da Ana
  assert.ok(!qua.includes('21/2')); // fixo do Caio
  assert.ok(qua.includes('19/1'));
});

test('minutosAte', () => {
  assert.equal(minutosAte(sp('2026-10-27T18:30'), '2026-10-27', 20), 90);
  assert.equal(minutosAte(sp('2026-12-31T23:00'), '2027-01-01', 1), 120);
  assert.ok(minutosAte(sp('2026-10-27T21:00'), '2026-10-27', 20) < 0);
});

/* ---- validaAcao ---- */
const AG = sp('2026-10-27T10:00'); // terça 10h
const permite = { permitir_ia_reservar: true, permitir_ia_cancelar: true, permitir_ia_confirmar: true };

test('validaAcao: nenhuma ok; tipo desconhecido; data inválida; campo/grade', () => {
  const d = db();
  assert.deepEqual(validaAcao(d, { tipo: 'nenhuma' }, null, AG), { ok: true });
  assert.equal(validaAcao(d, { tipo: 'xpto' as any, data: '2026-10-28', hora: 19, campo: 1 }, 'beto', AG).ok, false);
  assert.match(validaAcao(d, { tipo: 'reservar_avulso', data: '2026-02-30', hora: 19, campo: 1 }, 'beto', AG).erro!, /Data inválida/);
  assert.match(validaAcao(d, { tipo: 'reservar_avulso', data: '2026-10-28', hora: 19, campo: 5 }, 'beto', AG).erro!, /Campo inválido/);
  assert.match(validaAcao(d, { tipo: 'reservar_avulso', data: '2026-10-28', hora: 15, campo: 1 }, 'beto', AG).erro!, /Fora do horário/);
  assert.match(validaAcao(d, { tipo: 'reservar_avulso', data: '2026-11-01', hora: 20, campo: 1 }, 'beto', AG).erro!, /Fora do horário/);
});

test('validaAcao: passado', () => {
  const d = db();
  assert.match(validaAcao(d, { tipo: 'reservar_avulso', data: '2026-10-26', hora: 19, campo: 1 }, 'beto', AG).erro!, /já passou/);
  const noite = sp('2026-10-27T20:10');
  assert.match(validaAcao(d, { tipo: 'reservar_avulso', data: '2026-10-27', hora: 20, campo: 1 }, 'beto', noite).erro!, /já passou/);
});

test('validaAcao: antecedência mínima', () => {
  const d = db({}, { antecedencia_minima_reserva_h: 2 });
  const ag = sp('2026-10-27T18:30');
  assert.match(validaAcao(d, { tipo: 'reservar_avulso', data: '2026-10-27', hora: 20, campo: 1 }, 'beto', ag).erro!, /antecedência/);
  assert.equal(validaAcao(d, { tipo: 'reservar_avulso', data: '2026-10-27', hora: 21, campo: 1 }, 'beto', ag).ok, true);
  const d0 = db({}, { antecedencia_minima_reserva_h: 0 });
  assert.equal(validaAcao(d0, { tipo: 'reservar_avulso', data: '2026-10-27', hora: 20, campo: 1 }, 'beto', ag).ok, true);
});

test('validaAcao: max_dias_reserva_frente', () => {
  const d = db({}, { max_dias_reserva_frente: 14 });
  assert.equal(validaAcao(d, { tipo: 'reservar_avulso', data: '2026-11-10', hora: 20, campo: 1 }, 'beto', AG).ok, true); // +14 (terça)
  assert.match(validaAcao(d, { tipo: 'reservar_avulso', data: '2026-11-11', hora: 19, campo: 1 }, 'beto', AG).erro!, /14 dias/);
});

test('validaAcao: avulso não pega fixo nem reservado; pega não-vem', () => {
  const d = db({ excecoes: [{ data: '2026-11-04', hora: 20, campo: 1, clienteId: 'ana' }] });
  assert.match(validaAcao(d, { tipo: 'reservar_avulso', data: '2026-10-28', hora: 20, campo: 1 }, 'beto', AG).erro!, /cliente fixo/);
  assert.match(validaAcao(d, { tipo: 'reservar_avulso', data: '2026-10-30', hora: 19, campo: 2 }, 'ana', AG).erro!, /já está reservado/);
  assert.equal(validaAcao(d, { tipo: 'reservar_avulso', data: '2026-11-04', hora: 20, campo: 1 }, 'beto', AG).ok, true);
});

test('validaAcao: fixo (confirmar / nao_vem)', () => {
  const d = db({ excecoes: [{ data: '2026-11-04', hora: 20, campo: 1, clienteId: 'ana' }] });
  assert.equal(validaAcao(d, { tipo: 'confirmar', data: '2026-10-28', hora: 20, campo: 1 }, 'ana', AG).ok, true);
  assert.equal(validaAcao(d, { tipo: 'nao_vem', data: '2026-10-28', hora: 20, campo: 1 }, 'ana', AG).ok, true);
  assert.match(validaAcao(d, { tipo: 'confirmar', data: '2026-10-28', hora: 20, campo: 1 }, 'beto', AG).erro!, /não é um horário fixo/);
  assert.match(validaAcao(d, { tipo: 'confirmar', data: '2026-11-04', hora: 20, campo: 1 }, 'ana', AG).erro!, /não vem/);
  assert.match(validaAcao(d, { tipo: 'confirmar', data: '2026-10-28', hora: 20, campo: 1 }, null, AG).erro!, /Cliente não identificado/);
});

test('validaAcao: cancelar e cancelamento_regra_h', () => {
  const d = db({}, { cancelamento_regra_h: 24 });
  assert.equal(validaAcao(d, { tipo: 'cancelar', data: '2026-10-30', hora: 19, campo: 2 }, 'beto', AG).ok, true);
  assert.match(validaAcao(d, { tipo: 'cancelar', data: '2026-10-30', hora: 19, campo: 2 }, 'ana', AG).erro!, /Não achei/);
  const perto = sp('2026-10-29T20:00'); // 23h antes
  assert.match(validaAcao(d, { tipo: 'cancelar', data: '2026-10-30', hora: 19, campo: 2 }, 'beto', perto).erro!, /24h/);
  const ok = sp('2026-10-29T19:00'); // exatamente 24h
  assert.equal(validaAcao(d, { tipo: 'cancelar', data: '2026-10-30', hora: 19, campo: 2 }, 'beto', ok).ok, true);
});

test('validaAcao: permissões só valem com porIA', () => {
  const d = db(); // padrões: reservar=false, cancelar=false, confirmar=true
  const res = { tipo: 'reservar_avulso' as const, data: '2026-10-28', hora: 19, campo: 1 };
  assert.match(validaAcao(d, res, 'beto', AG, true).erro!, /permissão para reservar/);
  assert.equal(validaAcao(d, res, 'beto', AG, false).ok, true);
  assert.equal(validaAcao(d, res, 'beto', AG).ok, true);
  const can = { tipo: 'cancelar' as const, data: '2026-10-30', hora: 19, campo: 2 };
  assert.match(validaAcao(d, can, 'beto', AG, true).erro!, /permissão para cancelar/);
  assert.equal(validaAcao(d, can, 'beto', AG, false).ok, true);
  const conf = { tipo: 'confirmar' as const, data: '2026-10-28', hora: 20, campo: 1 };
  assert.equal(validaAcao(d, conf, 'ana', AG, true).ok, true);
  const semConf = db({}, { permitir_ia_confirmar: false });
  assert.match(validaAcao(semConf, conf, 'ana', AG, true).erro!, /permissão para confirmar/);
  assert.match(validaAcao(semConf, { ...conf, tipo: 'nao_vem' }, 'ana', AG, true).erro!, /permissão para confirmar/);
  const tudo = db({}, permite);
  assert.equal(validaAcao(tudo, res, 'beto', AG, true).ok, true);
  assert.equal(validaAcao(tudo, can, 'beto', AG, true).ok, true);
});

/* ---- efeitosDaAcao ---- */
test('efeitosDaAcao: reservar_avulso (origem ia/dono)', () => {
  const d = db({}, permite);
  const a = { tipo: 'reservar_avulso' as const, data: '2026-10-28', hora: 19, campo: 1 };
  const ia = efeitosDaAcao(d, a, 'beto', AG, true);
  assert.equal(ia.ok, true);
  assert.deepEqual(ia.efeitos, [{ op: 'insert', tabela: 'reservas',
    linha: { data: '2026-10-28', hora: 19, campo: 1, cliente_id: 'beto', pago: false, origem: 'ia' } }]);
  assert.equal(efeitosDaAcao(d, a, 'beto', AG, false).efeitos[0].linha!.origem, 'dono');
});

test('efeitosDaAcao: cancelar => delete por id', () => {
  const r = efeitosDaAcao(db({}, permite), { tipo: 'cancelar', data: '2026-10-30', hora: 19, campo: 2 }, 'beto', AG, true);
  assert.deepEqual(r, { ok: true, efeitos: [{ op: 'delete', tabela: 'reservas', filtro: { id: 'r1' } }] });
});

test('efeitosDaAcao: nao_vem => excecoes + confirmacoes', () => {
  const r = efeitosDaAcao(db(), { tipo: 'nao_vem', data: '2026-10-28', hora: 20, campo: 1 }, 'ana', AG, false);
  assert.equal(r.ok, true);
  assert.equal(r.efeitos.length, 2);
  assert.deepEqual(r.efeitos[0], { op: 'upsert', tabela: 'excecoes', linha: { data: '2026-10-28', hora: 20, campo: 1, cliente_id: 'ana' } });
  assert.equal(r.efeitos[1].op, 'upsert');
  assert.equal(r.efeitos[1].tabela, 'confirmacoes');
  assert.equal(r.efeitos[1].linha!.status, 'nao_vem');
  assert.equal(r.efeitos[1].linha!.respondido_em, AG.iso);
});

test('efeitosDaAcao: confirmar => upsert confirmado', () => {
  const r = efeitosDaAcao(db(), { tipo: 'confirmar', data: '2026-10-28', hora: 20, campo: 1 }, 'ana', AG, true);
  assert.equal(r.ok, true);
  assert.equal(r.efeitos.length, 1);
  assert.equal(r.efeitos[0].tabela, 'confirmacoes');
  assert.equal(r.efeitos[0].linha!.status, 'confirmado');
  assert.equal(r.efeitos[0].linha!.cliente_id, 'ana');
});

test('efeitosDaAcao: nenhuma e inválida', () => {
  assert.deepEqual(efeitosDaAcao(db(), { tipo: 'nenhuma' }, null, AG, true), { ok: true, efeitos: [] });
  const r = efeitosDaAcao(db(), { tipo: 'reservar_avulso', data: '2026-10-28', hora: 19, campo: 1 }, 'beto', AG, true);
  assert.equal(r.ok, false);
  assert.deepEqual(r.efeitos, []);
});

/* ---- precoDe ---- */
test('precoDe: base, especiais (primeira que bate, listas vazias valem tudo), null', () => {
  const c = cfg({ precos: { avulso: 150, fixo: 120, observacao: '', especiais: [
    { dias: [6], horas: [], campos: [], avulso: 200, fixo: null },
    { dias: [5], horas: [21, 22], campos: [2], avulso: 180, fixo: 160 },
    { dias: [], horas: [22], campos: [], avulso: 170, fixo: 140 },
  ] } });
  assert.equal(precoDe(c, '2026-10-28', 20, 1, 'avulso'), 150); // quarta
  assert.equal(precoDe(c, '2026-10-28', 20, 1, 'fixo'), 120);
  assert.equal(precoDe(c, '2026-10-31', 8, 1, 'avulso'), 200); // sábado
  assert.equal(precoDe(c, '2026-10-31', 8, 1, 'fixo'), 120); // especial sem fixo => base
  assert.equal(precoDe(c, '2026-10-30', 21, 2, 'avulso'), 180); // sexta campo 2
  assert.equal(precoDe(c, '2026-10-30', 22, 2, 'fixo'), 160); // primeira que bate
  assert.equal(precoDe(c, '2026-10-30', 22, 1, 'fixo'), 140); // campo 1 => terceira
  assert.equal(precoDe(c, '2026-10-30', 21, 1, 'avulso'), 150);
  assert.equal(precoDe(cfg(), '2026-10-28', 20, 1, 'avulso'), null);
});

/* ---- dentroDoHorarioIA ---- */
test('dentroDoHorarioIA: sempre, janelas, janela null, borda', () => {
  assert.equal(dentroDoHorarioIA(cfg(), sp('2026-11-01T03:00')), true); // modo sempre
  const c = cfg({ horario_ia: { ...cfg().horario_ia, modo: 'janelas' } });
  assert.equal(dentroDoHorarioIA(c, sp('2026-11-01T10:00')), false); // domingo null
  assert.equal(dentroDoHorarioIA(c, sp('2026-10-27T10:00')), true);
  assert.equal(dentroDoHorarioIA(c, sp('2026-10-27T07:59')), false);
  assert.equal(dentroDoHorarioIA(c, sp('2026-10-27T08:00')), true);
  assert.equal(dentroDoHorarioIA(c, sp('2026-10-27T23:00')), false);
  assert.equal(dentroDoHorarioIA(c, sp('2026-10-31T12:30')), false); // sábado até 12:00
  const noturna = cfg({ horario_ia: { modo: 'janelas', janelas: { 2: { inicio: '22:00', fim: '02:00' } } } });
  assert.equal(dentroDoHorarioIA(noturna, sp('2026-10-27T23:00')), true);
  assert.equal(dentroDoHorarioIA(noturna, sp('2026-10-27T21:00')), false);
});

/* ---- textos ---- */
test('removeEmojis', () => {
  assert.equal(removeEmojis('Fechado! ⚽👍 Até amanhã 😀'), 'Fechado! Até amanhã');
  assert.equal(removeEmojis('Show 👍🏽!'), 'Show!');
  assert.equal(removeEmojis('Bandeira 🇧🇷 ok'), 'Bandeira ok');
  assert.equal(removeEmojis('família 👨‍👩‍👧 aqui'), 'família aqui');
  assert.equal(removeEmojis('❤️ valeu'), 'valeu');
  assert.equal(removeEmojis('Às 20h, campo 1. R$ 150,00'), 'Às 20h, campo 1. R$ 150,00');
  assert.equal(removeEmojis(null), '');
});

test('normalizaTexto e preencheModelo', () => {
  assert.equal(normalizaTexto('Não É Você, ATENDENTE'), 'nao e voce, atendente');
  assert.equal(preencheModelo('Oi {nome}, {dia} {hora}h no {campo}. {pagamento} {x}', { nome: 'Ana', dia: 'quarta 28/10', hora: 20, campo: 'Campo 1' }),
    'Oi Ana, quarta 28/10 20h no Campo 1. {x}');
  assert.equal(preencheModelo('Vou chamar o {dono}.', { dono: 'Zé' }), 'Vou chamar o Zé.');
});
