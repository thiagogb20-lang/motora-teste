import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidir } from '../decisao.ts';
import type { DecisaoCtx } from '../decisao.ts';
import type { Cfg } from '../nucleo.ts';
import { cfg, db, sp } from './_dados.ts';

const AG = sp('2026-10-27T10:00');
const BETO = db().clientes[1];

function ctx(c: Cfg = {}, extra: Partial<DecisaoCtx> = {}): DecisaoCtx {
  return {
    cfg: cfg({ ia_ligada: true, ...c }), agora: AG, cliente: BETO,
    contato: { telefone: '5511912345678' }, texto: 'Tem horário quarta?', saidasIaUltimaHora: 0, ehPrimeiraMensagem: false,
    ...extra,
  };
}

test('1. IA desligada', () => {
  assert.deepEqual(decidir(ctx({ ia_ligada: false })), { tipo: 'ignorar', motivo: 'IA desligada' });
});

test('2. texto vazio', () => {
  assert.equal(decidir(ctx({}, { texto: '   ' })).tipo, 'ignorar');
  assert.equal(decidir(ctx({}, { texto: '   ' })).motivo, 'texto vazio');
});

test('3. ignorados (lista, com e sem 9) e cliente.ignorar', () => {
  assert.equal(decidir(ctx({ ignorados: ['551112345678'] })).motivo, 'contato ignorado');
  assert.equal(decidir(ctx({}, { cliente: { ...BETO, ignorar: true } })).motivo, 'contato ignorado');
  assert.equal(decidir(ctx({ atender: 'todos', ignorados: ['(11) 91234-5678'] })).motivo, 'contato ignorado');
});

test('4. so_cadastrados sem cliente', () => {
  assert.equal(decidir(ctx({ atender: 'so_cadastrados' }, { cliente: null })).tipo, 'ignorar');
  assert.equal(decidir(ctx({ atender: 'so_cadastrados' })).tipo, 'ia');
  assert.equal(decidir(ctx({ atender: 'todos' }, { cliente: null })).tipo, 'ia');
});

test('5. pausado (futuro ignora, passado não)', () => {
  assert.deepEqual(decidir(ctx({}, { contato: { telefone: 'x', pausado_ate: '2099-01-01T00:00:00Z' } })), { tipo: 'ignorar', motivo: 'pausado' });
  assert.equal(decidir(ctx({}, { contato: { telefone: 'x', pausado_ate: '2026-10-27T12:00:00Z' } })).tipo, 'ia');
});

test('6. falar com o dono (sem acento/maiúsculas)', () => {
  const d = decidir(ctx({ nome_dono: 'Zé' }, { texto: 'Quero FALAR COM VOCÊ por favor' }));
  assert.equal(d.tipo, 'texto');
  assert.equal(d.texto, 'Certo! Vou chamar o Zé, ele já te responde.');
  assert.equal(d.pausar_min, 240);
  assert.equal(d.aviso?.tipo, 'falar_com_dono');
  const sem = decidir(ctx({ notificar_dono: { falar_com_dono: false } }, { texto: 'chama o atendente' }));
  assert.equal(sem.tipo, 'texto');
  assert.equal(sem.aviso, undefined);
});

test('ordem: pausado vence palavra-chave', () => {
  const d = decidir(ctx({}, { texto: 'falar com o dono', contato: { telefone: 'x', pausado_ate: '2099-01-01T00:00:00Z' } }));
  assert.equal(d.motivo, 'pausado');
});

test('ordem: ignorado vence pausado; IA desligada vence tudo', () => {
  assert.equal(decidir(ctx({ ignorados: ['5511912345678'] }, { contato: { telefone: '5511912345678', pausado_ate: '2099-01-01T00:00:00Z' } })).motivo, 'contato ignorado');
  assert.equal(decidir(ctx({ ia_ligada: false }, { texto: '' })).motivo, 'IA desligada');
});

test('ordem: palavra-chave vence fora do horário', () => {
  const c = { horario_ia: { modo: 'janelas', janelas: { 0: null } } };
  const d = decidir(ctx(c, { agora: sp('2026-11-01T10:00'), texto: 'atendente' }));
  assert.equal(d.motivo, 'falar com o dono');
});

test('7. fora do horário: mensagem (1x a cada 12h) ou ignora', () => {
  const c = { horario_ia: { modo: 'janelas', janelas: { 0: null } }, mensagem_fora_do_horario: 'Domingo fechado, {nome}!' };
  const dom = sp('2026-11-01T10:00');
  const d = decidir(ctx(c, { agora: dom }));
  assert.equal(d.tipo, 'texto');
  assert.equal(d.motivo, 'fora do horário');
  assert.equal(d.texto, 'Domingo fechado, Beto!');
  const recente = decidir(ctx(c, { agora: dom, contato: { telefone: 'x', fora_horario_em: '2026-11-01T08:00:00Z' } }));
  assert.equal(recente.tipo, 'ignorar');
  const antigo = decidir(ctx(c, { agora: dom, contato: { telefone: 'x', fora_horario_em: '2026-10-31T20:00:00Z' } }));
  assert.equal(antigo.tipo, 'texto');
  const semMsg = decidir(ctx({ horario_ia: c.horario_ia }, { agora: dom }));
  assert.deepEqual(semMsg, { tipo: 'ignorar', motivo: 'fora do horário' });
});

test('8. limite por hora: ignora e avisa uma vez', () => {
  const d = decidir(ctx({}, { saidasIaUltimaHora: 10 }));
  assert.equal(d.tipo, 'ignorar');
  assert.equal(d.motivo, 'limite');
  assert.equal(d.aviso?.tipo, 'limite');
  assert.equal(decidir(ctx({}, { saidasIaUltimaHora: 10, avisouLimite: true })).aviso, undefined);
  assert.equal(decidir(ctx({}, { saidasIaUltimaHora: 9 })).tipo, 'ia');
});

test('9. IA, com boas-vindas só na primeira mensagem', () => {
  assert.deepEqual(decidir(ctx()), { tipo: 'ia', motivo: 'ia' });
  const c = { boas_vindas_desconhecidos: 'Olá! Aqui é o {dono}.', nome_dono: 'Zé' };
  assert.equal(decidir(ctx(c, { ehPrimeiraMensagem: true, cliente: null })).boas_vindas, 'Olá! Aqui é o Zé.');
  assert.equal(decidir(ctx(c, { ehPrimeiraMensagem: false })).boas_vindas, undefined);
  assert.equal(decidir(ctx(c, { ehPrimeiraMensagem: true, contato: { telefone: 'x', boas_vindas_em: '2026-10-01T00:00:00Z' } })).boas_vindas, undefined);
});
