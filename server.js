'use strict';
const { criarApp } = require('./src/app');

const { app, modulos } = criarApp();
const porta = Number(process.env.PORT) || 3000;
app.listen(porta, () => {
  console.log(`KPI & Metas rodando em http://localhost:${porta}`);
  console.log(`Módulos ativos: ${Object.keys(modulos).join(', ') || '(nenhum)'}`);
});
