'use strict';
// Módulo Metas Bonificáveis — autocontido. Depende apenas do núcleo (departamentos/auditoria).
// A integração com Indicadores é OPCIONAL e feita via API pública injetada (fonteIndicadores).
const migrar = require('./schema');
const { criarMetasService } = require('./service');
const { rotasMetas } = require('./routes');
const { criarPessoasService } = require('./pessoas');

module.exports = {
  nome: 'metas',
  titulo: 'Metas Bonificáveis',
  registrar({ app, db, core, modulos, notificacoes }) {
    migrar(db);
    const service = criarMetasService(db, core, modulos.indicadores?.api || null);
    // Lembrete: apuração submetida há mais de 3 dias sem aprovação
    notificacoes?.registrarVerificacao('apuracao_pendente', () => db.prepare(`SELECT b.ciclo_id, b.departamento_id, b.submetido_em, c.nome ciclo, d.nome depto
        FROM met_bonus b JOIN met_ciclos c ON c.id=b.ciclo_id JOIN departamentos d ON d.id=b.departamento_id
        WHERE b.status='submetido' AND c.status<>'encerrado' AND b.submetido_em <= ?`).all(new Date(Date.now() - 3 * 864e5).toISOString())
      .map((b) => ({ usuarios: notificacoes.porPerfil('diretoria', 'admin'), tipo: 'apuracao', titulo: `Apuração aguardando aprovação: ${b.depto}`,
        link: `#/metas?ciclo=${b.ciclo_id}`, chave: `apur:${b.ciclo_id}:${b.departamento_id}:${b.submetido_em}`,
        mensagem: `A apuração do departamento ${b.depto} no ciclo ${b.ciclo} aguarda aprovação desde ${b.submetido_em.slice(0, 10).split('-').reverse().join('/')}.` })));
    const pessoas = criarPessoasService(db, core, service);
    app.use('/api/metas', rotasMetas(service, pessoas, core));
    return { service, pessoas };
  },
};
