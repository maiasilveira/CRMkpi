'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { servidor, esperar } = require('./helpers');

async function cenario(t, opts) {
  const s = await servidor(undefined, opts);
  t.after(s.fechar);
  const { req } = s;
  const ops = (await req('POST', '/departamentos', { nome: 'Operações' })).body;
  const fin = (await req('POST', '/departamentos', { nome: 'Financeiro' })).body;
  await req('POST', '/usuarios', { nome: 'Bruno Lima', email: 'bruno@x.com', senha: 'senha-bruno', perfil: 'gestor', departamento_id: ops.id });
  await req('POST', '/usuarios', { nome: 'Carla Mendes', email: 'carla@x.com', senha: 'senha-carla', perfil: 'gestor', departamento_id: fin.id });
  await req('POST', '/usuarios', { nome: 'Diretora', email: 'dir@x.com', senha: 'senha-diret', perfil: 'diretoria' });
  const ind = (await req('POST', '/indicadores', { nome: 'Refugo', departamento_id: ops.id, polaridade: 'menor_melhor', meta: 2, limite_superior: 3, responsavel: 'Bruno Lima' })).body;
  return { ...s, ops, fin, ind };
}

test('desvio gera notificação in-app e e-mail para o gestor; webhooks Teams/Slack', async (t) => {
  const emails = [];
  const transporteEmail = { sendMail: async (m) => { emails.push(m); } };
  const hooks = [];
  const wh = http.createServer((rq, rs) => { let b = ''; rq.on('data', (c) => { b += c; }); rq.on('end', () => { hooks.push({ url: rq.url, body: JSON.parse(b) }); rs.end('ok'); }); });
  await new Promise((ok) => wh.listen(0, '127.0.0.1', ok));
  t.after(() => wh.close());
  const { req, ind, entrarComo } = await cenario(t, { transporteEmail });
  const base = `http://127.0.0.1:${wh.address().port}`;
  await req('PUT', '/configuracoes', { teams_webhook: base + '/teams', slack_webhook: base + '/slack', app_url: 'https://kpi.empresa.com' });

  await req('POST', `/indicadores/${ind.id}/medicoes`, { periodo: '2026-01', valor: 5 });
  await esperar(100);
  const bruno = await entrarComo('bruno@x.com', 'senha-bruno');
  const caixa = (await bruno('GET', '/notificacoes')).body;
  assert.equal(caixa.nao_lidas, 1);
  assert.equal(caixa.itens[0].tipo, 'desvio');
  assert.equal(emails.length, 1);
  assert.equal(emails[0].to, 'bruno@x.com');
  assert.match(emails[0].text, /https:\/\/kpi\.empresa\.com\/#\/indicadores\//);
  assert.deepEqual(hooks.map((h) => h.url).sort(), ['/slack', '/teams']);
  await bruno('PUT', `/notificacoes/${caixa.itens[0].id}/lida`);
  assert.equal((await bruno('GET', '/notificacoes')).body.nao_lidas, 0);

  // Carla (outro departamento) não recebe
  const carla = await entrarComo('carla@x.com', 'senha-carla');
  assert.equal((await carla('GET', '/notificacoes')).body.itens.length, 0);
  // Teste de canais pelo admin
  const teste = (await req('POST', '/notificacoes/teste')).body;
  assert.equal(teste.email, 'enviado');
  assert.equal(teste.teams, 'enviado');
});

test('verificações agendadas: ação vencida, lançamento pendente e apuração aguardando — sem duplicar', async (t) => {
  const { req, ind, ops, entrarComo, ctx } = await cenario(t);
  await req('POST', '/planos', { indicador_id: ind.id, titulo: 'Plano X', acoes: [{ o_que: 'Trocar ferramenta', quando: '2020-01-01', quem: 'Bruno Lima' }] });
  await req('PUT', '/configuracoes', { dia_limite_lancamento: '0' });
  const c = (await req('POST', '/metas/ciclos', { nome: 'C', inicio: '2026-01', fim: '2026-12', status: 'ativo' })).body;
  await req('POST', '/metas', { ciclo_id: c.id, departamento_id: ops.id, nome: 'M', polaridade: 'maior_melhor', peso: 100, gatilho: 1, alvo: 2 });
  await req('POST', `/metas/ciclos/${c.id}/departamentos/${ops.id}/submeter`, {});
  ctx.db.prepare(`UPDATE met_bonus SET submetido_em='2020-01-01T00:00:00Z'`).run();

  const r1 = (await req('POST', '/notificacoes/verificar')).body;
  assert.ok(r1.notificacoes_criadas >= 3);
  const r2 = (await req('POST', '/notificacoes/verificar')).body;
  assert.equal(r2.notificacoes_criadas, 0, 'não repete alertas já enviados');

  const bruno = await entrarComo('bruno@x.com', 'senha-bruno');
  const tipos = (await bruno('GET', '/notificacoes')).body.itens.map((n) => n.tipo);
  assert.ok(tipos.includes('acao_atrasada'));
  assert.ok(tipos.includes('lancamento'));
  const dir = await entrarComo('dir@x.com', 'senha-diret');
  const tiposDir = (await dir('GET', '/notificacoes')).body.itens.map((n) => n.tipo);
  assert.ok(tiposDir.includes('apuracao'));
});

test('comentários com @menção e controle de acesso', async (t) => {
  const { req, ind, entrarComo } = await cenario(t);
  const r = await req('POST', `/comentarios/indicadores/indicador/${ind.id}`, { texto: 'Olhem isso @bruno e @carla e @ninguem' });
  assert.equal(r.status, 201);
  assert.equal(r.body.mencionados, 1, 'Carla não tem acesso ao departamento, então não é notificada');
  await esperar();
  const bruno = await entrarComo('bruno@x.com', 'senha-bruno');
  assert.equal((await bruno('GET', '/notificacoes')).body.itens[0].tipo, 'mencao');
  assert.equal((await bruno('GET', `/comentarios/indicadores/indicador/${ind.id}`)).body.length, 1);
  const carla = await entrarComo('carla@x.com', 'senha-carla');
  assert.equal((await carla('GET', `/comentarios/indicadores/indicador/${ind.id}`)).status, 403);
  assert.equal((await carla('POST', `/comentarios/indicadores/indicador/${ind.id}`, { texto: 'oi' })).status, 403);
  const cid = (await bruno('GET', `/comentarios/indicadores/indicador/${ind.id}`)).body[0].id;
  assert.equal((await bruno('DELETE', `/comentarios/${cid}`)).status, 403, 'só o autor exclui');
  assert.equal((await req('GET', '/comentarios/xx/yy/1')).status, 400);
});

test('anexos: upload, tipos permitidos, download e escopo', async (t) => {
  const { req, ind, entrarComo } = await cenario(t);
  const pdf = Buffer.from('%PDF-1.4 teste');
  const up = await req('POST', `/anexos/indicadores/indicador/${ind.id}?nome=${encodeURIComponent('evidência.pdf')}`, pdf, { headers: { 'Content-Type': 'application/octet-stream' } });
  assert.equal(up.status, 201);
  assert.equal((await req('POST', `/anexos/indicadores/indicador/${ind.id}?nome=x.html`, Buffer.from('<script>'), { headers: { 'Content-Type': 'application/octet-stream' } })).status, 400);
  assert.equal((await req('POST', `/anexos/indicadores/indicador/${ind.id}?nome=../../etc.exe`, Buffer.from('x'), { headers: { 'Content-Type': 'application/octet-stream' } })).status, 400);
  const lista = (await req('GET', `/anexos/indicadores/indicador/${ind.id}`)).body;
  assert.equal(lista[0].nome, 'evidência.pdf');
  const dl = await req('GET', `/anexos/${up.body.id}`);
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get('content-type'), 'application/pdf');
  const carla = await entrarComo('carla@x.com', 'senha-carla');
  assert.equal((await carla('GET', `/anexos/${up.body.id}`)).status, 403);
  assert.equal((await req('DELETE', `/anexos/${up.body.id}`)).status, 204);
});
