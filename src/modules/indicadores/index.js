'use strict';
// Módulo Indicadores — autocontido: schema, regras, serviço e rotas próprias.
const migrar = require('./schema');
const { criarIndicadoresService } = require('./service');
const { criarEntradaService } = require('./entrada');
const { criarIaService } = require('./ia');
const { rotasIndicadores, rotasPlanos } = require('./routes');
const { registrarAlertasIndicadores } = require('./alertas');

module.exports = {
  nome: 'indicadores',
  titulo: 'Indicadores de Desempenho',
  registrar({ app, db, core, notificacoes, agendador, clienteIa }) {
    migrar(db);
    const service = criarIndicadoresService(db, core);
    const entrada = criarEntradaService(db, core, service);
    const ia = criarIaService(db, core, service, { cliente: clienteIa });
    if (notificacoes) registrarAlertasIndicadores(db, core, notificacoes);
    // Coleta das integrações a cada 6 horas (o período é sobrescrito, então repetir é seguro)
    agendador?.registrar('integracoes_indicadores', 6 * 60 * 60e3, () => entrada.executarTodas());
    app.use('/api/indicadores', rotasIndicadores(service, { entrada, ia }));
    app.use('/api/planos', rotasPlanos(service));
    return { service, entrada, ia, api: service.api };
  },
};
