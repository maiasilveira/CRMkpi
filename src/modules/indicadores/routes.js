'use strict';
const express = require('express');

const assinc = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

function rotasIndicadores(s, { entrada, ia }) {
  const r = express.Router();
  const id = (req, k = 'id') => Number(req.params[k]);

  r.get('/painel', (req, res) => res.json(s.painel()));
  r.get('/mapa', (req, res) => res.json(s.mapaEstrategico()));
  r.get('/responsaveis', (req, res) => res.json(s.listarResponsaveis()));
  r.post('/objetivos', (req, res) => res.status(201).json(s.salvarObjetivo(req.body)));
  r.put('/objetivos/:oid', (req, res) => res.json(s.salvarObjetivo(req.body, id(req, 'oid'))));
  r.delete('/objetivos/:oid', (req, res) => { s.excluirObjetivo(id(req, 'oid')); res.status(204).end(); });

  r.post('/importar', express.raw({ type: () => true, limit: '12mb' }), assinc(async (req, res) =>
    res.json(await entrada.importarMedicoes(req.query.nome, req.body, { simular: req.query.simular === '1' }))));
  r.get('/integracoes', (req, res) => res.json(entrada.listarIntegracoes()));
  r.post('/integracoes', (req, res) => res.status(201).json(entrada.salvarIntegracao(req.body)));
  r.delete('/integracoes/:gid', (req, res) => { entrada.excluirIntegracao(id(req, 'gid')); res.status(204).end(); });
  r.post('/integracoes/:gid/executar', assinc(async (req, res) => {
    res.json(await entrada.executarIntegracao(id(req, 'gid')));
  }));

  r.get('/', (req, res) => res.json(s.listar({ ...req.query, todos: req.query.todos === '1' })));
  r.post('/', (req, res) => res.status(201).json(s.salvar(req.body)));
  r.get('/:id', (req, res) => res.json(s.obter(id(req))));
  r.put('/:id', (req, res) => res.json(s.salvar(req.body, id(req))));
  r.delete('/:id', (req, res) => { s.excluir(id(req)); res.status(204).end(); });
  r.get('/:id/versoes', (req, res) => res.json(s.listarVersoes(id(req))));
  r.get('/:id/cep', (req, res) => res.json(s.cartaControle(id(req))));
  r.get('/:id/metas-periodo', (req, res) => res.json(s.listarMetasPeriodo(id(req))));
  r.post('/:id/metas-periodo', (req, res) => res.json(s.salvarMetaPeriodo(id(req), req.body)));
  r.delete('/:id/metas-periodo/:periodo', (req, res) => res.json(s.excluirMetaPeriodo(id(req), req.params.periodo)));

  r.get('/:id/medicoes', (req, res) => res.json(s.listarMedicoes(id(req))));
  r.post('/:id/medicoes', (req, res) => res.status(201).json(s.registrarMedicao(id(req), req.body)));
  r.delete('/medicoes/:mid', (req, res) => { s.excluirMedicao(id(req, 'mid')); res.status(204).end(); });
  r.post('/medicoes/:mid/sugestoes', assinc(async (req, res) => res.json(await ia.sugerir(id(req, 'mid')))));

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
