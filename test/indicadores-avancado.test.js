'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const ExcelJS = require('exceljs');
const { servidor } = require('./helpers');
const calc = require('../src/modules/indicadores/calculo');

async function base(t, opts) {
  const s = await servidor(undefined, opts);
  t.after(s.fechar);
  const dep = (await s.req('POST', '/departamentos', { nome: 'Comercial' })).body;
  const novo = (d) => s.req('POST', '/indicadores', { departamento_id: dep.id, polaridade: 'maior_melhor', ...d }).then((r) => r.body);
  return { ...s, dep, novo };
}

test('fórmulas: parser seguro, erros e precedência', () => {
  assert.equal(calc.avaliarFormula('2 + 3 * 4', {}), 14);
  assert.equal(calc.avaliarFormula('(2 + 3) * 4', {}), 20);
  assert.equal(calc.avaliarFormula('{A} / {B}', { A: 1, B: 0 }), null);
  assert.equal(calc.avaliarFormula('{A} + 1', { A: null }), null);
  for (const ruim of ['{A} +', '({A}', 'Math.max(1)', '{}', '1 ** 2']) assert.throws(() => calc.analisarFormula(ruim));
});

test('indicador calculado é recalculado quando os componentes mudam', async (t) => {
  const { req, novo } = await base(t);
  const rec = await novo({ codigo: 'REC', nome: 'Receita', meta: 100 });
  const vis = await novo({ codigo: 'VIS', nome: 'Visitas', meta: 10 });
  assert.equal((await req('POST', '/indicadores', { codigo: 'X', nome: 'X', departamento_id: rec.departamento_id, polaridade: 'maior_melhor', meta: 1, tipo: 'calculado', formula_calculo: '{NAOEXISTE} * 2' })).status, 400);
  await req('POST', `/indicadores/${rec.id}/medicoes`, { periodo: '2026-01', valor: 200 });
  await req('POST', `/indicadores/${vis.id}/medicoes`, { periodo: '2026-01', valor: 20 });
  const tk = await novo({ codigo: 'TK', nome: 'Ticket médio', meta: 8, limite_inferior: 6, tipo: 'calculado', formula_calculo: '{REC} / {VIS}' });
  let meds = (await req('GET', `/indicadores/${tk.id}/medicoes`)).body;
  assert.equal(meds[0].valor, 10, 'calcula retroativamente ao criar');
  await req('POST', `/indicadores/${vis.id}/medicoes`, { periodo: '2026-01', valor: 40 });
  meds = (await req('GET', `/indicadores/${tk.id}/medicoes`)).body;
  assert.equal(meds[0].valor, 5);
  assert.equal(meds[0].status, 'desvio');
  assert.equal((await req('POST', `/indicadores/${tk.id}/medicoes`, { periodo: '2026-02', valor: 1 })).status, 400, 'não aceita lançamento manual');
  // Encadeado e referência circular
  const tk2 = await novo({ codigo: 'TK2', nome: 'Ticket x2', meta: 1, tipo: 'calculado', formula_calculo: '{TK} * 2' });
  assert.equal((await req('GET', `/indicadores/${tk2.id}/medicoes`)).body[0].valor, 10);
  const circ = await req('PUT', `/indicadores/${tk.id}`, { ...tk, formula_calculo: '{REC} / {TK2}', justificativa: 'teste' });
  assert.equal(circ.status, 400);
  assert.match(circ.body.erro, /circular/);
});

test('meta sazonal por período e histórico de versões com justificativa', async (t) => {
  const { req, novo } = await base(t);
  const i = await novo({ codigo: 'V', nome: 'Vendas', meta: 100, limite_inferior: 90 });
  await req('POST', `/indicadores/${i.id}/medicoes`, { periodo: '2026-12', valor: 120 });
  assert.equal((await req('GET', `/indicadores/${i.id}/medicoes`)).body[0].status, 'atingido');
  // Dezembro tem meta maior: a medição existente é reclassificada
  await req('POST', `/indicadores/${i.id}/metas-periodo`, { periodo: '2026-12', meta: 150, limite_inferior: 130 });
  const m = (await req('GET', `/indicadores/${i.id}/medicoes`)).body[0];
  assert.equal(m.meta, 150);
  assert.equal(m.status, 'desvio');
  assert.equal((await req('POST', `/indicadores/${i.id}/metas-periodo`, { periodo: '2026-11', meta: 100, limite_inferior: 200 })).status, 400);

  assert.equal((await req('PUT', `/indicadores/${i.id}`, { ...i, meta: 110 })).status, 400, 'exige justificativa com histórico');
  assert.equal((await req('PUT', `/indicadores/${i.id}`, { ...i, meta: 110, justificativa: 'Novo orçamento' })).status, 200);
  const v = (await req('GET', `/indicadores/${i.id}/versoes`)).body;
  assert.equal(v[0].dados_anteriores.meta, 100);
  assert.equal(v[0].dados_novos.meta, 110);
  assert.equal(v[0].justificativa, 'Novo orçamento');
});

