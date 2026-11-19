'use strict';
const express = require('express');

function rotasIndicadores(s) {
  const r = express.Router();
  const id = (req, k = 'id') => Number(req.params[k]);

  r.get('/painel', (req, res) => res.json(s.painel()));

  r.get('/', (req, res) => res.json(s.listar({ ...req.query, todos: req.query.todos === '1' })));
  r.post('/', (req, res) => res.status(201).json(s.salvar(req.body)));
  r.get('/:id', (req, res) => res.json(s.obter(id(req))));
  r.put('/:id', (req, res) => res.json(s.salvar(req.body, id(req))));
  r.delete('/:id', (req, res) => { s.excluir(id(req)); res.status(204).end(); });

  r.get('/:id/medicoes', (req, res) => res.json(s.listarMedicoes(id(req))));
  r.post('/:id/medicoes', (req, res) => res.status(201).json(s.registrarMedicao(id(req), req.body)));
  r.delete('/medicoes/:mid', (req, res) => { s.excluirMedicao(id(req, 'mid')); res.status(204).end(); });

  r.get('/:id/analises', (req, res) => res.json(s.listarAnalises(id(req))));
  r.post('/medicoes/:mid/analises', (req, res) => res.status(201).json(s.registrarAnalise(id(req, 'mid'), req.body)));
  r.delete('/analises/:aid', (req, res) => { s.excluirAnalise(id(req, 'aid')); res.status(204).end(); });

  return r;
}

function rotasPlanos(s) {
  const r = express.Router();
  const id = (req, k = 'id') => Number(req.params[k]);
  r.get('/', (req, res) => res.json(s.listarPlanos(req.query)));
  r.post('/', (req, res) => res.status(201).json(s.criarPlano(req.body)));
  r.get('/:id', (req, res) => res.json(s.obterPlano(id(req))));
  r.put('/:id', (req, res) => res.json(s.atualizarPlano(id(req), req.body)));
  r.delete('/:id', (req, res) => { s.excluirPlano(id(req)); res.status(204).end(); });
  r.post('/:id/acoes', (req, res) => res.status(201).json(s.adicionarAcao(id(req), req.body)));
  r.put('/acoes/:aid', (req, res) => res.json(s.atualizarAcao(id(req, 'aid'), req.body)));
  r.delete('/acoes/:aid', (req, res) => res.json(s.excluirAcao(id(req, 'aid'))));
  return r;
}

module.exports = { rotasIndicadores, rotasPlanos };
