'use strict';
// Módulo Indicadores — autocontido: schema, regras, serviço e rotas próprias.
const migrar = require('./schema');
const { criarIndicadoresService } = require('./service');
const { rotasIndicadores, rotasPlanos } = require('./routes');
const { registrarAlertasIndicadores } = require('./alertas');

module.exports = {
  nome: 'indicadores',
  titulo: 'Indicadores de Desempenho',
  registrar({ app, db, core, notificacoes }) {
    migrar(db);
    const service = criarIndicadoresService(db, core);
    if (notificacoes) registrarAlertasIndicadores(db, core, notificacoes);
    app.use('/api/indicadores', rotasIndicadores(service));
    app.use('/api/planos', rotasPlanos(service));
    return { service, api: service.api };
  },
};