test('CEP, GUT/PDCA e novas técnicas (Pareto, A3, árvore de falhas)', async (t) => {
  const { req, novo } = await base(t);
  const i = await novo({ codigo: 'Q', nome: 'Qualidade', meta: 10, limite_inferior: 5 });
  const vals = [10, 11, 10, 9, 10, 11, 10, 9, 10, 40];
  for (let k = 0; k < vals.length; k++) await req('POST', `/indicadores/${i.id}/medicoes`, { periodo: `2026-${String(k + 1).padStart(2, '0')}`, valor: vals[k] });
  const c = (await req('GET', `/indicadores/${i.id}/cep`)).body;
  assert.equal(c.ultimo_instavel, true);
  assert.deepEqual(c.pontos.at(-1).sinais, ['fora_limite']);
  assert.ok((await req('GET', '/indicadores/painel')).body.alertas.some((a) => a.tipo === 'instabilidade'));

  await req('POST', `/indicadores/${i.id}/medicoes`, { periodo: '2026-11', valor: 1 });
  const med = (await req('GET', `/indicadores/${i.id}/medicoes`)).body.find((m) => m.periodo === '2026-11');
  const par = await req('POST', `/indicadores/medicoes/${med.id}/analises`, { tecnica: 'pareto', conteudo: { problema: 'Reclamações',
    itens: [{ causa: 'Atraso', frequencia: 60 }, { causa: 'Avaria', frequencia: 25 }, { causa: 'Erro NF', frequencia: 15 }] } });
  assert.equal(par.status, 201);
  assert.equal(par.body.causa_raiz, 'Atraso; Avaria');
  assert.equal((await req('POST', `/indicadores/medicoes/${med.id}/analises`, { tecnica: 'a3', conteudo: { contexto: 'x' } })).status, 400);
  const a3 = await req('POST', `/indicadores/medicoes/${med.id}/analises`, { tecnica: 'a3', conteudo: { contexto: 'c', situacao_atual: 's', analise_causa: 'Falta de padrão' } });
  assert.equal(a3.body.causa_raiz, 'Falta de padrão');
  const arv = await req('POST', `/indicadores/medicoes/${med.id}/analises`, { tecnica: 'arvore', causa_raiz: 'Sensor', conteudo: { evento_topo: 'Parada',
    causas: [{ descricao: 'Falha elétrica', porta: 'OU', filhos: [{ descricao: 'Sensor queimado' }] }] } });
  assert.equal(arv.body.conteudo.causas[0].filhos[0].descricao, 'Sensor queimado');

  assert.equal((await req('POST', '/planos', { indicador_id: i.id, titulo: 'P0', gravidade: 9 })).status, 400);
  const p1 = (await req('POST', '/planos', { indicador_id: i.id, titulo: 'P1', gravidade: 2, urgencia: 2, tendencia_gut: 2 })).body;
  const p2 = (await req('POST', '/planos', { indicador_id: i.id, titulo: 'P2', gravidade: 5, urgencia: 4, tendencia_gut: 3 })).body;
  assert.equal(p2.prioridade, 60);
  assert.equal(p1.fase_pdca, 'P');
  const ord = (await req('GET', '/planos?ordem=gut')).body.map((p) => p.titulo);
  assert.deepEqual(ord, ['P2', 'P1']);
});

