'use strict';
const express = require('express');
const { pdfAcordo, pdfApuracao } = require('./relatorios');

const assinc = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const planilha = express.raw({ type: () => true, limit: '12mb' });

function rotasMetas(s, p, core) {
  const r = express.Router();
  const n = (v) => Number(v);

  r.get('/ciclos', (req, res) => res.json(s.listarCiclos()));
  r.post('/ciclos', (req, res) => res.status(201).json(s.salvarCiclo(req.body)));
  r.get('/ciclos/:id', (req, res) => { const c = s.obterCiclo(n(req.params.id)); res.json({ ...c, snapshot: undefined }); });
  r.put('/ciclos/:id', (req, res) => res.json(s.salvarCiclo(req.body, n(req.params.id))));
  r.put('/ciclos/:id/gatilho', (req, res) => {
    const c = s.obterCiclo(n(req.params.id));
    res.json(s.salvarCiclo({ ...c, snapshot: undefined, gatilho_corp_resultado: req.body?.resultado }, c.id));
  });
  r.get('/ciclos/:id/apuracao', (req, res) => res.json(s.apurarCiclo(n(req.params.id))));
  r.post('/ciclos/:id/encerrar', (req, res) => res.json(s.encerrarCiclo(n(req.params.id))));
  r.get('/ciclos/:id/exportar.csv', (req, res) => {
    res.type('text/csv; charset=utf-8').attachment(`apuracao-ciclo-${req.params.id}.csv`).send(s.exportarCsv(n(req.params.id)));
  });
  r.get('/ciclos/:id/individuais.csv', (req, res) => {
    res.type('text/csv; charset=utf-8').attachment(`bonus-individual-ciclo-${req.params.id}.csv`).send(p.exportarIndividuaisCsv(n(req.params.id)));
  });
  r.get('/ciclos/:id/acordo.pdf', assinc(async (req, res) => {
    core.exigirPerfil('diretoria');
    const c = s.obterCiclo(n(req.params.id));
    const grupos = new Map();
    for (const m of s.listarMetas({ ciclo_id: c.id })) { if (!grupos.has(m.departamento)) grupos.set(m.departamento, []); grupos.get(m.departamento).push(m); }
    res.type('application/pdf').attachment(`acordo-${c.nome}.pdf`).send(await pdfAcordo(c, grupos));
  }));
  r.get('/ciclos/:id/apuracao.pdf', assinc(async (req, res) => {
    core.exigirPerfil('diretoria');
    const c = s.obterCiclo(n(req.params.id));
    const ap = s.apurarCiclo(c.id);
    res.type('application/pdf').attachment(`apuracao-${c.nome}.pdf`).send(await pdfApuracao(c, ap, p.apurarIndividuais(c.id, ap)));
  }));
  r.put('/ciclos/:id/departamentos/:did/bonus', (req, res) => res.json(s.definirBonus(n(req.params.id), n(req.params.did), req.body)));
  r.post('/ciclos/:id/departamentos/:did/:acao(submeter|aprovar|reabrir)', (req, res) =>
    res.json(s.transicionar(n(req.params.id), n(req.params.did), req.params.acao, req.body?.usuario)));
  r.post('/ciclos/:id/departamentos/:did/simular', (req, res) => res.json(s.simular(n(req.params.id), n(req.params.did), req.body?.valores)));

  // Participantes e bônus individual
  r.get('/ciclos/:id/participantes', (req, res) => res.json(p.listarParticipacoes(n(req.params.id))));
  r.post('/ciclos/:id/participantes/incluir-todos', (req, res) => res.json(p.incluirTodos(n(req.params.id), req.body?.multiplo_salarios)));
  r.put('/ciclos/:id/participantes/:cid', (req, res) => res.json(p.salvarParticipacao(n(req.params.id), n(req.params.cid), req.body)));
  r.delete('/ciclos/:id/participantes/:cid', (req, res) => { p.removerParticipacao(n(req.params.id), n(req.params.cid)); res.status(204).end(); });
  r.get('/ciclos/:id/individuais', (req, res) => res.json(p.apurarIndividuais(n(req.params.id))));
  r.get('/ciclos/:id/meu-bonus', (req, res) => res.json(p.meuBonus(n(req.params.id))));
  r.get('/ciclos/:id/desdobramento', (req, res) => res.json(p.arvoreMetas(n(req.params.id))));

  r.get('/colaboradores', (req, res) => res.json(p.listarColaboradores({ ...req.query, todos: req.query.todos === '1' })));
  r.post('/colaboradores', (req, res) => res.status(201).json(p.salvarColaborador(req.body)));
  r.post('/colaboradores/importar', planilha, assinc(async (req, res) =>
    res.json(await p.importarColaboradores(req.query.nome, req.body, { simular: req.query.simular === '1' }))));
  r.get('/colaboradores/:id', (req, res) => res.json(p.obterColaborador(n(req.params.id))));
  r.put('/colaboradores/:id', (req, res) => res.json(p.salvarColaborador(req.body, n(req.params.id))));

  r.get('/alteracoes', (req, res) => res.json(s.listarAlteracoes(req.query)));
  r.post('/alteracoes/:id/:decisao(aprovar|rejeitar)', (req, res) =>
    res.json(s.decidirAlteracao(n(req.params.id), req.params.decisao === 'aprovar', req.body?.motivo)));

  r.get('/indicadores-disponiveis', (req, res) => res.json(s.indicadoresDisponiveis()));

  r.get('/', (req, res) => res.json(s.listarMetas(req.query)));
  r.post('/', (req, res) => res.status(201).json(s.salvarMeta(req.body)));
  r.get('/:id', (req, res) => res.json(s.obterMeta(n(req.params.id))));
  r.put('/:id', (req, res) => res.json(s.salvarMeta(req.body, n(req.params.id))));
  r.delete('/:id', (req, res) => { s.excluirMeta(n(req.params.id)); res.status(204).end(); });
  r.post('/:id/resultados', (req, res) => res.status(201).json(s.registrarResultado(n(req.params.id), req.body)));
  r.delete('/:id/resultados/:periodo', (req, res) => res.json(s.excluirResultado(n(req.params.id), req.params.periodo)));
  return r;
}
module.exports = { rotasMetas };
