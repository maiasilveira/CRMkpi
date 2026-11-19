'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarApp } = require('../src/app');

async function servidor(modulos) {
  const { app } = criarApp({ dbFile: ':memory:', modulos });
  const srv = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  const base = `http://127.0.0.1:${srv.address().port}/api`;
  const req = async (metodo, url, corpo) => {
    const r = await fetch(base + url, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined });
    const txt = await r.text();
    let json = null; try { json = txt ? JSON.parse(txt) : null; } catch { json = txt; }
    return { status: r.status, body: json };
  };
  return { srv, req };
}

test('fluxo completo: indicador → desvio → análise → plano → eficácia → meta vinculada', async (t) => {
  const { srv, req } = await servidor();
  t.after(() => srv.close());

  const dep = await req('POST', '/departamentos', { nome: 'Operações', sigla: 'OPS' });
  assert.equal(dep.status, 201);
  const depId = dep.body.id;

  // Range incoerente é rejeitado
  const ruim = await req('POST', '/indicadores', { nome: 'X', departamento_id: depId, polaridade: 'maior_melhor', meta: 90, limite_inferior: 95 });
  assert.equal(ruim.status, 400);

  const ind = await req('POST', '/indicadores', { codigo: 'OTD', nome: 'OTD', departamento_id: depId, polaridade: 'maior_melhor', meta: 95, limite_inferior: 92, unidade: '%' });
  assert.equal(ind.status, 201);
  const iid = ind.body.id;

  assert.equal((await req('POST', `/indicadores/${iid}/medicoes`, { periodo: '2026-01', valor: 96 })).body.status, 'atingido');
  assert.equal((await req('POST', `/indicadores/${iid}/medicoes`, { periodo: '2026-02', valor: 93 })).body.status, 'atencao');
  const desvio = await req('POST', `/indicadores/${iid}/medicoes`, { periodo: '2026-03', valor: 88 });
  assert.equal(desvio.body.status, 'desvio');
  assert.equal(desvio.body.exige_analise, true);
  assert.equal((await req('POST', `/indicadores/${iid}/medicoes`, { periodo: '2026-13', valor: 1 })).status, 400);

  let painel = (await req('GET', '/indicadores/painel')).body;
  assert.equal(painel.status.desvio, 1);
  assert.ok(painel.alertas.some((a) => a.tipo === 'analise_pendente'));

  // 5W2H incompleto é rejeitado
  assert.equal((await req('POST', `/indicadores/medicoes/${desvio.body.id}/analises`, { tecnica: '5w2h', conteudo: { o_que: 'atraso' } })).status, 400);
  const analise = await req('POST', `/indicadores/medicoes/${desvio.body.id}/analises`, {
    tecnica: '5porques', conteudo: { problema: 'Atrasos', porques: ['Transportadora falhou', 'Contrato sem SLA'] } });
  assert.equal(analise.status, 201);
  assert.equal(analise.body.causa_raiz, 'Contrato sem SLA');

  const ish = await req('POST', `/indicadores/medicoes/${desvio.body.id}/analises`, { tecnica: 'ishikawa', conteudo: { problema: 'Atrasos', maquina: ['Empilhadeira parada'] } });
  assert.equal(ish.status, 201);
  assert.deepEqual(ish.body.conteudo.metodo, []);

  painel = (await req('GET', '/indicadores/painel')).body;
  assert.ok(!painel.alertas.some((a) => a.tipo === 'analise_pendente'));

  const plano = await req('POST', '/planos', { indicador_id: iid, analise_id: analise.body.id, titulo: 'Renegociar SLA',
    acoes: [{ o_que: 'Incluir SLA no contrato', quando: '2020-01-01', quem: 'Compras', quanto: 1000 }, { o_que: 'Avaliar 2ª transportadora', quando: '2099-01-01', quem: 'Logística' }] });
  assert.equal(plano.status, 201);
  assert.equal(plano.body.acoes_atrasadas, 1);
  assert.equal(plano.body.custo_total, 1000);
  const pid = plano.body.id;

  // Ação sem "quem" é rejeitada
  assert.equal((await req('POST', `/planos/${pid}/acoes`, { o_que: 'x', quando: '2026-01-01' })).status, 400);
  // Não conclui com ações em aberto; não verifica eficácia antes de concluir
  assert.equal((await req('PUT', `/planos/${pid}`, { status: 'concluido' })).status, 400);
  assert.equal((await req('PUT', `/planos/${pid}`, { eficacia: 'eficaz' })).status, 400);
  for (const a of plano.body.acoes) await req('PUT', `/planos/acoes/${a.id}`, { status: 'concluida' });
  const concl = await req('PUT', `/planos/${pid}`, { status: 'concluido' });
  assert.equal(concl.body.progresso, 100);
  const efic = await req('PUT', `/planos/${pid}`, { status: 'concluido', eficacia: 'eficaz', verificacao_obs: 'ok' });
  assert.equal(efic.body.eficacia, 'eficaz');
  assert.ok(efic.body.verificacao_data);

  // Metas: ciclo + meta vinculada ao indicador (média) + meta manual
  const ciclo = await req('POST', '/metas/ciclos', { nome: 'PLR 2026', inicio: '2026-01', fim: '2026-12', status: 'ativo', nota_minima: 50 });
  const cid = ciclo.body.id;
  const m1 = await req('POST', '/metas', { ciclo_id: cid, departamento_id: depId, nome: 'OTD médio', polaridade: 'maior_melhor', peso: 60,
    gatilho: 88, alvo: 95, superacao: 98, fonte: 'indicador', indicador_id: iid, agregacao: 'media' });
  assert.equal(m1.status, 201);
  assert.equal(m1.body.valor_apurado, 92.3333);
  // Peso acima de 100% é bloqueado
  assert.equal((await req('POST', '/metas', { ciclo_id: cid, departamento_id: depId, nome: 'Y', polaridade: 'maior_melhor', peso: 50, gatilho: 1, alvo: 2 })).status, 400);
  const m2 = await req('POST', '/metas', { ciclo_id: cid, departamento_id: depId, nome: 'Custo', polaridade: 'menor_melhor', peso: 40, gatilho: 110, alvo: 100, superacao: 90 });
  assert.equal((await req('POST', `/metas/${m1.body.id}/resultados`, { periodo: '2026-01', valor: 1 })).status, 400, 'meta de indicador não aceita lançamento manual');
  assert.equal((await req('POST', `/metas/${m2.body.id}/resultados`, { periodo: '2027-01', valor: 1 })).status, 400, 'período fora do ciclo');
  const r2 = await req('POST', `/metas/${m2.body.id}/resultados`, { periodo: '2026-03', valor: 100 });
  assert.equal(r2.body.atingimento, 100);

  await req('PUT', `/metas/ciclos/${cid}/departamentos/${depId}/bonus`, { valor_base: 10000 });
  let ap = (await req('GET', `/metas/ciclos/${cid}/apuracao`)).body;
  const d = ap.departamentos[0];
  assert.equal(d.peso_total, 100);
  assert.ok(d.nota > 0 && d.nota < 100);
  assert.equal(d.bonus, Math.round(10000 * d.nota) / 100);

  // Simulação não grava
  const sim = (await req('POST', `/metas/ciclos/${cid}/departamentos/${depId}/simular`, { valores: { [m1.body.id]: 98 } })).body;
  assert.equal(sim.metas.find((m) => m.id === m1.body.id).atingimento, 120);
  assert.equal((await req('GET', `/metas/${m1.body.id}`)).body.valor_apurado, 92.3333);

  // Fluxo de aprovação e bloqueio
  assert.equal((await req('POST', `/metas/ciclos/${cid}/encerrar`)).status, 400, 'não encerra sem aprovação');
  assert.equal((await req('POST', `/metas/ciclos/${cid}/departamentos/${depId}/aprovar`, {})).status, 400, 'não aprova sem submeter');
  await req('POST', `/metas/ciclos/${cid}/departamentos/${depId}/submeter`, {});
  assert.equal((await req('POST', `/metas/${m2.body.id}/resultados`, { periodo: '2026-04', valor: 1 })).status, 400, 'submetido bloqueia edição');
  await req('POST', `/metas/ciclos/${cid}/departamentos/${depId}/aprovar`, { usuario: 'Diretoria' });
  const enc = await req('POST', `/metas/ciclos/${cid}/encerrar`);
  assert.equal(enc.status, 200);
  assert.equal(enc.body.congelado, true);

  // Após encerrar, nova medição no indicador NÃO altera a apuração congelada
  await req('POST', `/indicadores/${iid}/medicoes`, { periodo: '2026-04', valor: 50 });
  ap = (await req('GET', `/metas/ciclos/${cid}/apuracao`)).body;
  assert.equal(ap.departamentos[0].nota, d.nota);

  const csv = await req('GET', `/metas/ciclos/${cid}/exportar.csv`);
  assert.equal(csv.status, 200);
  assert.match(csv.body, /OTD médio/);

  const aud = (await req('GET', '/auditoria?modulo=metas')).body;
  assert.ok(aud.some((a) => a.acao === 'encerrar'));
});

