'use strict';
/* Administração: departamentos (hierarquia), usuários, tokens de API, configurações e auditoria. */

rota('/departamentos', async (el) => {
  const lista = await api('/departamentos?todos=1');
  const filhos = (pai) => lista.filter((d) => (d.pai_id || null) === pai);
  const linha = (d, nivel) => `<tr><td style="padding-left:${10 + nivel * 22}px">${nivel ? '└ ' : ''}<b>${esc(d.nome)}</b></td><td>${rot(d.tipo)}</td><td>${esc(d.sigla || '—')}</td><td>${esc(d.gestor || '—')}</td>
    <td>${d.ativo ? selo('atingido', 'Ativo') : selo('cancelado', 'Inativo')}</td><td>${ehAdmin() ? `<button class="btn peq" data-edit="${d.id}">Editar</button>` : ''}</td></tr>${filhos(d.id).map((f) => linha(f, nivel + 1)).join('')}`;
  const raizes = lista.filter((d) => !d.pai_id || !lista.some((x) => x.id === d.pai_id));
  el.innerHTML = `<div class="cabecalho"><div><h1>Estrutura organizacional</h1><div class="muted">Empresa → diretorias → departamentos. Gestores enxergam sua área e as áreas abaixo dela.</div></div>
    ${ehAdmin() ? '<button class="btn pri" id="novo">+ Departamento</button>' : ''}</div>
  <div class="card"><div class="tabela-wrap"><table><thead><tr><th>Nome</th><th>Tipo</th><th>Sigla</th><th>Gestor</th><th>Situação</th><th></th></tr></thead><tbody>
  ${raizes.map((d) => linha(d, 0)).join('') || '<tr><td colspan="6" class="vazio">Nenhum departamento</td></tr>'}</tbody></table></div></div>`;
  const form = (d = {}) => abrirModal(d.id ? 'Editar departamento' : 'Novo departamento', `<form><div class="campos">
    <label class="largo">Nome *<input name="nome" required value="${esc(d.nome)}"></label><label>Sigla<input name="sigla" value="${esc(d.sigla)}"></label>
    <label>Tipo<select name="tipo">${opcoes(['empresa', 'diretoria', 'departamento'].map((t) => [t, rot(t)]), d.tipo || 'departamento')}</select></label>
    <label>Subordinado a<select name="pai_id">${opcoes(lista.filter((x) => x.id !== d.id).map((x) => [x.id, x.nome]), d.pai_id, '— (topo)')}</select></label>
    <label>Gestor<input name="gestor" value="${esc(d.gestor)}"></label><label class="check"><input type="checkbox" name="ativo" ${d.ativo === 0 ? '' : 'checked'}> Ativo</label></div>${rodape()}</form>`,
  async (x) => { await api('/departamentos' + (d.id ? '/' + d.id : ''), { metodo: d.id ? 'PUT' : 'POST', corpo: x }); estado.departamentos = await api('/departamentos'); });
  if ($('#novo', el)) $('#novo', el).onclick = () => form();
  el.addEventListener('click', (e) => { const id = e.target.dataset?.edit; if (id) form(lista.find((d) => d.id === +id)); });
});

rota('/admin/usuarios', async (el) => {
  const lista = await api('/usuarios');
  el.innerHTML = `<div class="cabecalho"><div><h1>Usuários e perfis</h1><div class="muted">Administrador: tudo · Diretoria: todas as áreas, aprovações e encerramento · Gestor: edita a própria área · Colaborador: consulta a própria área</div></div>
    <button class="btn pri" id="novo">+ Usuário</button></div>
  <div class="card"><div class="tabela-wrap"><table><thead><tr><th>Nome</th><th>E-mail / login</th><th>Perfil</th><th>Departamento</th><th>Último acesso</th><th>Situação</th><th></th></tr></thead><tbody>
  ${lista.map((u) => `<tr><td><b>${esc(u.nome)}</b>${u.sso ? ' ' + selo('pendente', 'SSO') : ''}</td><td>${esc(u.email)}<div class="muted" style="font-size:12px">@${esc(u.login)}</div></td><td>${rot(u.perfil)}</td>
    <td>${esc(u.departamento || '—')}</td><td>${dataHoraBR(u.ultimo_acesso)}</td><td>${u.ativo ? selo('atingido', 'Ativo') : selo('cancelado', 'Inativo')}</td><td><button class="btn peq" data-edit="${u.id}">Editar</button></td></tr>`).join('')}</tbody></table></div></div>`;
  const form = (u = {}) => abrirModal(u.id ? 'Editar usuário' : 'Novo usuário', `<form><div class="campos">
    <label class="largo">Nome *<input name="nome" required value="${esc(u.nome)}"></label><label class="largo">E-mail *<input type="email" name="email" required value="${esc(u.email)}"></label>
    <label>Perfil *<select name="perfil">${opcoes(['admin', 'diretoria', 'gestor', 'colaborador'].map((p) => [p, rot(p)]), u.perfil || 'colaborador')}</select></label>
    <label>Departamento<select name="departamento_id">${deptoOpcoes(u.departamento_id, '—')}</select></label>
    <label>${u.id ? 'Nova senha (deixe em branco para manter)' : 'Senha inicial'}<input type="password" name="senha" minlength="8" autocomplete="new-password" ${u.id ? '' : ''}></label>
    <label class="check"><input type="checkbox" name="ativo" ${u.ativo === 0 ? '' : 'checked'}> Ativo</label><label class="check"><input type="checkbox" name="notificar_email" ${u.notificar_email === 0 ? '' : 'checked'}> Notificar por e-mail</label></div>
    <p class="dica">Usuários que entram por SSO podem ficar sem senha. Gestores e colaboradores precisam de departamento.</p>${rodape()}</form>`,
  async (d) => { if (!d.senha) delete d.senha; await api('/usuarios' + (u.id ? '/' + u.id : ''), { metodo: u.id ? 'PUT' : 'POST', corpo: d }); estado.diretorio = await api('/usuarios/diretorio'); });
  $('#novo', el).onclick = () => form();
  el.addEventListener('click', (e) => { const id = e.target.dataset?.edit; if (id) form(lista.find((u) => u.id === +id)); });
});

