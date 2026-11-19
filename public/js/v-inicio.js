'use strict';
/* Login, primeiro acesso, painel, perfil e lançamento rápido. */

rota('/login', async (el, _, q) => {
  const st = await api('/auth/estado');
  if (st.usuario) { irPara('#/'); return; }
  if (st.precisa_configurar) {
    el.innerHTML = `<div class="login card"><h1>Configuração inicial</h1><p class="muted">Crie a conta do administrador do sistema.</p>
      <form><label>Nome<input name="nome" required autocomplete="name"></label><label>E-mail<input name="email" type="email" required autocomplete="email"></label>
      <label>Senha (mín. 8 caracteres)<input name="senha" type="password" minlength="8" required autocomplete="new-password"></label>
      <button class="btn pri largo">Criar administrador</button></form></div>`;
    $('form', el).addEventListener('submit', tentar(async (e) => { e.preventDefault(); await api('/auth/configurar', { metodo: 'POST', corpo: dadosForm(e.target) }); await iniciarSessao(); irPara('#/'); }));
    return;
  }
  el.innerHTML = `<div class="login card"><h1><span class="logo">◆</span> KPI &amp; Metas</h1><p class="muted">Gestão de indicadores e metas bonificáveis</p>
    ${q.erro ? `<div class="aviso erro">${esc(q.erro)}</div>` : ''}
    <form><label>E-mail<input name="email" type="email" required autocomplete="username"></label>
    <label>Senha<input name="senha" type="password" required autocomplete="current-password"></label>
    <button class="btn pri largo">Entrar</button></form>
    ${st.sso ? `<div class="ou">ou</div><a class="btn largo" href="/api/auth/sso/iniciar">Entrar com ${esc(st.sso.nome)}</a>` : ''}</div>`;
  $('form', el).addEventListener('submit', tentar(async (e) => { e.preventDefault(); await api('/auth/login', { metodo: 'POST', corpo: dadosForm(e.target) }); $('#toast').hidden = true; await iniciarSessao(); irPara('#/'); }));
}, { publica: true });

rota('/perfil', async (el) => {
  const u = estado.usuario;
  el.innerHTML = `<div class="cabecalho"><h1>Meu perfil</h1></div><div class="grid g2">
    <div class="card"><h2>${esc(u.nome)}</h2><dl class="ficha"><dt>E-mail</dt><dd>${esc(u.email)}</dd><dt>Login p/ menções</dt><dd>@${esc(u.login)}</dd>
      <dt>Perfil</dt><dd>${rot(u.perfil)}</dd><dt>Departamento</dt><dd>${esc(estado.departamentos.find((d) => d.id === u.departamento_id)?.nome || '—')}</dd></dl>
      <form id="fPref"><label class="check"><input type="checkbox" name="notificar_email" ${u.notificar_email ? 'checked' : ''}> Receber notificações por e-mail</label></form></div>
    <div class="card"><h2>Alterar senha</h2>${u.sso && !u.tem_senha ? '<p class="muted">Sua conta usa login único (SSO).</p>' : ''}
      <form id="fSenha"><label>Senha atual<input type="password" name="atual" autocomplete="current-password"></label>
      <label>Nova senha<input type="password" name="nova" minlength="8" required autocomplete="new-password"></label><div class="rodape-form"><button class="btn pri">Alterar senha</button></div></form></div></div>`;
  $('#fPref', el).addEventListener('change', tentar(async (e) => { estado.usuario = { ...estado.usuario, ...(await api('/eu/preferencias', { metodo: 'PUT', corpo: dadosForm(e.currentTarget) })) }; toast('Preferência salva'); }));
  $('#fSenha', el).addEventListener('submit', tentar(async (e) => { e.preventDefault(); await api('/eu/senha', { metodo: 'PUT', corpo: dadosForm(e.target) }); e.target.reset(); toast('Senha alterada'); }));
});

