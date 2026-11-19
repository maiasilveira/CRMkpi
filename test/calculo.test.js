'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ind = require('../src/modules/indicadores/calculo');
const met = require('../src/modules/metas/calculo');

test('indicador maior_melhor: atingido / atenção / desvio', () => {
  const i = { polaridade: 'maior_melhor', meta: 95, limite_inferior: 92 };
  assert.equal(ind.classificar(i, 96), 'atingido');
  assert.equal(ind.classificar(i, 95), 'atingido');
  assert.equal(ind.classificar(i, 93), 'atencao');
  assert.equal(ind.classificar(i, 91.9), 'desvio');
});

test('indicador menor_melhor: atingido / atenção / desvio', () => {
  const i = { polaridade: 'menor_melhor', meta: 2, limite_superior: 3 };
  assert.equal(ind.classificar(i, 1.5), 'atingido');
  assert.equal(ind.classificar(i, 2.5), 'atencao');
  assert.equal(ind.classificar(i, 3.1), 'desvio');
});

test('indicador faixa: dentro ou fora', () => {
  const i = { polaridade: 'faixa', meta: 4, limite_inferior: 2, limite_superior: 6 };
  assert.equal(ind.classificar(i, 2), 'atingido');
  assert.equal(ind.classificar(i, 6.1), 'desvio');
  assert.equal(ind.classificar(i, 1.9), 'desvio');
});

test('sem range: qualquer valor pior que a meta é desvio', () => {
  assert.equal(ind.classificar({ polaridade: 'maior_melhor', meta: 10, limite_inferior: null }, 9), 'desvio');
});

test('validação de coerência meta x range', () => {
  assert.equal(ind.validarFaixa({ polaridade: 'maior_melhor', meta: 10, limite_inferior: 8 }).length, 0);
  assert.ok(ind.validarFaixa({ polaridade: 'maior_melhor', meta: 10, limite_inferior: 12 }).length);
  assert.ok(ind.validarFaixa({ polaridade: 'menor_melhor', meta: 10, limite_superior: 8 }).length);
  assert.ok(ind.validarFaixa({ polaridade: 'faixa', meta: 10, limite_inferior: null, limite_superior: null }).length);
  assert.ok(ind.validarFaixa({ polaridade: 'faixa', meta: 10, limite_inferior: 1, limite_superior: 5 }).length);
});

test('desvio percentual respeita a polaridade', () => {
  assert.equal(ind.desvioPercentual({ polaridade: 'maior_melhor', meta: 100 }, 110), 10);
  assert.equal(ind.desvioPercentual({ polaridade: 'menor_melhor', meta: 100 }, 110), -10);
});

test('tendência', () => {
  assert.equal(ind.tendencia([1, 2, 3, 4], 'maior_melhor'), 'melhorando');
  assert.equal(ind.tendencia([1, 2, 3, 4], 'menor_melhor'), 'piorando');
  assert.equal(ind.tendencia([5, 5, 5], 'maior_melhor'), 'estavel');
  assert.equal(ind.tendencia([5, 5], 'maior_melhor'), 'indefinida');
});

test('curva de atingimento — maior é melhor', () => {
  const m = { polaridade: 'maior_melhor', gatilho: 80, alvo: 100, superacao: 120, pct_gatilho: 50, pct_superacao: 150 };
  assert.equal(met.atingimento(m, 79), 0);
  assert.equal(met.atingimento(m, 80), 50);
  assert.equal(met.atingimento(m, 90), 75);
  assert.equal(met.atingimento(m, 100), 100);
  assert.equal(met.atingimento(m, 110), 125);
  assert.equal(met.atingimento(m, 200), 150);
  assert.equal(met.atingimento(m, null), null);
});

test('curva de atingimento — menor é melhor (espelhada)', () => {
  const m = { polaridade: 'menor_melhor', gatilho: 4, alvo: 3, superacao: 2, pct_gatilho: 50, pct_superacao: 120 };
  assert.equal(met.atingimento(m, 4.1), 0);
  assert.equal(met.atingimento(m, 4), 50);
  assert.equal(met.atingimento(m, 3.5), 75);
  assert.equal(met.atingimento(m, 3), 100);
  assert.equal(met.atingimento(m, 2.5), 110);
  assert.equal(met.atingimento(m, 1), 120);
});

test('sem superação: teto em 100%', () => {
  const m = { polaridade: 'maior_melhor', gatilho: 10, alvo: 20, superacao: null, pct_gatilho: 0, pct_superacao: 120 };
  assert.equal(met.atingimento(m, 50), 100);
  assert.equal(met.atingimento(m, 15), 50);
});

test('validação de meta', () => {
  const base = { polaridade: 'maior_melhor', gatilho: 1, alvo: 2, superacao: 3, peso: 50, pct_gatilho: 50, pct_superacao: 120 };
  assert.equal(met.validarMeta(base).length, 0);
  assert.ok(met.validarMeta({ ...base, gatilho: 5 }).length);
  assert.ok(met.validarMeta({ ...base, polaridade: 'menor_melhor' }).length);
  assert.ok(met.validarMeta({ ...base, peso: 0 }).length);
});

test('nota do departamento e bônus com nota mínima', () => {
  const itens = [{ peso: 60, atingimento: 100 }, { peso: 40, atingimento: 50 }];
  assert.deepEqual(met.notaDepartamento(itens, { valor_base: 10000, nota_minima: 70 }),
    { peso_total: 100, pesos_validos: true, nota: 80, elegivel: true, bonus: 8000 });
  const r = met.notaDepartamento(itens, { valor_base: 10000, nota_minima: 85 });
  assert.equal(r.elegivel, false);
  assert.equal(r.bonus, 0);
});

test('agregação', () => {
  assert.equal(met.agregar([1, 2, 3], 'soma'), 6);
  assert.equal(met.agregar([1, 2, 3], 'media'), 2);
  assert.equal(met.agregar([1, 2, 3], 'ultimo'), 3);
  assert.equal(met.agregar([], 'soma'), null);
});
