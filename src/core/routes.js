'use strict';
const express = require('express');

function rotasCore(core, modulosAtivos) {
  const r = express.Router();
  r.get('/modulos', (req, res) => res.json(modulosAtivos));
  r.get('/departamentos', (req, res) => res.json(core.listarDepartamentos({ incluirInativos: req.query.todos === '1' })));
  r.get('/departamentos/:id', (req, res) => res.json(core.obterDepartamento(Number(req.params.id))));
  r.post('/departamentos', (req, res) => res.status(201).json(core.salvarDepartamento(req.body)));
  r.put('/departamentos/:id', (req, res) => res.json(core.salvarDepartamento(req.body, Number(req.params.id))));
  r.get('/auditoria', (req, res) => res.json(core.listarAuditoria(req.query)));
  return r;
}
module.exports = { rotasCore };
