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

// ---------------------------------------------------------------------------
// Fórmulas de indicadores calculados — parser próprio (sem eval).
// Sintaxe: números, referências {CODIGO}, + - * / ( ) e menos unário.
// ---------------------------------------------------------------------------
function tokenizar(expr) {
  const t = []; let i = 0;
  const s = String(expr || '');
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if ('+-*/()'.includes(c)) { t.push({ tipo: c }); i++; continue; }
    if (c === '{') {
      const f = s.indexOf('}', i);
      if (f < 0) throw new Error('Referência sem "}"');
      const cod = s.slice(i + 1, f).trim();
      if (!cod) throw new Error('Referência vazia');
      t.push({ tipo: 'ref', valor: cod }); i = f + 1; continue;
    }
    const m = /^\d+(?:[.,]\d+)?/.exec(s.slice(i));
    if (m) { t.push({ tipo: 'num', valor: Number(m[0].replace(',', '.')) }); i += m[0].length; continue; }
    throw new Error(`Caractere inválido na fórmula: "${c}"`);
  }
  return t;
}
/** Converte a fórmula em árvore sintática. */
function analisarFormula(expr) {
  const tk = tokenizar(expr); let p = 0;
  const olha = () => tk[p]; const consome = (tipo) => { if (tk[p]?.tipo !== tipo) throw new Error(`Esperado "${tipo}" na fórmula`); return tk[p++]; };
  function primario() {
    const t = olha();
    if (!t) throw new Error('Fórmula incompleta');
    if (t.tipo === 'num') { p++; return { n: t.valor }; }
    if (t.tipo === 'ref') { p++; return { ref: t.valor }; }
    if (t.tipo === '-') { p++; return { op: 'neg', a: primario() }; }
    if (t.tipo === '(') { p++; const e = soma(); consome(')'); return e; }
    throw new Error(`Token inesperado "${t.tipo}"`);
  }
  function produto() { let e = primario(); while (olha() && '*/'.includes(olha().tipo)) { const op = tk[p++].tipo; e = { op, a: e, b: primario() }; } return e; }
  function soma() { let e = produto(); while (olha() && '+-'.includes(olha().tipo)) { const op = tk[p++].tipo; e = { op, a: e, b: produto() }; } return e; }
  const arv = soma();
  if (p < tk.length) throw new Error('Fórmula com conteúdo sobrando');
  return arv;
}
function referencias(expr) {
  return [...new Set(tokenizar(expr).filter((t) => t.tipo === 'ref').map((t) => t.valor))];
}
/** Avalia a fórmula; retorna null se faltar algum valor ou houver divisão por zero. */
function avaliarFormula(expr, valores) {
  const ev = (n) => {
    if ('n' in n) return n.n;
    if ('ref' in n) { const v = valores[n.ref]; return v === undefined || v === null ? null : v; }
    const a = ev(n.a); if (a === null) return null;
    if (n.op === 'neg') return -a;
    const b = ev(n.b); if (b === null) return null;
    if (n.op === '+') return a + b;
    if (n.op === '-') return a - b;
    if (n.op === '*') return a * b;
    return b === 0 ? null : a / b;
  };
  const r = ev(analisarFormula(expr));
  return r === null || !Number.isFinite(r) ? null : Math.round(r * 1e6) / 1e6;
}

// ---------------------------------------------------------------------------
// Controle Estatístico de Processo — carta de valores individuais (I-MR)
// ---------------------------------------------------------------------------
function cep(valores) {
  const n = valores.length;
  if (n < 5) return { suficiente: false, minimo: 5, pontos: [] };
  const media = valores.reduce((a, b) => a + b, 0) / n;
  const mr = valores.slice(1).map((v, i) => Math.abs(v - valores[i]));
  const mrMedio = mr.reduce((a, b) => a + b, 0) / mr.length;
  const sigma = mrMedio / 1.128; // d2 para n=2
  const lsc = media + 3 * sigma; const lic = media - 3 * sigma;
  const pontos = valores.map((v) => ({ valor: v, sinais: [] }));
  // Regra 1: ponto fora dos limites de controle
  pontos.forEach((p) => { if (p.valor > lsc || p.valor < lic) p.sinais.push('fora_limite'); });
  // Regra 2: 8 pontos consecutivos do mesmo lado da média
  for (let i = 7; i < n; i++) {
    const j = valores.slice(i - 7, i + 1);
    if (j.every((v) => v > media) || j.every((v) => v < media)) pontos[i].sinais.push('sequencia_8');
  }
  // Regra 3: 6 pontos consecutivos subindo ou descendo
  for (let i = 5; i < n; i++) {
    const j = valores.slice(i - 5, i + 1);
    const sobe = j.every((v, k) => k === 0 || v > j[k - 1]); const desce = j.every((v, k) => k === 0 || v < j[k - 1]);
    if (sobe || desce) pontos[i].sinais.push('tendencia_6');
  }
  const r = (x) => Math.round(x * 1e4) / 1e4;
  return { suficiente: true, media: r(media), sigma: r(sigma), lsc: r(lsc), lic: r(lic), pontos,
    estavel: pontos.every((p) => !p.sinais.length), ultimo_instavel: pontos[n - 1].sinais.length > 0 };
}

/** Pareto: ordena causas por frequência e marca as "poucas vitais" (até ~80% acumulado). */
function pareto(itens) {
  const lista = itens.filter((i) => i.frequencia > 0).sort((a, b) => b.frequencia - a.frequencia);
  const total = lista.reduce((s, i) => s + i.frequencia, 0);
  let acum = 0;
  return lista.map((i) => {
    const antes = acum; acum += i.frequencia;
    const pctAcum = total ? Math.round((acum / total) * 1000) / 10 : 0;
    return { ...i, percentual: total ? Math.round((i.frequencia / total) * 1000) / 10 : 0, acumulado: pctAcum, vital: total ? (antes / total) < 0.8 : false };
  });
}

/** GUT: Gravidade × Urgência × Tendência (cada 1–5). */
const prioridadeGut = (g, u, t) => (g && u && t ? g * u * t : null);

/** Fase do ciclo PDCA de um plano de ação. */
function fasePdca(plano) {
  if (plano.status === 'cancelado') return null;
  if (plano.status === 'concluido') return plano.eficacia === 'pendente' || !plano.eficacia ? 'C' : 'A';
  if (plano.status === 'em_andamento') return 'D';
  return 'P';
}

module.exports = { classificar, validarFaixa, desvioPercentual, tendencia,
  analisarFormula, referencias, avaliarFormula, cep, pareto, prioridadeGut, fasePdca };
