'use strict';
// Verificações periódicas do módulo Indicadores (executadas pelo agendador do núcleo).

const periodoAnterior = (d = new Date()) => {
  const a = d.getFullYear(); const m = d.getMonth(); // getMonth() = mês anterior em base 1
  return m === 0 ? `${a - 1}-12` : `${a}-${String(m).padStart(2, '0')}`;
};
const somarDias = (n, d = new Date()) => new Date(d.getTime() + n * 864e5).toISOString().slice(0, 10);

function registrarAlertasIndicadores(db, core, notif, { hoje = () => new Date() } = {}) {
  // 1) Medição do mês anterior não lançada até o dia-limite
  notif.registrarVerificacao('lancamento_atrasado', () => {
    const agora = hoje();
    const diaLimite = Number(core.obterConfig('dia_limite_lancamento', 10));
    if (agora.getDate() <= diaLimite) return [];
    const periodo = periodoAnterior(agora);
    return db.prepare(`SELECT i.id, i.nome, i.departamento_id, i.responsavel FROM ind_indicadores i
        WHERE i.ativo=1 AND i.frequencia='mensal' AND COALESCE(i.tipo,'manual')='manual'
          AND NOT EXISTS (SELECT 1 FROM ind_medicoes m WHERE m.indicador_id=i.id AND m.periodo=?)`).all(periodo)
      .map((i) => ({ usuarios: [...notif.gestoresDe(i.departamento_id), ...notif.porNome(i.responsavel)], tipo: 'lancamento',
        titulo: `Lançamento pendente: ${i.nome}`, link: `#/indicadores/${i.id}`, chave: `lanc:${i.id}:${periodo}`,
        mensagem: `O valor de ${periodo} do indicador "${i.nome}" não foi lançado até o dia ${diaLimite}.` }));
  });

  // 2) Ações de planos vencendo em até 3 dias ou vencidas
  notif.registrarVerificacao('acoes_prazo', () => {
    const h = hoje().toISOString().slice(0, 10);
    const limite = somarDias(3, hoje());
    return db.prepare(`SELECT a.id, a.o_que, a.quando, a.quem, p.id plano_id, p.titulo, i.departamento_id FROM ind_acoes a
        JOIN ind_planos p ON p.id=a.plano_id JOIN ind_indicadores i ON i.id=p.indicador_id
        WHERE a.status IN ('pendente','em_andamento') AND p.status IN ('aberto','em_andamento') AND a.quando <= ?`).all(limite)
      .map((a) => {
        const vencida = a.quando < h;
        return { usuarios: [...notif.porNome(a.quem), ...notif.gestoresDe(a.departamento_id)], tipo: vencida ? 'acao_atrasada' : 'acao_vencendo',
          titulo: `${vencida ? 'Ação atrasada' : 'Ação vence em breve'}: ${a.o_que}`, link: `#/planos/${a.plano_id}`,
          chave: `acao:${a.id}:${vencida ? 'atrasada' : 'vencendo'}:${a.quando}`,
          mensagem: `A ação "${a.o_que}" do plano "${a.titulo}" ${vencida ? 'venceu' : 'vence'} em ${a.quando.split('-').reverse().join('/')}. Responsável: ${a.quem}.` };
      });
  });

  // 3) Planos concluídos há mais de 30 dias sem verificação de eficácia
  notif.registrarVerificacao('eficacia_pendente', () => db.prepare(`SELECT p.id, p.titulo, i.departamento_id,
        (SELECT MAX(concluida_em) FROM ind_acoes WHERE plano_id=p.id) fim FROM ind_planos p JOIN ind_indicadores i ON i.id=p.indicador_id
        WHERE p.status='concluido' AND p.eficacia='pendente'`).all()
    .filter((p) => p.fim && p.fim <= somarDias(-30, hoje()))
    .map((p) => ({ usuarios: notif.gestoresDe(p.departamento_id), tipo: 'eficacia', titulo: `Verificar eficácia: ${p.titulo}`,
      link: `#/planos/${p.id}`, chave: `efic:${p.id}`, mensagem: `O plano "${p.titulo}" foi concluído há mais de 30 dias. Registre a verificação de eficácia.` })));
}

module.exports = { registrarAlertasIndicadores, periodoAnterior };