test('mapa estratégico BSC', async (t) => {
  const { req, novo } = await base(t);
  const o1 = (await req('POST', '/indicadores/objetivos', { perspectiva: 'financeira', nome: 'Crescer receita' })).body.perspectivas[0].objetivos[0];
  const mapa = (await req('POST', '/indicadores/objetivos', { perspectiva: 'clientes', nome: 'Encantar clientes', contribui_para: [o1.id] })).body;
  const o2 = mapa.perspectivas[1].objetivos[0];
  assert.deepEqual(o2.contribui_para, [o1.id]);
  const i = await novo({ codigo: 'NPS', nome: 'NPS', meta: 70, objetivo_id: o2.id });
  await req('POST', `/indicadores/${i.id}/medicoes`, { periodo: '2026-01', valor: 50 });
  const m = (await req('GET', '/indicadores/mapa')).body;
  assert.equal(m.perspectivas[1].objetivos[0].situacao, 'desvio');
  assert.equal(m.perspectivas[1].objetivos[0].indicadores[0].codigo, 'NPS');
});

test('importação de medições por CSV e XLSX (com simulação)', async (t) => {
  const { req, novo } = await base(t);
  await novo({ codigo: 'A1', nome: 'A', meta: 10 });
  await novo({ codigo: 'B1', nome: 'B', meta: 10 });
  const csv = 'Código;Período;Valor;Comentário\nA1;01/2026;12,5;ok\nB1;2026-01;8;\nZZ;2026-01;1;\nA1;2026-02;abc;\n';
  const enviar = (nome, buf, sim) => req('POST', `/indicadores/importar?nome=${nome}${sim ? '&simular=1' : ''}`, buf, { headers: { 'Content-Type': 'application/octet-stream' } });
  const sim = (await enviar('m.csv', Buffer.from(csv), true)).body;
  assert.equal(sim.simulacao, true);
  assert.equal(sim.importadas, 2);
  assert.equal(sim.erros, 2);
  assert.equal((await req('GET', '/indicadores')).body.find((i) => i.codigo === 'A1').ultima_medicao, null, 'simulação não grava');
  const real = (await enviar('m.csv', Buffer.from(csv))).body;
  assert.equal(real.importadas, 2);
  assert.equal(real.linhas.find((l) => l.codigo === 'A1').valor, 12.5);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Dados');
  ws.addRow(['codigo', 'periodo', 'valor']);
  ws.addRow(['B1', new Date(Date.UTC(2026, 2, 1)), 9]);
  const x = (await enviar('m.xlsx', Buffer.from(await wb.xlsx.writeBuffer()))).body;
  assert.equal(x.importadas, 1);
  assert.equal(x.linhas[0].periodo, '2026-03');
  assert.equal((await enviar('m.pdf', Buffer.from('x'))).status, 400);
});

test('integração HTTP/JSON coleta o valor do indicador', async (t) => {
  const api = http.createServer((rq, rs) => {
    if (rq.headers['x-api-key'] !== 'segredo') { rs.statusCode = 401; return rs.end(); }
    rs.setHeader('Content-Type', 'application/json'); return rs.end(JSON.stringify({ data: { kpis: [{ total: '1.234,5' }] } }));
  });
  await new Promise((ok) => api.listen(0, '127.0.0.1', ok));
  t.after(() => api.close());
  const { req, novo } = await base(t);
  const i = await novo({ codigo: 'ERP', nome: 'Faturamento ERP', meta: 1000 });
  assert.equal((await req('POST', '/indicadores/integracoes', { indicador_id: i.id, url: 'file:///etc/passwd', caminho: 'x' })).status, 400);
  const g = (await req('POST', '/indicadores/integracoes', { indicador_id: i.id, url: `http://127.0.0.1:${api.address().port}/kpi`,
    caminho: 'data.kpis[0].total', cabecalhos: { 'x-api-key': 'segredo' } })).body;
  assert.deepEqual(g.cabecalhos, ['x-api-key'], 'não expõe valores dos cabeçalhos');
  const r = (await req('POST', `/indicadores/integracoes/${g.id}/executar`)).body;
  assert.match(r.status, /^ok: .* = 1234.5 \(atingido\)/);
  assert.equal((await req('GET', `/indicadores/${i.id}`)).body.ultima_medicao.valor, 1234.5);
});

