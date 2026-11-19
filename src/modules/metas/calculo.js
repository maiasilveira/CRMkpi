'use strict';
// Regras puras de apuração de metas bonificáveis.

/**
 * % de atingimento por curva linear em 3 pontos:
 *   abaixo do gatilho → 0 | gatilho → pct_gatilho | alvo → 100 | superação → pct_superacao (teto)
 * Para "menor_melhor" a curva é espelhada (gatilho > alvo > superação).
 */
function atingimento(meta, valor) {
  if (valor === null || valor === undefined) return null;
  const { gatilho: g, alvo: a, superacao: s } = meta;
  const pg = meta.pct_gatilho ?? 50;
  const ps = meta.pct_superacao ?? 120;
  const menor = meta.polaridade === 'menor_melhor';
  // Converte para eixo "maior é melhor"
  const f = (x) => (menor ? -x : x);
  const v = f(valor); const G = f(g); const A = f(a); const S = s === null || s === undefined ? null : f(s);

  if (v < G) return 0;
  if (v < A) return A === G ? 100 : pg + ((v - G) / (A - G)) * (100 - pg);
  if (S === null || S === A) return 100;
  if (v < S) return 100 + ((v - A) / (S - A)) * (ps - 100);
  return ps;
}

function validarMeta(m) {
  const erros = [];
  const menor = m.polaridade === 'menor_melhor';
  const ok = (x, y) => (menor ? x >= y : x <= y);
  if (!ok(m.gatilho, m.alvo)) erros.push(menor ? 'Gatilho deve ser ≥ alvo (menor é melhor)' : 'Gatilho deve ser ≤ alvo');
  if (m.superacao !== null && m.superacao !== undefined && !ok(m.alvo, m.superacao))
    erros.push(menor ? 'Superação deve ser ≤ alvo (menor é melhor)' : 'Superação deve ser ≥ alvo');
  if (m.peso <= 0 || m.peso > 100) erros.push('Peso deve estar entre 0 e 100');
  if (m.pct_gatilho < 0 || m.pct_gatilho > 100) erros.push('% no gatilho deve estar entre 0 e 100');
  if (m.pct_superacao < 100) erros.push('% na superação deve ser ≥ 100');
  return erros;
}

/** Agrega uma lista de valores (ordenados por período). */
function agregar(valores, tipo) {
  if (!valores.length) return null;
  if (tipo === 'soma') return valores.reduce((a, b) => a + b, 0);
  if (tipo === 'media') return valores.reduce((a, b) => a + b, 0) / valores.length;
  return valores[valores.length - 1];
}

/** Nota ponderada do departamento e bônus resultante. */
function notaDepartamento(itens, { valor_base = 0, nota_minima = 0 } = {}) {
  const pesoTotal = itens.reduce((s, i) => s + i.peso, 0);
  const nota = itens.reduce((s, i) => s + (i.peso * (i.atingimento ?? 0)) / 100, 0);
  const elegivel = nota >= nota_minima;
  return {
    peso_total: pesoTotal,
    pesos_validos: Math.abs(pesoTotal - 100) < 0.001,
    nota: Math.round(nota * 100) / 100,
    elegivel,
    bonus: elegivel ? Math.round(valor_base * nota) / 100 : 0,
  };
}

module.exports = { atingimento, validarMeta, agregar, notaDepartamento };
