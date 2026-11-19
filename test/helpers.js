'use strict';
const { criarApp } = require('../src/app');

/** Cliente HTTP com cookie de sessão. */
function cliente(base) {
  let cookie = '';
  const c = async (metodo, url, corpo, extra = {}) => {
    const headers = { 'X-Requested-With': 'kpi', ...(cookie ? { Cookie: cookie } : {}), ...(extra.headers || {}) };
    let body;
    if (Buffer.isBuffer(corpo) || typeof corpo === 'string') body = corpo;
    else if (corpo !== undefined) { body = JSON.stringify(corpo); headers['Content-Type'] = 'application/json'; }
    const r = await fetch(base + url, { method: metodo, headers, body, redirect: 'manual' });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const tipo = r.headers.get('content-type') || '';
    const txt = tipo.includes('pdf') ? null : await r.text();
    let json = txt; try { json = txt ? JSON.parse(txt) : null; } catch { /* texto */ }
    return { status: r.status, body: json, headers: r.headers };
  };
  c.base = base;
  return c;
}

/** Sobe a aplicação em memória com um admin logado. */
async function servidor(modulos, { semAdmin = false, transporteEmail, clienteIa } = {}) {
  const ctx = criarApp({ dbFile: ':memory:', modulos, semAgendador: true, transporteEmail, clienteIa });
  const srv = await new Promise((ok) => { const s = ctx.app.listen(0, '127.0.0.1', () => ok(s)); });
  const base = `http://127.0.0.1:${srv.address().port}/api`;
  const req = cliente(base);
  if (!semAdmin) {
    const r = await req('POST', '/auth/configurar', { nome: 'Admin', email: 'admin@empresa.com', senha: 'senha-forte-1' });
    if (r.status !== 201) throw new Error('falha ao configurar admin: ' + JSON.stringify(r.body));
  }
  async function entrarComo(email, senha) {
    const c = cliente(base);
    const r = await c('POST', '/auth/login', { email, senha });
    if (r.status !== 200) throw new Error('login falhou: ' + JSON.stringify(r.body));
    return c;
  }
  return { srv, req, base, ctx, entrarComo, fechar: () => { srv.close(); ctx.encerrar?.(); } };
}

const esperar = (ms = 30) => new Promise((ok) => setTimeout(ok, ms));
module.exports = { servidor, cliente, esperar };
