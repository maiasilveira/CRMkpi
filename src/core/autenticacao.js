'use strict';
// Middleware de autenticação: sessão por cookie (navegador) ou Bearer token (integrações).
const { executarComo } = require('./contexto');

const COOKIE = 'kpi_sid';
function lerCookies(req) {
  const o = {};
  for (const par of (req.headers.cookie || '').split(';')) {
    const i = par.indexOf('=');
    if (i > 0) o[par.slice(0, i).trim()] = decodeURIComponent(par.slice(i + 1).trim());
  }
  return o;
}
function definirCookie(res, valor, expira) {
  const partes = [`${COOKIE}=${encodeURIComponent(valor)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (expira) partes.push(`Expires=${new Date(expira).toUTCString()}`); else partes.push('Max-Age=0');
  if (process.env.COOKIE_SECURE === '1') partes.push('Secure');
  res.setHeader('Set-Cookie', partes.join('; '));
}

function middlewareAutenticacao(core, { publicas = [] } = {}) {
  return (req, res, next) => {
    let usuario = null; let viaCookie = false;
    const auth = req.headers.authorization || '';
    if (auth.startsWith('Bearer ')) usuario = core.usuarioPorTokenApi(auth.slice(7).trim());
    else { usuario = core.usuarioPorSessao(lerCookies(req)[COOKIE]); viaCookie = !!usuario; }

    const publica = publicas.some((p) => req.path === p || req.path.startsWith(p + '/'));
    if (!usuario && !publica) return res.status(401).json({ erro: 'Não autenticado' });
    // Proteção CSRF: requisições de escrita autenticadas por cookie precisam do cabeçalho customizado
    if (viaCookie && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-requested-with'] !== 'kpi') {
      return res.status(403).json({ erro: 'Requisição bloqueada (CSRF)' });
    }
    req.usuario = usuario;
    return executarComo(usuario, () => next());
  };
}

module.exports = { middlewareAutenticacao, lerCookies, definirCookie, COOKIE };