// ============ PAINEL ============
rota('/', async (el) => {
  const [pi, ciclos] = await Promise.all([
    temModulo('indicadores') ? api('/indicadores/painel') : null,
    temModulo('metas') ? api('/metas/ciclos') : [],
  ]);
  const ciclo = ciclos.find((c) => c.status === 'ativo') || ciclos[0];
  const [ap, meu] = ciclo ? await Promise.all([api(`/metas/ciclos/${ciclo.id}/apuracao`), api(`/metas/ciclos/${ciclo.id}/meu-bonus`)]) : [null, null];
  let html = `<div class="cabecalho"><div><h1>Olá, ${esc(estado.usuario.nome.split(' ')[0])}</h1><div class="muted">Painel de gestão${ehDiretoria() ? '' : ' — dados das suas áreas'}</div></div>
    <div class="acoes">${temModulo('indicadores') && ehGestorOuMais() ? '<a class="btn pri" href="#/lancar">Lançamento rápido</a>' : ''}</div></div>`;
  if (meu?.participa) {
    html += `<div class="card destaque"><div class="depto-topo"><div><h2 style="margin:0">Meu bônus — ${esc(meu.ciclo.nome)}</h2>
      <div class="muted">Nota final ${pct(meu.nota_final)} · ${meu.meses_elegiveis}/${meu.meses_ciclo} meses elegíveis${meu.redutor_pct ? ` · redutor ${pct(meu.redutor_pct)}` : ''}</div>
      ${meu.motivos.length ? `<div class="muted">⚠ ${esc(meu.motivos.join('; '))}</div>` : ''}</div>
      <div class="nota-grande">${moeda(meu.bonus)}</div></div><p class="dica">Valor ${meu.ciclo.status === 'encerrado' ? 'final' : 'parcial, calculado com os resultados lançados até agora'}.</p></div>`;
  }
  if (pi) {
    html += `<div class="grid g4" style="margin-bottom:16px">
      ${stat('Indicadores ativos', pi.total_indicadores)}${stat('Atingidos', pi.status.atingido, 'ok')}${stat('Em atenção', pi.status.atencao, 'at')}${stat('Em desvio', pi.status.desvio, 'er')}
      ${stat('Planos em aberto', pi.planos.abertos)}${stat('Planos com atraso', pi.planos.com_atraso, pi.planos.com_atraso ? 'er' : '')}</div>
    <div class="grid g2">
      <div class="card"><h2>Alertas</h2>${pi.alertas.length ? pi.alertas.slice(0, 12).map((a) => `<div class="alerta">${selo(a.gravidade === 'alta' ? 'desvio' : a.gravidade === 'media' ? 'atencao' : 'pendente', a.gravidade)}
        <a href="${a.plano_id ? '#/planos/' + a.plano_id : '#/indicadores/' + a.indicador_id}">${esc(a.mensagem)}</a></div>`).join('') + (pi.alertas.length > 12 ? `<p class="muted">+${pi.alertas.length - 12} alerta(s)</p>` : '') : vazio('Nenhum alerta 🎉')}</div>
      <div class="card"><h2>Indicadores por departamento</h2><div class="tabela-wrap"><table><thead><tr><th>Departamento</th><th class="num">Total</th><th class="num">Atingido</th><th class="num">Atenção</th><th class="num">Desvio</th><th>Saúde</th></tr></thead><tbody>
        ${pi.por_departamento.map((d) => `<tr><td><a href="#/indicadores?departamento_id=${d.departamento_id}">${esc(d.departamento)}</a></td><td class="num">${d.total}</td><td class="num">${d.atingido}</td><td class="num">${d.atencao}</td><td class="num">${d.desvio}</td><td style="min-width:140px">${barra(d.total ? (d.atingido / d.total) * 100 : 0, 100)}</td></tr>`).join('') || '<tr><td colspan="6" class="vazio">Sem indicadores</td></tr>'}
      </tbody></table></div></div></div>`;
  }
  if (ap && ap.departamentos.length) {
    const g = ap.gatilho_corporativo;
    html += `<div class="card"><div class="depto-topo"><h2 style="margin:0">Metas bonificáveis — ${esc(ap.ciclo.nome)} ${selo(ap.ciclo.status)}</h2><a class="btn peq" href="#/metas?ciclo=${ap.ciclo.id}">Abrir scorecard</a></div>
      ${g?.definido ? `<p>${selo(g.atingido ? 'atingido' : g.apurado ? 'desvio' : 'pendente', g.atingido ? 'Gatilho corporativo atingido' : g.apurado ? 'Gatilho corporativo NÃO atingido' : 'Gatilho corporativo a apurar')} <span class="muted">${esc(g.descricao || '')} ≥ ${fmt(g.minimo)}</span></p>` : ''}
      <div class="resumo-meta" style="margin-bottom:12px"><div>Nota média<b>${pct(ap.totais.nota_media)}</b></div>${ehDiretoria() ? `<div>Bônus-alvo<b>${moeda(ap.totais.valor_base)}</b></div><div>Bônus apurado<b>${moeda(ap.totais.bonus)}</b></div>` : ''}</div>
      <div class="tabela-wrap"><table><thead><tr><th>Departamento</th><th>Nota</th>${ehDiretoria() ? '<th class="num">Bônus</th>' : ''}<th>Apuração</th></tr></thead><tbody>
      ${ap.departamentos.map((d) => `<tr><td>${esc(d.departamento)}</td><td style="min-width:180px">${barra(d.nota)}</td>${ehDiretoria() ? `<td class="num">${moeda(d.bonus)}</td>` : ''}<td>${selo(d.status_apuracao)}</td></tr>`).join('')}
      </tbody></table></div></div>`;
  }
  if (!pi && !ap) html += '<div class="card vazio">Nenhum dado disponível.</div>';
  el.innerHTML = html;
});

