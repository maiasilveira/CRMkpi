'use strict';
// Módulo Indicadores — autocontido: schema, regras, serviço e rotas próprias.
const migrar = require('./schema');
const { criarIndicadoresService } = require('./service');
const { rotasIndicadores, rotasPlanos } = require('./routes');

module.exports = {
  nome: 'indicadores',
  titulo: 'Indicadores de Desempenho',
  registrar({ app, db, core }) {
    migrar(db);
    const service = criarIndicadoresService(db, core);
    app.use('/api/indicadores', rotasIndicadores(service));
    app.use('/api/planos', rotasPlanos(service));
    return { service, api: service.api };
  },
};
