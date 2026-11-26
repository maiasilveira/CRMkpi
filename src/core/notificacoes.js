'use strict';
// Notificações: caixa de entrada no sistema + e-mail (SMTP) + webhooks Teams/Slack.
const E = require('./erros');
const { usuarioAtual } = require('./contexto');

function criarNotificacoesService(core, { transporteEmail } = {}) {
  const db = core.db;
  const verificacoes = [];
  const enviados = []; // últimos envios (diagnóstico)

  const appUrl = () => (core.obterConfig('app_url', 'http://localhost:3000') || '').replace(/\/$/, '');

  // ---------- Canais ----------
  let transporteCache = null; let chaveTransporte = '';
  function transporte() {
    if (transporteEmail) return transporteEmail;
    const host = core.obterConfig('smtp_host');
    if (!host) return null;
    const cfg = { host, port: Number(core.obterConfig('smtp_porta', 587)), secure: core.obterConfig('smtp_seguro') === '1',
      auth: core.obterConfig('smtp_usuario') ? { user: core.obterConfig('smtp_usuario'), pass: core.obterConfig('smtp_senha') } : undefined };
    const chave = JSON.stringify(cfg);
    if (chave !== chaveTransporte) { transporteCache = require('nodemailer').createTransport(cfg); chaveTransporte = chave; }
    return transporteCache;
  }
  async function enviarEmail(para, assunto, texto) {
    const t = transporte();
    if (!t) return 'nao_configurado';
    await t.sendMail({ from: core.obterConfig('smtp_remetente', 'kpi@localhost'), to: para, subject: assunto, text: texto });
    return 'enviado';
  }
  async function enviarWebhook(url, texto) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: texto }) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return 'enviado';
  }
  function registrarEnvio(canal, destino, status) {
    enviados.unshift({ canal, destino, status, em: new Date().toISOString() });
    enviados.length = Math.min(enviados.length, 50);
  }

  async function despachar(ids, n) {
    const link = n.link ? appUrl() + '/' + n.link.replace(/^\//, '') : '';
    const texto = `${n.mensagem || n.titulo}${link ? `\n\nAcesse: ${link}` : ''}`;
    for (const { id, usuario } of ids) {
      if (!usuario.notificar_email) continue;
      try {
        const st = await enviarEmail(usuario.email, `[KPI & Metas] ${n.titulo}`, texto);
        db.prepare('UPDATE notificacoes SET entregas=? WHERE id=?').run(JSON.stringify({ email: st }), id);
        if (st !== 'nao_configurado') registrarEnvio('email', usuario.email, st);
      } catch (e) {
        db.prepare('UPDATE notificacoes SET entregas=? WHERE id=?').run(JSON.stringify({ email: 'erro: ' + e.message }), id);
        registrarEnvio('email', usuario.email, 'erro: ' + e.message);
      }
    }
    // Webhooks de canal: uma mensagem por evento (não por destinatário)
    if (ids.length && n.canal !== false) {
      for (const [chave, canal] of [['teams_webhook', 'teams'], ['slack_webhook', 'slack']]) {
        const url = core.obterConfig(chave);
        if (!url) continue;
        try { registrarEnvio(canal, 'webhook', await enviarWebhook(url, `*${n.titulo}*\n${texto}`)); } catch (e) { registrarEnvio(canal, 'webhook', 'erro: ' + e.message); }
      }
    }
  }

  /**
   * Cria notificações para os usuários indicados. Com "chave", a mesma notificação não se repete
   * para o mesmo usuário (útil para alertas recorrentes do agendador).
   * @returns {Promise<number>} quantidade criada
   */
  async function notificar(usuarioIds, n) {
    const unicos = [...new Set((usuarioIds || []).filter(Boolean))];
    const criados = [];
    const st = db.prepare(`INSERT OR IGNORE INTO notificacoes (usuario_id, tipo, titulo, mensagem, link, chave) VALUES (?,?,?,?,?,?)`);
    for (const uid of unicos) {
      const usuario = db.prepare('SELECT id, email, notificar_email FROM usuarios WHERE id=? AND ativo=1').get(uid);
      if (!usuario) continue;
      const r = st.run(uid, n.tipo, n.titulo, n.mensagem || null, n.link || null, n.chave || null);
      if (r.changes) criados.push({ id: Number(r.lastInsertRowid), usuario });
    }
    await despachar(criados, n);
    return criados.length;
  }

  // ---------- Destinatários ----------
  /** Gestores do departamento e das áreas acima dele na hierarquia. */
  function gestoresDe(deptoId) {
    const ancestrais = db.prepare(`WITH RECURSIVE sobe(id, pai) AS (SELECT id, pai_id FROM departamentos WHERE id=?
        UNION ALL SELECT d.id, d.pai_id FROM departamentos d JOIN sobe ON d.id = sobe.pai) SELECT id FROM sobe`).all(deptoId).map((r) => r.id);
    if (!ancestrais.length) return [];
    const marcas = ancestrais.map(() => '?').join(',');
    // Gestores cadastrados nas áreas + gestores vinculados aos nós (ex.: diretor ou gerente indicado na estrutura)
    return [...new Set([
      ...db.prepare(`SELECT id FROM usuarios WHERE ativo=1 AND perfil='gestor' AND departamento_id IN (${marcas})`).all(...ancestrais).map((r) => r.id),
      ...db.prepare(`SELECT u.id FROM departamentos d JOIN usuarios u ON u.id = d.gestor_usuario_id WHERE u.ativo=1 AND d.id IN (${marcas})`).all(...ancestrais).map((r) => r.id),
    ])];
  }
  const porPerfil = (...perfis) => db.prepare(`SELECT id FROM usuarios WHERE ativo=1 AND perfil IN (${perfis.map(() => '?').join(',')})`).all(...perfis).map((r) => r.id);
  const porNome = (texto) => (texto ? db.prepare('SELECT id, nome FROM usuarios WHERE ativo=1').all()
    .filter((u) => texto.toLowerCase().includes(u.nome.toLowerCase())).map((u) => u.id) : []);

  // ---------- Caixa de entrada ----------
  function listar({ apenasNaoLidas } = {}) {
    const u = usuarioAtual();
    const itens = db.prepare(`SELECT id, tipo, titulo, mensagem, link, lida, criado_em FROM notificacoes WHERE usuario_id=? ${apenasNaoLidas ? 'AND lida=0' : ''}
        ORDER BY id DESC LIMIT 100`).all(u.id);
    return { nao_lidas: db.prepare('SELECT COUNT(*) n FROM notificacoes WHERE usuario_id=? AND lida=0').get(u.id).n, itens };
  }
  const marcarLida = (id) => db.prepare('UPDATE notificacoes SET lida=1 WHERE id=? AND usuario_id=?').run(id, usuarioAtual().id);
  const marcarTodas = () => db.prepare('UPDATE notificacoes SET lida=1 WHERE usuario_id=?').run(usuarioAtual().id);

  // ---------- Verificações periódicas ----------
  /** Módulos registram funções que retornam alertas: [{ usuarios, tipo, titulo, mensagem, link, chave }] */
  const registrarVerificacao = (nome, fn) => verificacoes.push({ nome, fn });
  async function executarVerificacoes() {
    let total = 0;
    for (const v of verificacoes) {
      try {
        for (const a of v.fn()) total += await notificar(a.usuarios, a);
      } catch (e) { console.error(`[verificação ${v.nome}]`, e.message); }
    }
    return { notificacoes_criadas: total };
  }

  async function testarCanais() {
    core.exigirPerfil();
    const u = usuarioAtual();
    const r = {};
    try { r.email = await enviarEmail(u.email, '[KPI & Metas] Teste de notificação', 'Se você recebeu esta mensagem, o e-mail está configurado.'); } catch (e) { r.email = 'erro: ' + e.message; }
    for (const [chave, canal] of [['teams_webhook', 'teams'], ['slack_webhook', 'slack']]) {
      const url = core.obterConfig(chave);
      if (!url) { r[canal] = 'nao_configurado'; continue; }
      try { r[canal] = await enviarWebhook(url, 'Teste de notificação do KPI & Metas'); } catch (e) { r[canal] = 'erro: ' + e.message; }
    }
    return r;
  }

  // ---------- Eventos de domínio emitidos pelos módulos ----------
  const ev = core.eventos;
  const seguro = (fn) => (p) => { Promise.resolve().then(() => fn(p)).catch((e) => console.error('[notificação]', e.message)); };
  ev.on('indicadores.desvio', seguro(({ indicador, medicao }) => notificar(
    [...gestoresDe(indicador.departamento_id), ...porNome(indicador.responsavel)].filter((id) => id !== usuarioAtual()?.id),
    { tipo: 'desvio', titulo: `Desvio em ${indicador.nome}`, link: `#/indicadores/${indicador.id}`,
      mensagem: `${indicador.nome} registrou ${medicao.valor} ${indicador.unidade || ''} em ${medicao.periodo}, fora do range aceitável (meta ${medicao.meta}). Registre a análise de causa.` })));
  ev.on('metas.apuracao', seguro(({ acao, ciclo, departamento }) => {
    const alvo = acao === 'submeter' ? porPerfil('diretoria', 'admin') : gestoresDe(departamento.id);
    const verbo = { submeter: 'submetida para aprovação', aprovar: 'aprovada', reabrir: 'reaberta' }[acao];
    return notificar(alvo, { tipo: 'apuracao', titulo: `Apuração ${verbo}: ${departamento.nome}`, link: `#/metas?ciclo=${ciclo.id}`,
      mensagem: `A apuração de metas do departamento ${departamento.nome} no ciclo ${ciclo.nome} foi ${verbo}.` });
  }));
  ev.on('metas.alteracao_solicitada', seguro(({ meta, justificativa }) => notificar(porPerfil('diretoria', 'admin'),
    { tipo: 'aprovacao', titulo: `Alteração de meta aguardando aprovação: ${meta.nome}`, link: '#/metas/alteracoes',
      mensagem: `Foi solicitada alteração na meta "${meta.nome}". Justificativa: ${justificativa}` })));
  ev.on('core.mencao', seguro(({ usuarios, autor, texto, link }) => notificar(usuarios,
    { tipo: 'mencao', titulo: `${autor} mencionou você`, mensagem: texto.slice(0, 500), link, canal: false })));
  ev.on('notificar', seguro(({ usuarios, ...n }) => notificar(usuarios, n)));

  return { notificar, gestoresDe, porPerfil, porNome, listar, marcarLida, marcarTodas, registrarVerificacao, executarVerificacoes,
    testarCanais, enviados: () => { core.exigirPerfil(); return enviados; }, E };
}

module.exports = { criarNotificacoesService };
