import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montaPrompt, montaContents, montaReqGemini, montaReqGroq, extraiJSON, textoGemini, textoGroq, contentsParaMessages } from '../prompt.ts';
import { db, sp } from './_dados.ts';

const AG = sp('2026-10-27T10:05');

test('montaPrompt: regras ativas em ordem, sem inativas, sem chaves', () => {
  const d = db({}, { nome_dono: 'Zé', nome_negocio: 'Arena Zé', gemini_key: 'AIzaSEGREDO', groq_key: 'gsk_SEGREDO' });
  const p = montaPrompt(d, d.clientes[0], AG);
  assert.ok(p.includes('1. Clientes fixos têm prioridade.'));
  assert.ok(p.includes('2. Domingo fechado.'));
  assert.ok(!p.includes('REGRA_DESLIGADA_XYZ'));
  assert.ok(!p.includes('AIza'));
  assert.ok(!p.includes('gsk_'));
  assert.ok(p.includes('Arena Zé'));
  assert.ok(p.includes('Zé'));
  assert.ok(p.includes('Hoje é terça, 27/10 (2026-10-27), 10:05.'));
  assert.ok(p.includes('NUNCA invente preço'));
  assert.ok(p.includes('"precisa_dono":false'));
  assert.ok(p.includes('Nome: Ana Souza | tipo: fixo'));
  assert.ok(p.includes('Qua 28/10 (2026-10-28) 20h campo 1: status pendente'));
  // ordem das seções
  const idx = ['Hoje é', 'REGRAS DO DONO', 'PREÇOS', 'CAMPOS:', 'HORÁRIOS LIVRES', 'O QUE VOCÊ PODE FAZER', 'CLIENTE DESTA CONVERSA', 'FORMATO:'].map((s) => p.indexOf(s));
  assert.deepEqual([...idx].sort((a, b) => a - b), idx);
  assert.ok(idx.every((i) => i >= 0));
});

test('montaPrompt: preços, pagamento, endereço, permissões, exemplos cortados', () => {
  const d = db({ exemplos: [{ nomeArquivo: 'a.txt', texto: 'x'.repeat(5000) + 'FIM_A' }] }, {
    precos: { avulso: 150, fixo: 120, especiais: [], observacao: 'Colete incluso' },
    pagamento: { texto: 'Pague no dia', pix_chave: 'pix@ze.com', sinal_obrigatorio: false, sinal_valor: null },
    endereco: 'Rua A, 1', link_mapa: 'https://maps.example/x', modo: 'automatico', permitir_ia_reservar: true,
    ia: { exemplos_chars: 100 },
  });
  const p = montaPrompt(d, null, AG);
  assert.ok(p.includes('R$ 150/R$ 120'));
  assert.ok(p.includes('Colete incluso'));
  assert.ok(p.includes('Chave Pix: pix@ze.com'));
  assert.ok(p.includes('Rua A, 1'));
  assert.ok(p.includes('Contato novo'));
  assert.ok(p.includes('pode dizer que está reservado'));
  assert.ok(p.includes('FIM_A'));
  assert.ok(!p.includes('x'.repeat(200)));
  const sem = montaPrompt(db(), null, AG);
  assert.ok(sem.includes('vou anotar e confirmar'));
  assert.ok(sem.includes('Reservar horário avulso: não'));
  assert.ok(!sem.includes('EXEMPLOS'));
});

test('montaPrompt: sem emojis', () => {
  assert.ok(montaPrompt(db({}, { usar_emojis: false }), null, AG).includes('NÃO use emojis'));
});

test('montaContents: junta seguidas, começa em user, inclui a nova', () => {
  const c = montaContents([
    { direcao: 'saida', texto: 'oi antigo' },
    { direcao: 'entrada', texto: 'a' },
    { direcao: 'entrada', texto: 'b' },
    { direcao: 'saida', texto: 'resp' },
  ], 'nova');
  assert.deepEqual(c, [
    { role: 'user', parts: [{ text: 'a\nb' }] },
    { role: 'model', parts: [{ text: 'resp' }] },
    { role: 'user', parts: [{ text: 'nova' }] },
  ]);
  assert.deepEqual(montaContents([{ direcao: 'entrada', texto: 'x' }], 'y'), [{ role: 'user', parts: [{ text: 'x\ny' }] }]);
  assert.deepEqual(montaContents([{ direcao: 'entrada', texto: 'x' }], ''), [{ role: 'user', parts: [{ text: 'x' }] }]);
});

test('montaReqGemini / montaReqGroq', () => {
  const contents = montaContents([], 'oi');
  const g = montaReqGemini('gemini-2.5-flash', 'K', 'SYS', contents, { ia: { temperatura: 0.4, max_tokens: 600 } });
  assert.equal(g.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
  assert.equal(g.init.headers['x-goog-api-key'], 'K');
  assert.deepEqual(JSON.parse(g.init.body), {
    systemInstruction: { parts: [{ text: 'SYS' }] }, contents,
    generationConfig: { temperature: 0.4, maxOutputTokens: 600, responseMimeType: 'application/json' },
  });
  const q = montaReqGroq('llama-3.3-70b-versatile', 'G', 'SYS', contents);
  assert.equal(q.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(q.init.headers.Authorization, 'Bearer G');
  const b = JSON.parse(q.init.body);
  assert.deepEqual(b.response_format, { type: 'json_object' });
  assert.deepEqual(b.messages, contentsParaMessages('SYS', contents));
  assert.equal(b.messages[0].role, 'system');
});

test('textoGemini / textoGroq', () => {
  assert.equal(textoGemini({ candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }] } }] }), 'ab');
  assert.equal(textoGemini({}), '');
  assert.equal(textoGroq({ choices: [{ message: { content: 'x' } }] }), 'x');
  assert.equal(textoGroq(null), '');
});

test('extraiJSON: precisa_dono, cercas, lixo, ação inválida', () => {
  assert.deepEqual(extraiJSON('{"resposta":"oi","acao":{"tipo":"nenhuma"},"precisa_dono":true}'),
    { resposta: 'oi', acao: { tipo: 'nenhuma' }, precisa_dono: true });
  assert.deepEqual(extraiJSON('```json\n{"resposta":"ok","acao":{"tipo":"reservar_avulso","data":"2026-10-28","hora":"19","campo":1}}\n```'),
    { resposta: 'ok', acao: { tipo: 'reservar_avulso', data: '2026-10-28', hora: 19, campo: 1 }, precisa_dono: false });
  assert.deepEqual(extraiJSON('Claro: {"resposta":"x","acao":{"tipo":"voar"}} fim'),
    { resposta: 'x', acao: { tipo: 'nenhuma' }, precisa_dono: false });
  assert.deepEqual(extraiJSON('texto solto'), { resposta: 'texto solto', acao: { tipo: 'nenhuma' }, precisa_dono: false });
  assert.equal(extraiJSON('{"resposta":"a","precisa_dono":"sim"}').precisa_dono, false);
  assert.deepEqual(extraiJSON('{"resposta":"a"}').acao, { tipo: 'nenhuma' });
});