rota('/admin/tokens', async (el) => {
  const lista = await api('/tokens');
  el.innerHTML = `<div class="cabecalho"><div><h1>Tokens de API</h1><div class="muted">Para integrações enviarem dados (ERP, BI, scripts). O token age com as permissões do usuário dono.</div></div><button class="btn pri" id="novo">+ Token</button></div>
  <div class="card"><div class="tabela-wrap"><table><thead><tr><th>Nome</th><th>Prefixo</th><th>Usuário</th><th>Criado</th><th>Último uso</th><th>Situação</th><th></th></tr></thead><tbody>
  ${lista.map((t) => `<tr><td>${esc(t.nome)}</td><td><code>${esc(t.prefixo)}…</code></td><td>${esc(t.usuario)}</td><td>${dataBR(t.criado_em)}</td><td>${dataHoraBR(t.ultimo_uso)}</td>
    <td>${t.revogado ? selo('cancelado', 'Revogado') : selo('atingido', 'Ativo')}</td><td>${t.revogado ? '' : `<button class="btn peq perigo" data-rev="${t.id}">Revogar</button>`}</td></tr>`).join('') || '<tr><td colspan="7" class="vazio">Nenhum token</td></tr>'}</tbody></table></div>
  <p class="dica">Exemplo: <code>curl -X POST -H "Authorization: Bearer kpi_…" -H "Content-Type: application/json" -d '{"periodo":"2026-03","valor":123}' ${location.origin}/api/indicadores/ID/medicoes</code></p></div>`;
  $('#novo', el).onclick = () => abrirModal('Novo token de API', `<form><label>Nome / sistema *<input name="nome" required placeholder="Ex.: ERP Faturamento"></label>${rodape('Gerar token')}</form>`, async (d) => {
    const r = await api('/tokens', { metodo: 'POST', corpo: d });
    abrirModal('Token gerado', `<p>${esc(r.aviso)}</p><input readonly value="${esc(r.token)}" id="tk" onclick="this.select()"><div class="rodape-form"><button class="btn pri" data-fechar>Fechar</button></div>`);
    render();
    return false;
  });
  el.addEventListener('click', tentar(async (e) => { const id = e.target.dataset?.rev; if (id && confirmar('Revogar o token? Integrações que o usam deixarão de funcionar.')) { await api('/tokens/' + id, { metodo: 'DELETE' }); render(); } }));
});

