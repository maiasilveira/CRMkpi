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

/** Meses do ciclo em que o colaborador trabalhou ao menos `diasMinimos` dias (regra de pró-rata). */
function mesesElegiveis({ admissao, desligamento }, inicio, fim, diasMinimos = 15) {
  const [a1, m1] = inicio.split('-').map(Number); const [a2, m2] = fim.split('-').map(Number);
  let total = 0; let elegiveis = 0;
  for (let a = a1, m = m1; a < a2 || (a === a2 && m <= m2); m === 12 ? (a++, m = 1) : m++) {
    total++;
    const ini = new Date(Date.UTC(a, m - 1, 1)); const fimMes = new Date(Date.UTC(a, m, 0));
    const de = admissao ? new Date(admissao + 'T00:00:00Z') : ini; const ate = desligamento ? new Date(desligamento + 'T00:00:00Z') : fimMes;
    const i = de > ini ? de : ini; const f = ate < fimMes ? ate : fimMes;
    const dias = f >= i ? Math.round((f - i) / 864e5) + 1 : 0;
    if (dias >= Math.min(diasMinimos, fimMes.getUTCDate())) elegiveis++;
  }
  return { elegiveis, total, fator: total ? elegiveis / total : 0 };
}

/** Gatilho corporativo: se definido, o programa só paga quando o resultado atinge o mínimo. */
function gatilhoCorporativo(ciclo) {
  if (ciclo.gatilho_corp_minimo === null || ciclo.gatilho_corp_minimo === undefined) return { definido: false, atingido: true };
  const r = ciclo.gatilho_corp_resultado;
  return { definido: true, descricao: ciclo.gatilho_corp_descricao, minimo: ciclo.gatilho_corp_minimo, resultado: r ?? null,
    apurado: r !== null && r !== undefined, atingido: r !== null && r !== undefined && r >= ciclo.gatilho_corp_minimo };
}

/**
 * Bônus individual.
 *  nota final = peso_dep × nota do departamento + (100 − peso_dep) × nota individual (se houver metas individuais)
 *  bônus = salário × múltiplo × fator pró-rata × nota final × (1 − redutores)
 *  Zera se o gatilho corporativo não foi atingido ou se a nota do departamento ficou abaixo da nota mínima.
 */
function bonusIndividual({ salario, multiplo, notaDepto, notaIndividual, pesoDepto, prorata, faltas, advertencias, ciclo, gatilhoOk }) {
  const notaFinal = notaIndividual === null || notaIndividual === undefined ? notaDepto
    : (pesoDepto * notaDepto + (100 - pesoDepto) * notaIndividual) / 100;
  const redutor = Math.min(ciclo.redutor_maximo_pct ?? 100, (faltas || 0) * (ciclo.redutor_falta_pct || 0) + (advertencias || 0) * (ciclo.redutor_advertencia_pct || 0));
  const alvo = salario * multiplo * prorata;
  const motivos = [];
  if (!gatilhoOk) motivos.push('gatilho corporativo não atingido');
  if (notaDepto < (ciclo.nota_minima || 0)) motivos.push('nota do departamento abaixo da mínima');
  if (prorata === 0) motivos.push('sem meses elegíveis no ciclo');
  const r2 = (x) => Math.round(x * 100) / 100;
  return { nota_final: r2(notaFinal), redutor_pct: r2(redutor), bonus_alvo: r2(alvo), elegivel: !motivos.length, motivos,
    bonus: motivos.length ? 0 : r2(alvo * (notaFinal / 100) * (1 - redutor / 100)) };
}

module.exports = { atingimento, validarMeta, agregar, notaDepartamento, mesesElegiveis, gatilhoCorporativo, bonusIndividual };