// ============ LANÇAMENTO RÁPIDO (mobile / PWA) ============
rota('/lancar', async (el, _, q) => {
  const periodo = q.periodo || (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); })();
  const lista = (await api('/indicadores')).filter((i) => i.tipo !== 'calculado' && podeEditarDepto(i.departamento_id));
  const meds = await Promise.all(lista.map((i) => api(`/indicadores/${i.id}/medicoes`)));
  el.innerHTML = `<div class="cabecalho"><div><h1>Lançamento rápido</h1><div class="muted">Registre os valores do período de uma só vez</div></div>
    <label class="inline">Período <input type="month" id="per" value="${periodo}"></label></div>
    <form id="fLanc" class="card lancamentos">${lista.map((i, k) => {
    const atual = meds[k].find((m) => m.periodo === periodo);
    return `<div class="lanc-item"><div><b>${esc(i.codigo ? i.codigo + ' · ' : '')}${esc(i.nome)}</b><div class="muted" style="font-size:12px">${esc(i.departamento)} · ${esc(faixaTexto(i))}</div></div>
      <div class="lanc-campo"><input type="number" step="any" inputmode="decimal" name="${i.id}" value="${atual ? atual.valor : ''}" aria-label="Valor de ${esc(i.nome)}" placeholder="${esc(i.unidade || 'valor')}">
      ${atual ? selo(atual.status) : ''}</div></div>`;
  }).join('') || vazio('Nenhum indicador disponível para lançamento')}
    ${lista.length ? '<div class="rodape-form"><button class="btn pri">Salvar lançamentos</button></div>' : ''}</form>`;
  $('#per', el).onchange = (e) => irPara('#/lancar?periodo=' + e.target.value);
  $('#fLanc', el).addEventListener('submit', tentar(async (e) => {
    e.preventDefault();
    const d = dadosForm(e.target);
    let n = 0; let desvios = 0;
    for (const [id, v] of Object.entries(d)) {
      if (v === '') continue;
      const anterior = meds[lista.findIndex((i) => String(i.id) === id)].find((m) => m.periodo === periodo);
      if (anterior && Number(anterior.valor) === Number(v)) continue;
      const r = await api(`/indicadores/${id}/medicoes`, { metodo: 'POST', corpo: { periodo, valor: v } });
      n++; if (r.exige_analise) desvios++;
    }
    toast(`${n} lançamento(s) salvo(s)${desvios ? ` — ${desvios} desvio(s) exigem análise` : ''}`, desvios > 0);
    render();
  }));
});