rota('/admin/config', async (el) => {
  const [c, tarefas, envios] = await Promise.all([api('/configuracoes'), api('/agendador'), api('/notificacoes/envios')]);
  el.innerHTML = `<div class="cabecalho"><h1>Configurações</h1></div>
  <form id="fCfg"><div class="grid g2">
    <div class="card"><h2>Geral</h2><div class="campos"><label class="largo">Endereço do sistema (links nas notificações)<input name="app_url" value="${esc(c.app_url || location.origin)}"></label>
      <label>Dia-limite de lançamento mensal<input type="number" min="0" max="28" name="dia_limite_lancamento" value="${esc(c.dia_limite_lancamento ?? 10)}"></label></div>
      <p class="dica">Após o dia-limite, gestores recebem alerta dos indicadores mensais sem o valor do mês anterior.</p></div>
    <div class="card"><h2>Assistente de IA</h2><label class="check"><input type="checkbox" name="ia_habilitada" ${c.ia_habilitada === '1' ? 'checked' : ''}> Usar Claude (Anthropic) para sugerir causas e ações</label>
      <p class="dica">Ao ativar, os dados do indicador em desvio e o histórico de análises e planos do departamento são enviados à API da Anthropic para gerar sugestões. Requer a variável de ambiente <code>ANTHROPIC_API_KEY</code> no servidor. Desativado, as sugestões usam apenas o histórico local.</p></div>
    <div class="card"><h2>E-mail (SMTP)</h2><div class="campos"><label>Servidor<input name="smtp_host" value="${esc(c.smtp_host)}" placeholder="smtp.empresa.com"></label><label>Porta<input type="number" name="smtp_porta" value="${esc(c.smtp_porta || 587)}"></label>
      <label>Usuário<input name="smtp_usuario" value="${esc(c.smtp_usuario)}" autocomplete="off"></label><label>Senha<input type="password" name="smtp_senha" value="${esc(c.smtp_senha)}" autocomplete="new-password"></label>
      <label>Remetente<input name="smtp_remetente" value="${esc(c.smtp_remetente)}" placeholder="kpi@empresa.com"></label><label class="check"><input type="checkbox" name="smtp_seguro" ${c.smtp_seguro === '1' ? 'checked' : ''}> TLS direto (porta 465)</label></div></div>
    <div class="card"><h2>Microsoft Teams e Slack</h2><div class="campos"><label class="largo">Webhook do Teams<input name="teams_webhook" value="${esc(c.teams_webhook)}" placeholder="https://…webhook.office.com/…"></label>
      <label class="largo">Webhook do Slack<input name="slack_webhook" value="${esc(c.slack_webhook)}" placeholder="https://hooks.slack.com/services/…"></label></div>
      <p class="dica">Desvios, apurações e alertas de prazo são publicados no canal configurado.</p></div>
  </div><div class="rodape-form"><button type="button" class="btn" id="testar">Enviar teste</button><button type="button" class="btn" id="verificar">Executar verificações agora</button><button class="btn pri">Salvar</button></div></form>
  <div class="grid g2" style="margin-top:16px"><div class="card"><h2>Tarefas agendadas</h2><table><tbody>${tarefas.map((t) => `<tr><td>${esc(t.nome)}</td><td>a cada ${t.intervalo_min} min</td><td class="muted">${t.ultimo ? dataHoraBR(t.ultimo.em) + (t.ultimo.erro ? ' — erro: ' + esc(t.ultimo.erro) : '') : 'ainda não executada'}</td></tr>`).join('')}</tbody></table></div>
    <div class="card"><h2>Últimos envios</h2>${envios.length ? `<table><tbody>${envios.slice(0, 15).map((e) => `<tr><td>${esc(e.canal)}</td><td>${esc(e.destino)}</td><td class="muted">${esc(e.status)}</td><td class="muted">${dataHoraBR(e.em)}</td></tr>`).join('')}</tbody></table>` : vazio('Nenhum envio desde que o servidor iniciou')}</div></div>`;
  $('#fCfg', el).addEventListener('submit', tentar(async (e) => {
    e.preventDefault();
    const d = dadosForm(e.target);
    d.ia_habilitada = d.ia_habilitada ? '1' : '0'; d.smtp_seguro = d.smtp_seguro ? '1' : '0';
    await api('/configuracoes', { metodo: 'PUT', corpo: d }); toast('Configurações salvas');
  }));
  $('#testar', el).onclick = tentar(async () => { const r = await api('/notificacoes/teste', { metodo: 'POST' }); toast(Object.entries(r).map(([k, v]) => `${k}: ${v}`).join(' · ')); });
  $('#verificar', el).onclick = tentar(async () => { const r = await api('/notificacoes/verificar', { metodo: 'POST' }); toast(`${r.notificacoes_criadas} notificação(ões) criada(s)`); atualizarSino(); });
});

rota('/auditoria', async (el, _, q) => {
  const lista = await api('/auditoria?' + qs({ limite: 300, ...q }));
  el.innerHTML = `<div class="cabecalho"><h1>Trilha de auditoria</h1></div><div class="card">
  <form class="filtros" id="filtros"><label>Módulo<select name="modulo">${opcoes([['core', 'Núcleo'], ['indicadores', 'Indicadores'], ['metas', 'Metas'], ['governanca', 'Governança']], q.modulo, 'Todos')}</select></label></form>
  <div class="tabela-wrap"><table><thead><tr><th>Data/hora</th><th>Usuário</th><th>Módulo</th><th>Entidade</th><th>Ação</th><th>Detalhes</th></tr></thead><tbody>
  ${lista.map((a) => `<tr><td style="white-space:nowrap">${dataHoraBR(a.criado_em)}</td><td>${esc(a.usuario || '')}</td><td>${esc(a.modulo)}</td><td>${esc(a.entidade)} #${a.entidade_id ?? ''}</td><td>${selo('pendente', a.acao)}</td><td class="muted quebra" style="font-size:12px;max-width:420px">${esc(a.dados ? JSON.stringify(a.dados) : '')}</td></tr>`).join('') || '<tr><td colspan="6" class="vazio">Sem registros</td></tr>'}
  </tbody></table></div></div>`;
  $('#filtros', el).addEventListener('change', (e) => irPara('#/auditoria?' + qs(dadosForm(e.currentTarget))));
});
