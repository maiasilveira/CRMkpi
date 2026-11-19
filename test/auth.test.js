'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { servidor, cliente } = require('./helpers');

test('primeiro acesso, login, logout e CSRF', async (t) => {
  const { fechar, req, base } = await servidor(undefined, { semAdmin: true });
  t.after(fechar);
  assert.equal((await req('GET', '/auth/estado')).body.precisa_configurar, true);
  assert.equal((await req('GET', '/departamentos')).status, 401);
  assert.equal((await req('POST', '/auth/configurar', { nome: 'A', email: 'a@x.com', senha: 'curta' })).status, 400);
  assert.equal((await req('POST', '/auth/configurar', { nome: 'A', email: 'a@x.com', senha: 'senha-longa-1' })).status, 201);
  assert.equal((await req('POST', '/auth/configurar', { nome: 'B', email: 'b@x.com', senha: 'senha-longa-1' })).status, 409);
  assert.equal((await req('GET', '/eu')).body.perfil, 'admin');

  // Sem o cabeçalho anti-CSRF a escrita é bloqueada
  const sid = await (async () => { const r = await req('GET', '/auth/estado'); return r; })();
  void sid;
  const semCabecalho = await req('POST', '/departamentos', { nome: 'X' }, { headers: { 'X-Requested-With': '' } });
  assert.equal(semCabecalho.status, 403);

  await req('POST', '/auth/logout');
  assert.equal((await req('GET', '/eu')).status, 401);
  const outro = cliente(base);
  assert.equal((await outro('POST', '/auth/login', { email: 'a@x.com', senha: 'errada' })).status, 401);
  assert.equal((await outro('POST', '/auth/login', { email: 'A@X.COM', senha: 'senha-longa-1' })).status, 200);
});

test('perfis e escopo por departamento (com hierarquia)', async (t) => {
  const { fechar, req, entrarComo } = await servidor();
  t.after(fechar);
  const dir = (await req('POST', '/departamentos', { nome: 'Diretoria Industrial', tipo: 'diretoria' })).body;
  const ops = (await req('POST', '/departamentos', { nome: 'Operações', pai_id: dir.id })).body;
  const fin = (await req('POST', '/departamentos', { nome: 'Financeiro' })).body;
  // ciclo de hierarquia é bloqueado
  assert.equal((await req('PUT', `/departamentos/${dir.id}`, { nome: 'Diretoria Industrial', pai_id: ops.id })).status, 400);

  await req('POST', '/usuarios', { nome: 'Gestor Dir', email: 'gd@x.com', senha: 'senha-gestor', perfil: 'gestor', departamento_id: dir.id });
  await req('POST', '/usuarios', { nome: 'Colab Ops', email: 'co@x.com', senha: 'senha-colab', perfil: 'colaborador', departamento_id: ops.id });
  await req('POST', '/usuarios', { nome: 'Diretora', email: 'di@x.com', senha: 'senha-diret', perfil: 'diretoria' });
  assert.equal((await req('POST', '/usuarios', { nome: 'Sem depto', email: 'sd@x.com', perfil: 'gestor' })).status, 400);

  const iOps = (await req('POST', '/indicadores', { nome: 'OTD', departamento_id: ops.id, polaridade: 'maior_melhor', meta: 95 })).body;
  const iFin = (await req('POST', '/indicadores', { nome: 'Inadimplência', departamento_id: fin.id, polaridade: 'menor_melhor', meta: 3 })).body;

  const gestor = await entrarComo('gd@x.com', 'senha-gestor');
  const nomes = (await gestor('GET', '/indicadores')).body.map((i) => i.nome);
  assert.deepEqual(nomes, ['OTD'], 'gestor da diretoria vê o departamento filho');
  assert.equal((await gestor('GET', `/indicadores/${iFin.id}`)).status, 403);
  assert.equal((await gestor('POST', `/indicadores/${iOps.id}/medicoes`, { periodo: '2026-01', valor: 90 })).status, 201);
  assert.equal((await gestor('POST', `/indicadores/${iFin.id}/medicoes`, { periodo: '2026-01', valor: 2 })).status, 403);
  assert.equal((await gestor('POST', '/usuarios', { nome: 'x', email: 'x@x.com' })).status, 403);
  assert.equal((await gestor('GET', '/auditoria')).status, 403);

  const colab = await entrarComo('co@x.com', 'senha-colab');
  assert.equal((await colab('GET', `/indicadores/${iOps.id}`)).status, 200);
  assert.equal((await colab('POST', `/indicadores/${iOps.id}/medicoes`, { periodo: '2026-02', valor: 90 })).status, 403, 'colaborador é somente leitura');

  const diret = await entrarComo('di@x.com', 'senha-diret');
  assert.equal((await diret('GET', '/indicadores')).body.length, 2);
  assert.equal((await diret('POST', '/metas/ciclos', { nome: 'C', inicio: '2026-01', fim: '2026-12' })).status, 201);
  assert.equal((await gestor('POST', '/metas/ciclos', { nome: 'C2', inicio: '2026-01', fim: '2026-12' })).status, 403);

  // Não é possível remover o último admin
  const eu = (await req('GET', '/eu')).body;
  assert.equal((await req('PUT', `/usuarios/${eu.id}`, { nome: 'Admin', email: 'admin@empresa.com', perfil: 'colaborador', departamento_id: fin.id })).status, 400);

  // Desativar usuário derruba a sessão
  const lista = (await req('GET', '/usuarios')).body;
  const c = lista.find((u) => u.email === 'co@x.com');
  await req('PUT', `/usuarios/${c.id}`, { ...c, ativo: false });
  assert.equal((await colab('GET', '/eu')).status, 401);
});

