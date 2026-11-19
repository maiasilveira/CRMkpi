'use strict';
const express = require('express');
const path = require('node:path');
const os = require('node:os');
const { abrirBanco } = require('./db');
const migrarCore = require('./core/schema');
const { criarCoreService } = require('./core/service');
const { rotasCore, rotasAuth, rotasColaboracao } = require('./core/routes');
const { middlewareAutenticacao } = require('./core/autenticacao');
const { criarSso } = require('./core/sso');
const { criarAgendador } = require('./core/agendador');
const { criarNotificacoesService } = require('./core/notificacoes');
const { criarColaboracaoService } = require('./core/colaboracao');

// Catálogo de módulos. A ordem importa apenas para injeção de dependências opcionais.
const CATALOGO = {
  indicadores: require('./modules/indicadores'),
  metas: require('./modules/metas'),
  governanca: require('./modules/governanca'),
};

/**
 * Cria a aplicação.
 * @param {object} opts
 * @param {string}   [opts.dbFile]        caminho do banco (':memory:' para testes)
 * @param {string[]} [opts.modulos]       módulos a ativar (padrão: env MODULOS ou todos)
 * @param {boolean}  [opts.semAgendador]  não inicia tarefas periódicas (testes/seed)
 * @param {object}   [opts.transporteEmail] transporte de e-mail alternativo (testes)
 */
function criarApp({ dbFile, modulos, semAgendador = false, transporteEmail, clienteIa } = {}) {
  const ativos = modulos || (process.env.MODULOS ? process.env.MODULOS.split(',').map((s) => s.trim()) : Object.keys(CATALOGO));
  const arquivoDb = dbFile || process.env.DB_FILE || path.join(__dirname, '..', 'data', 'kpi.db');
  const db = abrirBanco(arquivoDb);
  migrarCore(db);
  const core = criarCoreService(db);
  const dirDados = arquivoDb === ':memory:' ? path.join(os.tmpdir(), `kpi-${process.pid}-${Date.now()}`) : path.dirname(path.resolve(arquivoDb));
  const dirAnexos = process.env.ANEXOS_DIR || path.join(dirDados, 'anexos');

  const agendador = criarAgendador({ ativo: !semAgendador });
  const notificacoes = criarNotificacoesService(core, { transporteEmail });
  const colaboracao = criarColaboracaoService(core, { dirAnexos });
  const sso = criarSso(core);
  const servicos = { core, notificacoes, colaboracao, agendador, dirDados, clienteIa };

  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  app.use('/api', express.json({ limit: '2mb' }));
  app.use('/api', middlewareAutenticacao(core, { publicas: ['/auth'] }));
  app.use('/api/auth', rotasAuth(core, sso));

  const registrados = {};
  for (const nome of Object.keys(CATALOGO)) {
    if (!ativos.includes(nome)) continue;
    registrados[nome] = CATALOGO[nome].registrar({ app, db, core, modulos: registrados, ...servicos });
  }
  const infoModulos = Object.keys(registrados).map((n) => ({ nome: n, titulo: CATALOGO[n].titulo }));
  app.use('/api', rotasCore(core, infoModulos));
  app.use('/api', rotasColaboracao(core, notificacoes, colaboracao, agendador));

  // Verificações de alertas a cada hora (as notificações têm chave para não se repetirem)
  agendador.registrar('verificacoes', 60 * 60e3, () => notificacoes.executarVerificacoes());

  app.use('/api', (req, res) => res.status(404).json({ erro: 'Rota não encontrada' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Tratamento centralizado de erros
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ erro: status >= 500 ? 'Erro interno' : err.message });
  });

  return { app, db, core, modulos: registrados, ...servicos, encerrar: () => agendador.parar() };
}

module.exports = { criarApp, CATALOGO };
