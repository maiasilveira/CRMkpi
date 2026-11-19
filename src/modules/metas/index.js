'use strict';
// Módulo Metas Bonificáveis — autocontido. Depende apenas do núcleo (departamentos/auditoria).
// A integração com Indicadores é OPCIONAL e feita via API pública injetada (fonteIndicadores).
const migrar = require('./schema');
const { criarMetasService } = require('./service');
const { rotasMetas } = require('./routes');

module.exports = {
  nome: 'metas',
  titulo: 'Metas Bonificáveis',
  registrar({ app, db, core, modulos }) {
    migrar(db);
    const service = criarMetasService(db, core, modulos.indicadores?.api || null);
    app.use('/api/metas', rotasMetas(service));
    return { service };
  },
};
