'use strict';
// Login único via OpenID Connect (Authorization Code + PKCE).
// Compatível com Microsoft Entra ID (Azure AD), Google Workspace, Okta, Keycloak etc.
const crypto = require('node:crypto');
const E = require('./erros');

function configSso() {
  const c = {
    issuer: process.env.OIDC_ISSUER,
    clientId: process.env.OIDC_CLIENT_ID,
    clientSecret: process.env.OIDC_CLIENT_SECRET,
    redirectUri: process.env.OIDC_REDIRECT_URI,
    nome: process.env.OIDC_NOME || 'SSO corporativo',
    autoCriar: process.env.OIDC_AUTO_CRIAR === '1',
    dominios: (process.env.OIDC_DOMINIOS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  };
  c.ativo = !!(c.issuer && c.clientId && c.redirectUri);
  return c;
}

function criarSso(core, cfg = configSso()) {
  let descoberta = null;
  const pendentes = new Map(); // state -> { verifier, nonce, criado }

  async function descobrir() {
    if (descoberta) return descoberta;
    const r = await fetch(cfg.issuer.replace(/\/$/, '') + '/.well-known/openid-configuration');
    if (!r.ok) throw new E.ErroValidacao(`Falha ao consultar o provedor SSO (${r.status})`, 502);
    descoberta = await r.json();
    return descoberta;
  }

  async function iniciar() {
    E.exigir(cfg.ativo, 'SSO não configurado');
    const d = await descobrir();
    for (const [k, v] of pendentes) if (Date.now() - v.criado > 10 * 60e3) pendentes.delete(k);
    const state = crypto.randomBytes(16).toString('base64url');
    const nonce = crypto.randomBytes(16).toString('base64url');
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    pendentes.set(state, { verifier, nonce, criado: Date.now() });
    const u = new URL(d.authorization_endpoint);
    u.search = new URLSearchParams({ response_type: 'code', client_id: cfg.clientId, redirect_uri: cfg.redirectUri,
      scope: 'openid email profile', state, nonce, code_challenge: challenge, code_challenge_method: 'S256' }).toString();
    return u.toString();
  }

  async function concluir(code, state) {
    const p = pendentes.get(state);
    E.exigir(p && code, 'Retorno de SSO inválido ou expirado');
    pendentes.delete(state);
    const d = await descobrir();
    const corpo = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: cfg.redirectUri,
      client_id: cfg.clientId, code_verifier: p.verifier });
    if (cfg.clientSecret) corpo.set('client_secret', cfg.clientSecret);
    const tr = await fetch(d.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: corpo });
    if (!tr.ok) throw new E.ErroValidacao('Falha na troca do código de autorização', 401);
    const tok = await tr.json();
    // As informações do usuário vêm do endpoint userinfo (TLS + access token), dispensando validar a assinatura do id_token.
    const ur = await fetch(d.userinfo_endpoint, { headers: { Authorization: `Bearer ${tok.access_token}` } });
    if (!ur.ok) throw new E.ErroValidacao('Falha ao obter dados do usuário no provedor', 401);
    const info = await ur.json();
    const email = String(info.email || info.preferred_username || info.upn || '').toLowerCase();
    E.exigir(info.sub && email, 'O provedor não retornou e-mail do usuário');
    if (cfg.dominios.length) E.exigir(cfg.dominios.includes(email.split('@')[1]), 'Domínio de e-mail não autorizado', 403);

    const db = core.db;
    let u = db.prepare('SELECT * FROM usuarios WHERE sso_sub=?').get(String(info.sub))
      || db.prepare('SELECT * FROM usuarios WHERE email=?').get(email);
    if (!u) {
      if (!cfg.autoCriar) throw new E.ErroValidacao('Usuário não cadastrado. Solicite acesso ao administrador.', 403);
      const novo = core.salvarUsuario({ nome: info.name || email, email, perfil: 'colaborador', sso_sub: String(info.sub) }, null, { bootstrap: true });
      u = core.obterUsuario(novo.id);
    } else if (!u.sso_sub) {
      db.prepare('UPDATE usuarios SET sso_sub=? WHERE id=?').run(String(info.sub), u.id);
    }
    E.exigir(u.ativo, 'Usuário inativo', 403);
    return u;
  }

  return { ativo: cfg.ativo, nome: cfg.nome, iniciar, concluir };
}

module.exports = { criarSso, configSso };
