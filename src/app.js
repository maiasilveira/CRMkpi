'use strict';
const express = require('express');
const path = require('node:path');
const { abrirBanco } = require('./db');
const migrarCore = require('./core/schema');
const { criarCoreService } = require('./core/service');
const { rotasCore, rotasAuth } = require('./core/routes');
const { middlewareAutenticacao } = require('./core/autenticacao');
const { criarSso } = require('./core/sso');

// Catálogo de módulos. A ordem importa apenas para injeção de dependências opcionais.
const CATALOGO = {
  indicadores: require('./modules/indicadores'),
  metas: require('./modules/metas'),
};

/**
 * Cria a aplicação.
 * @param {object} opts
 * @param {string} [opts.dbFile]    caminho do banco (':memory:' para testes)
 * @param {string[]} [opts.modulos] módulos a ativar (padrão: env MODULOS ou todos)
 */
function criarApp({ dbFile, modulos } = {}) {
  const ativos = modulos || (process.env.MODULOS ? process.env.MODULOS.split(',').map((s) => s.trim()) : Object.keys(CATALOGO));
  const db = abrirBanco(dbFile);
  migrarCore(db);
  const core = criarCoreService(db);

  const sso = criarSso(core);

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
    registrados[nome] = CATALOGO[nome].registrar({ app, db, core, modulos: registrados });
  }
  const infoModulos = Object.keys(registrados).map((n) => ({ nome: n, titulo: CATALOGO[n].titulo }));
  app.use('/api', rotasCore(core, infoModulos));

  app.use('/api', (req, res) => res.status(404).json({ erro: 'Rota não encontrada' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Tratamento centralizado de erros
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ erro: status >= 500 ? 'Erro interno' : err.message });
  });

  return { app, db, core, modulos: registrados };
}

module.exports = { criarApp, CATALOGO };
