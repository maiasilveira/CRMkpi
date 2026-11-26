'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { servidor } = require('./helpers');

async function cenario(t) {
  const s = await servidor();
  t.after(s.fechar);
  const { req } = s;
  const lojaA = (await req('POST', '/departamentos', { nome: 'Loja Centro' })).body;
  const lojaB = (await req('POST', '/departamentos', { nome: 'Loja Norte' })).body;
  await req('POST', '/usuarios', { nome: 'Gestora Centro', email: 'gc@x.com', senha: 'senha-centro', perfil: 'gestor', departamento_id: lojaA.id });
  const ind = async (dep, valor) => {
    const i = (await req('POST', '/indicadores', { nome: 'Vendas por m²', departamento_id: dep.id, polaridade: 'maior_melhor', meta: 100, limite_inferior: 90 })).body;
    await req('POST', `/indicadores/${i.id}/medicoes`, { periodo: '2026-05', valor });
    return i;
  };
  const iA = await ind(lojaA, 120);
  const iB = await ind(lojaB, 70);
  return { ...s, lojaA, lojaB, iA, iB };
}

test('benchmark: ranking de KPIs no período, metas como coluna informativa e comparativo entre unidades', async (t) => {
  const { req, lojaA, lojaB } = await cenario(t);
  const c = (await req('POST', '/metas/ciclos', { nome: 'C', inicio: '2026-01', fim: '2026-12', status: 'ativo' })).body;
  for (const [d, v] of [[lojaA, 100], [lojaB, 85]]) {
    const m = (await req('POST', '/metas', { ciclo_id: c.id, departamento_id: d.id, nome: 'M', polaridade: 'maior_melhor', peso: 100, gatilho: 80, alvo: 100 })).body;
    await req('POST', `/metas/${m.id}/resultados`, { periodo: '2026-05', valor: v });
  }
  const b = (await req('GET', '/governanca/benchmark?periodo=2026-05')).body;
  assert.equal(b.periodo, '2026-05');
  assert.equal(b.ranking[0].departamento, 'Loja Centro');
  assert.equal(b.ranking[0].posicao, 1);
  assert.equal(b.ranking[0].indice, 100);
  assert.equal(b.ranking[1].desvios, 1);
  assert.equal(b.ranking[1].indice, 0);
  // Metas bonificáveis: coluna informativa, fora do índice
  assert.equal(b.com_metas, true);
  assert.equal(b.ranking[0].nota_metas !== null && b.ranking[1].nota_metas !== null, true);
  assert.equal(b.comparativo[0].indicador, 'Vendas por m²');
  assert.deepEqual(b.comparativo[0].itens.map((i) => i.valor), [120, 70]);
  // Outro mês sem medições: ninguém é ranqueado; as áreas vão para "sem dados suficientes"
  const vazio = (await req('GET', '/governanca/benchmark?periodo=2026-06')).body;
  assert.deepEqual([vazio.ranking.length, vazio.sem_dados.length], [0, 2]);
  assert.equal((await req('GET', '/governanca/benchmark?nivel=setor')).status, 400);
});

test('benchmark: mesmo período, nível da estrutura, pontuação e cobertura mínima', async (t) => {
  const s = await servidor();
  t.after(s.fechar);
  const { req } = s;
  const dir = (await req('POST', '/departamentos', { nome: 'Diretoria X', tipo: 'diretoria' })).body;
  const gA = (await req('POST', '/departamentos', { nome: 'Gerência A', tipo: 'gerencia', pai_id: dir.id })).body;
  const gB = (await req('POST', '/departamentos', { nome: 'Gerência B', tipo: 'gerencia', pai_id: dir.id })).body;
  const cA1 = (await req('POST', '/departamentos', { nome: 'Coord A1', tipo: 'coordenacao', pai_id: gA.id })).body;
  const cA2 = (await req('POST', '/departamentos', { nome: 'Coord A2', tipo: 'coordenacao', pai_id: gA.id })).body;
  const ind = async (dep, valor, periodo = '2026-05', frequencia = 'mensal') => {
    const i = (await req('POST', '/indicadores', { nome: `I-${Math.random()}`, departamento_id: dep.id, polaridade: 'maior_melhor', meta: 100, limite_inferior: 90, frequencia })).body;
    if (valor !== null) await req('POST', `/indicadores/${i.id}/medicoes`, { periodo, valor });
    return i;
  };
  await ind(cA1, 100); // atingido → 100
  await ind(cA2, 95); // atenção → 50
  await ind(gB, 100, '2026-04', 'trimestral'); // trimestral medido em abril vale para maio
  await ind(gB, 50); // desvio → 0
  await ind(gB, null); // não medido
  let b = (await req('GET', '/governanca/benchmark?periodo=2026-05&nivel=gerencia')).body;
  const por = (n) => b.ranking.find((d) => d.departamento === n) || b.sem_dados.find((d) => d.departamento === n);
  assert.deepEqual([por('Gerência A').indice, por('Gerência A').medidos, por('Gerência A').indicadores], [75, 2, 2], 'coordenações agregadas na gerência; atenção vale 50');
  assert.deepEqual([por('Gerência B').indice, por('Gerência B').medidos, por('Gerência B').cobertura], [50, 2, 66.7], 'trimestral de abril conta em maio');
  assert.deepEqual(b.ranking.map((d) => d.departamento), ['Gerência A', 'Gerência B']);
  // Cobertura mínima de 50%: Gerência B com só 1 de 3 medidos sai do ranking
  b = (await req('GET', '/governanca/benchmark?periodo=2026-07&nivel=gerencia')).body;
  assert.equal(b.ranking.length, 0, 'trimestral de abril não vale mais em julho');
  // Nível diretoria agrega tudo; nível "área" mostra as coordenações
  b = (await req('GET', '/governanca/benchmark?periodo=2026-05&nivel=diretoria')).body;
  assert.deepEqual([b.ranking.length, b.ranking[0].departamento, b.ranking[0].indicadores], [1, 'Diretoria X', 5]);
  b = (await req('GET', '/governanca/benchmark?periodo=2026-05&nivel=area')).body;
  assert.deepEqual(b.ranking.map((d) => d.departamento), ['Coord A1', 'Coord A2', 'Gerência B']);
});