test('módulo Metas funciona sem o módulo Indicadores', async (t) => {
  const { srv, req } = await servidor(['metas']);
  t.after(() => srv.close());
  assert.deepEqual((await req('GET', '/modulos')).body.map((m) => m.nome), ['metas']);
  assert.equal((await req('GET', '/indicadores')).status, 404);
  const dep = (await req('POST', '/departamentos', { nome: 'Vendas' })).body;
  const c = (await req('POST', '/metas/ciclos', { nome: 'C1', inicio: '2026-01', fim: '2026-06' })).body;
  const vinc = await req('POST', '/metas', { ciclo_id: c.id, departamento_id: dep.id, nome: 'X', polaridade: 'maior_melhor', peso: 100, gatilho: 1, alvo: 2, fonte: 'indicador', indicador_id: 1 });
  assert.equal(vinc.status, 400);
  const m = await req('POST', '/metas', { ciclo_id: c.id, departamento_id: dep.id, nome: 'Vendas', polaridade: 'maior_melhor', peso: 100, gatilho: 80, alvo: 100, agregacao: 'soma' });
  assert.equal(m.status, 201);
  const r = await req('POST', `/metas/${m.body.id}/resultados`, { periodo: '2026-01', valor: 30 });
  assert.equal(r.body.projecao.valor, 180);
  assert.deepEqual((await req('GET', '/metas/indicadores-disponiveis')).body, []);
});

test('módulo Indicadores funciona sem o módulo Metas', async (t) => {
  const { srv, req } = await servidor(['indicadores']);
  t.after(() => srv.close());
  assert.equal((await req('GET', '/metas/ciclos')).status, 404);
  const dep = (await req('POST', '/departamentos', { nome: 'RH' })).body;
  const i = await req('POST', '/indicadores', { nome: 'Turnover', departamento_id: dep.id, polaridade: 'menor_melhor', meta: 2, limite_superior: 3 });
  assert.equal(i.status, 201);
  assert.equal((await req('POST', `/indicadores/${i.body.id}/medicoes`, { periodo: '2026-01', valor: 2.5 })).body.status, 'atencao');
});
