'use strict';
// Módulo Governança — benchmark entre áreas e reuniões de análise crítica.
// Usa Indicadores e Metas se estiverem ativos (dependências opcionais).
const express = require('express');
const migrar = require('./schema');
const { criarGovernancaService } = require('./service');

module.exports = {
  nome: 'governanca',
  titulo: 'Governança',
  registrar({ app, db, core, modulos, notificacoes }) {
    migrar(db);
    const s = criarGovernancaService(db, core, { indicadores: modulos.indicadores?.service, metas: modulos.metas?.service });
    notificacoes?.registrarVerificacao('decisoes_atrasadas', () => db.prepare(`SELECT d.*, r.titulo, r.departamento_id FROM gov_decisoes d
        JOIN gov_reunioes r ON r.id=d.reuniao_id WHERE d.status='pendente' AND d.prazo < ?`).all(new Date().toISOString().slice(0, 10))
      .map((d) => ({ usuarios: [...notificacoes.porNome(d.responsavel), ...(d.departamento_id ? notificacoes.gestoresDe(d.departamento_id) : notificacoes.porPerfil('diretoria'))],
        tipo: 'decisao_atrasada', titulo: `Encaminhamento atrasado: ${d.descricao.slice(0, 60)}`, link: `#/reunioes/${d.reuniao_id}`, chave: `decisao:${d.id}:${d.prazo}`,
        mensagem: `O encaminhamento "${d.descricao}" da reunião "${d.titulo}" venceu em ${d.prazo.split('-').reverse().join('/')}.` })));

    const r = express.Router();
    const n = (v) => Number(v);
    r.get('/benchmark', (req, res) => res.json(s.benchmark(req.query)));
    r.get('/reunioes', (req, res) => res.json(s.listarReunioes()));
    r.get('/reunioes/pauta-previa', (req, res) => res.json(s.gerarPauta(req.query.departamento_id ? n(req.query.departamento_id) : null)));
    r.post('/reunioes', (req, res) => res.status(201).json(s.salvarReuniao(req.body)));
    r.get('/reunioes/:id', (req, res) => res.json(s.obterReuniao(n(req.params.id))));
    r.put('/reunioes/:id', (req, res) => res.json(s.salvarReuniao(req.body, n(req.params.id))));
    r.delete('/reunioes/:id', (req, res) => { s.excluirReuniao(n(req.params.id)); res.status(204).end(); });
    r.post('/reunioes/:id/pauta', (req, res) => res.json(s.atualizarPauta(n(req.params.id))));
    r.post('/reunioes/:id/decisoes', (req, res) => res.status(201).json(s.salvarDecisao(n(req.params.id), req.body)));
    r.put('/reunioes/:id/decisoes/:did', (req, res) => res.json(s.salvarDecisao(n(req.params.id), req.body, n(req.params.did))));
    r.delete('/reunioes/:id/decisoes/:did', (req, res) => res.json(s.excluirDecisao(n(req.params.id), n(req.params.did))));
    app.use('/api/governanca', r);
    return { service: s };
  },
};
