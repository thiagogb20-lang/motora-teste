import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gerarConfirmacoes, interpretaConfirmacao } from '../confirmacao.ts';
import { db, sp } from './_dados.ts';

// Terça 27/10 -> amanhã quarta 28/10: Ana fixa 20h campo 1 (tem telefone); Caio 21h campo 2 sem telefone (pulado).
const BASE = { confirmacao_auto: true };

test('interpretaConfirmacao: 15+ frases', () => {
  const casos: [string, 'sim' | 'nao' | null][] = [
    ['Sim', 'sim'],
    ['confirmo!', 'sim'],
    ['Confirmado', 'sim'],
    ['vou sim', 'sim'],
    ['Bora!!', 'sim'],
    ['👍', 'sim'],
    ['ok', 'sim'],
    ['Pode deixar', 'sim'],
    ['Não', 'nao'],
    ['nao vou', 'nao'],
    ['Não vamos essa semana', 'nao'],
    ['cancela por favor', 'nao'],
    ['sem jogo amanhã', 'nao'],
    ['Não vai dar', 'nao'],
    ['sim, mas não sei se todos vão', null],
    ['qual o preço?', null],
    ['', null],
    ['vamos sim, fechado', 'sim'],
  ];
  for (const [t, esp] of casos) assert.equal(interpretaConfirmacao(t), esp, t);
});

test('gerarConfirmacoes: manhã', () => {
  const d = db({}, { ...BASE, nome_dono: 'Zé' });
  assert.deepEqual(gerarConfirmacoes(d, sp('2026-10-27T08:59')), []);
  const r = gerarConfirmacoes(d, sp('2026-10-27T09:00'));
  assert.equal(r.length, 1);
  assert.deepEqual({ ...r[0], texto: '' }, { data: '2026-10-28', hora: 20, campo: 1, cliente_id: 'ana', telefone: '5511987654321', etapa: 'manha', texto: '' });
  assert.equal(r[0].texto, 'Bom dia Ana! Confirma o futebol amanhã (quarta 28/10) às 20h no Campo 1?');
});

test('gerarConfirmacoes: tarde (só com manha_em > 60 min)', () => {
  const conf = (manhaEm: string) => ({ '2026-10-28|20|1': { status: 'manha', manhaEm } });
  const d = db({ confirmacoes: conf('2026-10-27T12:00:00Z') }, BASE);
  assert.deepEqual(gerarConfirmacoes(d, sp('2026-10-27T14:59')), []);
  const r = gerarConfirmacoes(d, sp('2026-10-27T15:00'));
  assert.equal(r.length, 1);
  assert.equal(r[0].etapa, 'tarde');
  assert.match(r[0].texto, /^Oi Ana, ainda não tive retorno/);
  const recente = db({ confirmacoes: conf('2026-10-27T17:30:00Z') }, BASE); // 14:30 SP
  assert.deepEqual(gerarConfirmacoes(recente, sp('2026-10-27T15:00')), []);
  const confirmado = db({ confirmacoes: { '2026-10-28|20|1': { status: 'confirmado' } } }, BASE);
  assert.deepEqual(gerarConfirmacoes(confirmado, sp('2026-10-27T15:00')), []);
  const tarde = db({ confirmacoes: { '2026-10-28|20|1': { status: 'tarde' } } }, BASE);
  assert.deepEqual(gerarConfirmacoes(tarde, sp('2026-10-27T16:00')), []);
});

test('gerarConfirmacoes: liberar', () => {
  const lib = { ...BASE, liberar_fixo_sem_resposta: { ligado: true, hora: '20:00' } };
  for (const status of ['manha', 'tarde']) {
    const d = db({ confirmacoes: { '2026-10-28|20|1': { status, manhaEm: '2026-10-27T12:00:00Z' } } }, lib);
    const r = gerarConfirmacoes(d, sp('2026-10-27T20:00'));
    assert.equal(r.length, 1);
    assert.equal(r[0].etapa, 'liberar');
    assert.equal(r[0].cliente_id, 'ana');
  }
  const pend = db({}, lib); // pendente às 20h => manhã, não liberar
  assert.equal(gerarConfirmacoes(pend, sp('2026-10-27T20:00'))[0].etapa, 'manha');
  const desligado = db({ confirmacoes: { '2026-10-28|20|1': { status: 'tarde' } } }, BASE);
  assert.deepEqual(gerarConfirmacoes(desligado, sp('2026-10-27T20:30')), []);
});

test('gerarConfirmacoes: sábado -> domingo vazio', () => {
  const d = db({}, BASE);
  assert.deepEqual(gerarConfirmacoes(d, sp('2026-10-31T10:00')), []);
});

test('gerarConfirmacoes: depois de ultima_hora nada; exceção pulada', () => {
  const d = db({}, BASE);
  assert.equal(gerarConfirmacoes(d, sp('2026-10-27T21:00')).length, 1); // ainda vale no minuto exato
  assert.deepEqual(gerarConfirmacoes(d, sp('2026-10-27T21:01')), []);
  assert.deepEqual(gerarConfirmacoes(d, sp('2026-10-27T23:30')), []);
  const exc = db({ excecoes: [{ data: '2026-10-28', hora: 20, campo: 1, clienteId: 'ana' }] }, BASE);
  assert.deepEqual(gerarConfirmacoes(exc, sp('2026-10-27T10:00')), []);
});

test('gerarConfirmacoes: sexta -> sábado (Ana 8h)', () => {
  const r = gerarConfirmacoes(db({}, BASE), sp('2026-10-30T09:30'));
  assert.equal(r.length, 1);
  assert.equal(r[0].data, '2026-10-31');
  assert.equal(r[0].hora, 8);
});