test('reuniões: pauta automática, decisões, escopo e alerta de atraso', async (t) => {
  const { req, lojaB, iB, entrarComo } = await cenario(t);
  const pl = (await req('POST', '/planos', { indicador_id: iB.id, titulo: 'Recuperar vendas', acoes: [{ o_que: 'Treinar equipe', quando: '2020-01-01', quem: 'RH' }] })).body;
  void pl;
  const r = (await req('POST', '/governanca/reunioes', { titulo: 'RAC Loja Norte', data: '2026-06-05', departamento_id: lojaB.id, participantes: 'Gerente, Supervisor' })).body;
  const tipos = r.pauta.itens.map((i) => i.tipo);
  assert.equal(tipos[0], 'indicador_desvio');
  assert.ok(tipos.includes('plano_atrasado'));
  assert.match(r.pauta.itens[0].texto, /SEM análise de causa/);
  assert.ok(r.pauta.itens.every((i) => !/Loja Centro/.test(i.texto)), 'pauta restrita ao escopo da reunião');

  const comDecisao = (await req('POST', `/governanca/reunioes/${r.id}/decisoes`, { descricao: 'Revisar escala de vendedores', responsavel: 'Gestora Centro', prazo: '2020-01-10' })).body;
  assert.equal(comDecisao.decisoes[0].atrasada, true);
  await req('PUT', `/governanca/reunioes/${r.id}`, { ...r, ata: 'Discutidos os desvios.', status: 'realizada' });
  assert.equal((await req('POST', `/governanca/reunioes/${r.id}/pauta`)).status, 400, 'pauta congelada após a reunião');

  // Próxima reunião do mesmo departamento herda os encaminhamentos pendentes
  const r2 = (await req('POST', '/governanca/reunioes', { titulo: 'RAC 2', data: '2026-07-05', departamento_id: lojaB.id })).body;
  assert.ok(r2.pauta.itens.some((i) => i.tipo === 'decisao_pendente' && /escala/.test(i.texto)));

  // Escopo: gestora de outra loja não vê; corporativa só diretoria/admin
  const gc = await entrarComo('gc@x.com', 'senha-centro');
  assert.equal((await gc('GET', `/governanca/reunioes/${r.id}`)).status, 403);
  assert.equal((await gc('GET', '/governanca/reunioes')).body.length, 0);
  const corp = (await req('POST', '/governanca/reunioes', { titulo: 'Análise crítica da direção', data: '2026-06-30' })).body;
  assert.ok(corp.pauta.itens.length >= 2);
  assert.equal((await gc('GET', `/governanca/reunioes/${corp.id}`)).status, 403);
  assert.equal((await gc('POST', '/governanca/reunioes', { titulo: 'X', data: '2026-06-30' })).status, 403);
  // Comentários na reunião respeitam o escopo
  assert.equal((await req('POST', `/comentarios/governanca/reuniao/${corp.id}`, { texto: 'ok' })).status, 201);
  assert.equal((await gc('GET', `/comentarios/governanca/reuniao/${corp.id}`)).status, 403);

  // Decisão atrasada gera notificação para o responsável
  await req('POST', '/notificacoes/verificar');
  const tiposGc = (await gc('GET', '/notificacoes')).body.itens.map((n) => n.tipo);
  assert.ok(tiposGc.includes('decisao_atrasada'));
});