test('tokens de API para integrações', async (t) => {
  const { fechar, req, base } = await servidor();
  t.after(fechar);
  const dep = (await req('POST', '/departamentos', { nome: 'Vendas' })).body;
  const ind = (await req('POST', '/indicadores', { codigo: 'V1', nome: 'Vendas', departamento_id: dep.id, polaridade: 'maior_melhor', meta: 10 })).body;
  const tk = (await req('POST', '/tokens', { nome: 'ERP' })).body;
  assert.match(tk.token, /^kpi_/);
  const api = cliente(base);
  const auth = { headers: { Authorization: `Bearer ${tk.token}`, 'X-Requested-With': '' } };
  assert.equal((await api('POST', `/indicadores/${ind.id}/medicoes`, { periodo: '2026-01', valor: 12 }, auth)).status, 201, 'token não exige cabeçalho CSRF');
  await req('DELETE', `/tokens/${tk.id}`);
  assert.equal((await api('GET', '/indicadores', undefined, auth)).status, 401);
  assert.ok((await req('GET', '/tokens')).body[0].ultimo_uso);
});

test('login único via OpenID Connect (provedor simulado)', async (t) => {
  // Provedor OIDC falso
  let ultimoAuth = null;
  const idp = http.createServer((rq, rs) => {
    const u = new URL(rq.url, 'http://x');
    const json = (o) => { rs.setHeader('Content-Type', 'application/json'); rs.end(JSON.stringify(o)); };
    const raiz = `http://127.0.0.1:${idp.address().port}`;
    if (u.pathname === '/.well-known/openid-configuration') return json({ authorization_endpoint: raiz + '/auth', token_endpoint: raiz + '/token', userinfo_endpoint: raiz + '/userinfo' });
    if (u.pathname === '/token') { let b = ''; rq.on('data', (c) => { b += c; }); rq.on('end', () => { const p = new URLSearchParams(b); ultimoAuth = p; json({ access_token: 'at-' + p.get('code') }); }); return undefined; }
    if (u.pathname === '/userinfo') return json({ sub: 'abc-123', email: 'sso@empresa.com', name: 'Pessoa SSO' });
    rs.statusCode = 404; return rs.end();
  });
  await new Promise((ok) => idp.listen(0, '127.0.0.1', ok));
  const issuer = `http://127.0.0.1:${idp.address().port}`;
  Object.assign(process.env, { OIDC_ISSUER: issuer, OIDC_CLIENT_ID: 'cli', OIDC_CLIENT_SECRET: 's', OIDC_REDIRECT_URI: 'http://localhost/api/auth/sso/retorno', OIDC_AUTO_CRIAR: '1' });
  const { fechar, req, base } = await servidor();
  t.after(() => { fechar(); idp.close(); for (const k of ['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI', 'OIDC_AUTO_CRIAR']) delete process.env[k]; });

  assert.ok((await req('GET', '/auth/estado')).body.sso);
  const anon = cliente(base);
  const ini = await anon('GET', '/auth/sso/iniciar');
  assert.equal(ini.status, 302);
  const destino = new URL(ini.headers.get('location'));
  assert.equal(destino.searchParams.get('code_challenge_method'), 'S256');
  const state = destino.searchParams.get('state');
  // state adulterado é recusado
  const ruim = await anon('GET', '/auth/sso/retorno?code=x&state=forjado');
  assert.match(ruim.headers.get('location'), /erro=/);
  const ret = await anon('GET', `/auth/sso/retorno?code=c1&state=${state}`);
  assert.equal(ret.headers.get('location'), '/#/');
  assert.ok(ultimoAuth.get('code_verifier'));
  const eu = (await anon('GET', '/eu')).body;
  assert.equal(eu.email, 'sso@empresa.com');
  assert.equal(eu.perfil, 'colaborador');
  assert.equal(eu.sso, true);
});