test('assistente: histórico local e Claude (cliente simulado) com saída estruturada', async (t) => {
  let chamada = null;
  const clienteIa = { beta: { messages: { create: async (p) => {
    chamada = p;
    return { model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({
      resumo: 'Provável falha de setup', causas_provaveis: [{ causa: 'Setup sem padrão', categoria_6m: 'metodo', justificativa: 'histórico', confianca: 'alta', baseada_no_historico: true }],
      acoes_sugeridas: [{ o_que: 'Padronizar setup', por_que: 'Eliminar variação', como: 'POP', tipo: 'corretiva', prazo_dias: 15 }],
      perguntas_para_investigar: ['Houve troca de turno?'] }) }] };
  } } } };
  const { req, novo } = await base(t, { clienteIa });
  const i = await novo({ codigo: 'R', nome: 'Rendimento', meta: 90, limite_inferior: 85 });
  const m1 = (await req('POST', `/indicadores/${i.id}/medicoes`, { periodo: '2026-01', valor: 70 })).body;
  const an = (await req('POST', `/indicadores/medicoes/${m1.id}/analises`, { tecnica: '5porques', conteudo: { problema: 'Baixo', porques: ['Setup errado', 'Sem padrão de setup'] } })).body;
  const pl = (await req('POST', '/planos', { indicador_id: i.id, analise_id: an.id, titulo: 'Padronizar', acoes: [{ o_que: 'Criar POP de setup', quando: '2026-02-01', quem: 'Eng', status: 'concluida' }] })).body;
  await req('PUT', `/planos/${pl.id}`, { status: 'concluido' });
  await req('PUT', `/planos/${pl.id}`, { status: 'concluido', eficacia: 'eficaz' });
  const m2 = (await req('POST', `/indicadores/${i.id}/medicoes`, { periodo: '2026-05', valor: 72 })).body;

  const local = (await req('POST', `/indicadores/medicoes/${m2.id}/sugestoes`)).body;
  assert.equal(local.fonte, 'historico');
  assert.equal(local.causas_provaveis[0].causa, 'Sem padrão de setup');
  assert.equal(local.acoes_sugeridas[0].o_que, 'Criar POP de setup');
  assert.equal(chamada, null, 'sem opt-in nada é enviado para fora');

  await req('PUT', '/configuracoes', { ia_habilitada: '1' });
  const ia = (await req('POST', `/indicadores/medicoes/${m2.id}/sugestoes`)).body;
  assert.equal(ia.fonte, 'claude');
  assert.equal(ia.causas_provaveis[0].categoria_6m, 'metodo');
  assert.equal(chamada.model, 'claude-opus-5-5');
  assert.equal(chamada.output_config.format.type, 'json_schema');
  assert.equal(chamada.fallbacks, 'default');
  assert.match(chamada.messages[0].content, /Sem padrão de setup/);
});

test('filtros por responsável, status "sem medição" e planos em aberto', async (t) => {
  const { req, novo } = await base(t);
  const a = await novo({ codigo: 'R1', nome: 'Receita', meta: 10, responsavel: 'Ana Souza' });
  const b = await novo({ codigo: 'R2', nome: 'Custo', meta: 10, responsavel: 'Bruno Lima' });
  await req('POST', `/indicadores/${a.id}/medicoes`, { periodo: '2026-01', valor: 12 });
  assert.deepEqual((await req('GET', '/indicadores?responsavel=ana')).body.map((i) => i.codigo), ['R1']);
  assert.deepEqual((await req('GET', '/indicadores?status=sem_medicao')).body.map((i) => i.codigo), ['R2']);
  const p1 = (await req('POST', '/planos', { indicador_id: a.id, titulo: 'Plano da Ana', responsavel: 'Ana Souza' })).body;
  await req('POST', '/planos', { indicador_id: b.id, titulo: 'Plano do Bruno', acoes: [{ o_que: 'X', quando: '2026-02-01', quem: 'Carla Mendes', status: 'concluida' }] });
  assert.deepEqual((await req('GET', '/planos?responsavel=carla')).body.map((p) => p.titulo), ['Plano do Bruno'], 'responsável de ação também conta');
  await req('PUT', `/planos/${p1.id}`, { status: 'cancelado' });
  assert.deepEqual((await req('GET', '/planos?status=abertos')).body.map((p) => p.titulo), ['Plano do Bruno']);
  assert.deepEqual((await req('GET', '/indicadores/responsaveis')).body, ['Ana Souza', 'Bruno Lima', 'Carla Mendes']);
});
