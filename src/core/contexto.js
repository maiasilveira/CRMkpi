'use strict';
// Contexto da requisição (usuário autenticado) propagado sem precisar passar parâmetros.
// Fora de uma requisição (seed, jobs agendados, testes de serviço) o contexto é "sistema":
// acesso total.
const { AsyncLocalStorage } = require('node:async_hooks');

const als = new AsyncLocalStorage();
const executarComo = (usuario, fn) => als.run({ usuario }, fn);
const usuarioAtual = () => als.getStore()?.usuario || null;

module.exports = { als, executarComo, usuarioAtual };
