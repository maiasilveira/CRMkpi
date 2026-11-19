'use strict';
// Regras puras de avaliação de indicadores (sem acesso a banco).

/**
 * Classifica um valor medido em relação à meta e ao range aceitável.
 *  - maior_melhor: >= meta → atingido; >= limite_inferior → atencao; senão desvio
 *  - menor_melhor: <= meta → atingido; <= limite_superior → atencao; senão desvio
 *  - faixa:        dentro de [limite_inferior, limite_superior] → atingido; senão desvio
 */
function classificar({ polaridade, meta, limite_inferior: li, limite_superior: ls }, valor) {
  const temLi = li !== null && li !== undefined;
  const temLs = ls !== null && ls !== undefined;
  switch (polaridade) {
    case 'maior_melhor':
      if (valor >= meta) return 'atingido';
      if (temLi && valor >= li) return 'atencao';
      return 'desvio';
    case 'menor_melhor':
      if (valor <= meta) return 'atingido';
      if (temLs && valor <= ls) return 'atencao';
      return 'desvio';
    case 'faixa':
      if ((!temLi || valor >= li) && (!temLs || valor <= ls)) return 'atingido';
      return 'desvio';
    default:
      throw new Error(`Polaridade desconhecida: ${polaridade}`);
  }
}

/** Valida a coerência entre meta e range de acordo com a polaridade. Retorna lista de erros. */
function validarFaixa({ polaridade, meta, limite_inferior: li, limite_superior: ls }) {
  const erros = [];
  const temLi = li !== null && li !== undefined;
  const temLs = ls !== null && ls !== undefined;
  if (temLi && temLs && li > ls) erros.push('Limite inferior não pode ser maior que o limite superior');
  if (polaridade === 'maior_melhor' && temLi && li > meta) erros.push('Para "maior é melhor", o limite inferior aceitável deve ser ≤ meta');
  if (polaridade === 'menor_melhor' && temLs && ls < meta) erros.push('Para "menor é melhor", o limite superior aceitável deve ser ≥ meta');
  if (polaridade === 'faixa') {
    if (!temLi && !temLs) erros.push('Para "faixa", informe ao menos um limite');
    if (temLi && meta < li) erros.push('A meta deve estar dentro da faixa');
    if (temLs && meta > ls) erros.push('A meta deve estar dentro da faixa');
  }
  return erros;
}

/** Desvio percentual do valor em relação à meta (positivo = favorável). */
function desvioPercentual({ polaridade, meta }, valor) {
  if (!meta) return null;
  const bruto = ((valor - meta) / Math.abs(meta)) * 100;
  return polaridade === 'menor_melhor' ? -bruto : bruto;
}

/** Tendência simples pela inclinação da regressão linear dos últimos n valores. */
function tendencia(valores, polaridade) {
  const v = valores.slice(-6);
  if (v.length < 3) return 'indefinida';
  const n = v.length;
  const mx = (n - 1) / 2;
  const my = v.reduce((a, b) => a + b, 0) / n;
  let num = 0; let den = 0;
  v.forEach((y, x) => { num += (x - mx) * (y - my); den += (x - mx) ** 2; });
  const incl = num / den;
  const rel = my ? Math.abs(incl / my) : Math.abs(incl);
  if (rel < 0.01) return 'estavel';
  if (polaridade === 'faixa') return 'variando';
  const sobe = incl > 0;
  return (polaridade === 'maior_melhor') === sobe ? 'melhorando' : 'piorando';
}

module.exports = { classificar, validarFaixa, desvioPercentual, tendencia };
