'use strict';
const express = require('express');

function rotasMetas(s) {
  const r = express.Router();
  const n = (v) => Number(v);

  r.get('/ciclos', (req, res) => res.json(s.listarCiclos()));
  r.post('/ciclos', (req, res) => res.status(201).json(s.salvarCiclo(req.body)));
  r.get('/ciclos/:id', (req, res) => res.json(s.obterCiclo(n(req.params.id))));
  r.put('/ciclos/:id', (req, res) => res.json(s.salvarCiclo(req.body, n(req.params.id))));
  r.get('/ciclos/:id/apuracao', (req, res) => res.json(s.apurarCiclo(n(req.params.id))));
  r.post('/ciclos/:id/encerrar', (req, res) => res.json(s.encerrarCiclo(n(req.params.id))));
  r.get('/ciclos/:id/exportar.csv', (req, res) => {
    res.type('text/csv; charset=utf-8').attachment(`apuracao-ciclo-${req.params.id}.csv`).send(s.exportarCsv(n(req.params.id)));
  });
  r.put('/ciclos/:id/departamentos/:did/bonus', (req, res) => res.json(s.definirBonus(n(req.params.id), n(req.params.did), req.body)));
  r.post('/ciclos/:id/departamentos/:did/:acao(submeter|aprovar|reabrir)', (req, res) =>
    res.json(s.transicionar(n(req.params.id), n(req.params.did), req.params.acao, req.body?.usuario)));
  r.post('/ciclos/:id/departamentos/:did/simular', (req, res) => res.json(s.simular(n(req.params.id), n(req.params.did), req.body?.valores)));

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
