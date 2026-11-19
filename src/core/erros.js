'use strict';
class ErroValidacao extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}
class NaoEncontrado extends ErroValidacao {
  constructor(o = 'Registro') { super(`${o} não encontrado`, 404); }
}
function exigir(cond, msg) { if (!cond) throw new ErroValidacao(msg); }
function numero(v, campo, { obrigatorio = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (obrigatorio) throw new ErroValidacao(`Campo "${campo}" é obrigatório`);
    return null;
  }
  const n = Number(v);
  if (!Number.isFinite(n)) throw new ErroValidacao(`Campo "${campo}" deve ser numérico`);
  return n;
}
function texto(v, campo, { obrigatorio = false } = {}) {
  const s = v === undefined || v === null ? '' : String(v).trim();
  if (obrigatorio && !s) throw new ErroValidacao(`Campo "${campo}" é obrigatório`);
  return s || null;
}
function umDe(v, campo, opcoes, padrao) {
  if (v === undefined || v === null || v === '') {
    if (padrao !== undefined) return padrao;
    throw new ErroValidacao(`Campo "${campo}" é obrigatório`);
  }
  if (!opcoes.includes(v)) throw new ErroValidacao(`Campo "${campo}" deve ser um de: ${opcoes.join(', ')}`);
  return v;
}
// Período no formato AAAA-MM
function periodo(v, campo = 'periodo') {
  const s = texto(v, campo, { obrigatorio: true });
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) throw new ErroValidacao(`Campo "${campo}" deve estar no formato AAAA-MM`);
  return s;
}
function data(v, campo, { obrigatorio = false } = {}) {
  const s = texto(v, campo, { obrigatorio });
  if (s && !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new ErroValidacao(`Campo "${campo}" deve estar no formato AAAA-MM-DD`);
  return s;
}
module.exports = { ErroValidacao, NaoEncontrado, exigir, numero, texto, umDe, periodo, data };
