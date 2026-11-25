'use strict';
/* Planos de ação: lista priorizada (GUT), ficha 5W2H, ciclo PDCA, eficácia, comentários e anexos. */

const etapasPdca = (fase) => `<ol class="pdca">${['P', 'D', 'C', 'A'].map((f) => `<li class="${f === fase ? 'atual' : ['P', 'D', 'C', 'A'].indexOf(f) < ['P', 'D', 'C', 'A'].indexOf(fase) ? 'feito' : ''}">${rot(f)}</li>`).join('')}</ol>`;

rota('/planos', async (el, _, q) => {
  const planos = await api('/planos?' + qs({ ordem: 'gut', ...q }));
  el.innerHTML = `<div class="cabecalho"><h1>Planos de ação</h1></div>
  <div class="card"><form class="filtros" id="filtros">
    <label>Departamento<select name="departamento_id">${deptoOpcoes(q.departamento_id, 'Todos')}</select></label>
    <label>Responsável<select name="responsavel">${await responsavelOpcoes(q.responsavel)}</select></label>
    <label>Status<select name="status">${opcoes([['abertos', 'Em aberto (não encerrados)'], ...['aberto', 'em_andamento', 'concluido', 'cancelado'].map((s) => [s, rot(s)])], q.status, 'Todos')}</select></label>
    <label>Prazo<select name="atrasados">${opcoes([['1', 'Somente com atraso']], q.atrasados, 'Todos')}</select></label>
    <label>Ordenar por<select name="ordem">${opcoes([['gut', 'Prioridade GUT'], ['recentes', 'Mais recentes']], q.ordem || 'gut')}</select></label>
    ${['departamento_id', 'status', 'atrasados', 'responsavel'].some((k) => q[k]) ? '<a class="btn peq" href="#/planos">Limpar filtros</a>' : ''}</form>
  <div class="tabela-wrap"><table><thead><tr><th class="num">GUT</th><th>Plano</th><th>Indicador</th><th>PDCA</th><th>Progresso</th><th>Prazo final</th><th class="num">Custo</th><th>Status</th><th>Eficácia</th></tr></thead><tbody>
  ${planos.map((p) => `<tr><td class="num">${p.prioridade ? `<span class="gut ${p.prioridade >= 64 ? 'alta' : p.prioridade >= 27 ? 'media' : ''}">${p.prioridade}</span>` : '—'}</td>
    <td><a href="#/planos/${p.id}"><b>${esc(p.titulo)}</b></a>${p.acoes_atrasadas ? ' ' + selo('atrasada', p.acoes_atrasadas + ' atrasada(s)') : ''}<div class="muted" style="font-size:12px">${esc(p.responsavel || '')}</div></td>
    <td><a href="#/indicadores/${p.indicador_id}">${esc(p.indicador)}</a><div class="muted" style="font-size:12px">${esc(p.departamento)}</div></td>
    <td>${p.fase_pdca ? `<span class="fase">${p.fase_pdca}</span>` : '—'}</td><td style="min-width:140px">${barra(p.progresso, 100)}</td><td>${dataBR(p.prazo_final)}</td><td class="num">${moeda(p.custo_total)}</td>
    <td>${selo(p.status)}</td><td>${p.status === 'concluido' ? selo(p.eficacia) : '—'}</td></tr>`).join('') || '<tr><td colspan="9" class="vazio">Nenhum plano encontrado</td></tr>'}
  </tbody></table></div><p class="dica">GUT = Gravidade × Urgência × Tendência (1 a 125). PDCA: P planejar · D executar · C verificar eficácia · A agir/padronizar.</p></div>`;
  $('#filtros', el).addEventListener('change', (e) => irPara('#/planos?' + qs(dadosForm(e.currentTarget))));
});

rota('/planos/:id', async (el, { id }) => {
  const p = await api('/planos/' + id);
  const editavel = podeEditarDepto(p.departamento_id);
  const encerrado = ['concluido', 'cancelado'].includes(p.status);
  const souResponsavel = (a) => a.quem && a.quem.toLowerCase().includes(estado.usuario.nome.toLowerCase());
  el.innerHTML = `<div class="trilha"><a href="#/planos">Planos de ação</a> / <a href="#/indicadores/${p.indicador_id}">${esc(p.indicador)}</a></div>
  <div class="cabecalho"><div><h1>${esc(p.titulo)}</h1><div class="muted">${esc(p.objetivo || '')}</div></div>
    ${editavel ? `<div class="acoes">${!encerrado ? '<button class="btn pri" id="concluir">Concluir plano</button><button class="btn" id="cancelar">Cancelar plano</button>' : ''}
    ${p.status === 'concluido' ? '<button class="btn pri" id="eficacia">Verificar eficácia</button>' : ''}${encerrado ? '<button class="btn" id="reabrir">Reabrir</button>' : ''}
    <button class="btn" id="gut">Prioridade GUT</button><button class="btn perigo" id="excluir">Excluir</button></div>` : ''}</div>
  ${p.fase_pdca ? etapasPdca(p.fase_pdca) : ''}
  <div class="grid g4" style="margin-bottom:16px">
    <div class="stat"><div class="rot">Status</div><div style="margin-top:6px">${selo(p.status)}</div><div class="muted" style="font-size:12px;margin-top:4px">Responsável: ${esc(p.responsavel || '—')}</div></div>
    ${stat('Progresso', p.progresso + '%')}${stat('Ações atrasadas', p.acoes_atrasadas, p.acoes_atrasadas ? 'er' : '')}
    ${stat('Prioridade GUT', p.prioridade ?? '—', '', p.prioridade ? `<div class="muted" style="font-size:12px">G${p.gravidade} × U${p.urgencia} × T${p.tendencia_gut} · custo ${moeda(p.custo_total)}</div>` : `<div class="muted" style="font-size:12px">custo ${moeda(p.custo_total)}</div>`)}
  </div>
  ${p.status === 'concluido' ? `<div class="card"><h2>Verificação de eficácia</h2>${selo(p.eficacia)} ${p.verificacao_data ? 'em ' + dataBR(p.verificacao_data) : ''}<p>${esc(p.verificacao_obs || (p.eficacia === 'pendente' ? 'Acompanhe o indicador nos próximos períodos e registre se o plano eliminou a causa do desvio.' : ''))}</p>
    ${p.eficacia === 'nao_eficaz' ? '<p class="aviso erro">Plano não eficaz: registre uma nova análise de causa no indicador e abra um novo plano (etapa A do PDCA).</p>' : ''}</div>` : ''}
  <div class="card"><div class="depto-topo"><h2 style="margin:0">Ações (5W2H)</h2>${editavel && !encerrado ? '<button class="btn peq" id="novaAcao">+ Nova ação</button>' : ''}</div>
  <div class="tabela-wrap"><table><thead><tr><th>O quê</th><th>Por quê</th><th>Onde</th><th>Quando</th><th>Quem</th><th>Como</th><th class="num">Quanto</th><th>Status</th><th></th></tr></thead><tbody>
  ${p.acoes.map((a) => `<tr><td><b>${esc(a.o_que)}</b></td><td>${esc(a.por_que || '—')}</td><td>${esc(a.onde || '—')}</td><td>${dataBR(a.quando)} ${a.atrasada ? selo('atrasada', 'atrasada') : ''}</td><td>${esc(a.quem)}</td><td>${esc(a.como || '—')}</td><td class="num">${a.quanto ? moeda(a.quanto) : '—'}</td>
    <td><select data-status-acao="${a.id}" ${p.status === 'cancelado' || !(editavel || souResponsavel(a)) ? 'disabled' : ''} aria-label="Status da ação" style="min-width:130px">${opcoes(['pendente', 'em_andamento', 'concluida', 'cancelada'].map((s) => [s, rot(s)]), a.status)}</select>${a.concluida_em ? `<div class="muted" style="font-size:12px">em ${dataBR(a.concluida_em)}</div>` : ''}</td>
    <td class="linha-acoes">${editavel ? `<button class="btn peq" data-edit-acao="${a.id}">Editar</button><button class="btn peq perigo" data-del-acao="${a.id}" aria-label="Excluir ação">✕</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="vazio">Nenhuma ação cadastrada</td></tr>'}
  </tbody></table></div></div>
  <div id="colab"></div>`;
  const atualizar = (corpo) => api('/planos/' + id, { metodo: 'PUT', corpo }).then(() => render()).catch((e) => toast(e.message, true));
  const ligar = (sel, fn) => { const b = $(sel, el); if (b) b.onclick = fn; };
  ligar('#concluir', () => atualizar({ status: 'concluido' }));
  ligar('#cancelar', () => confirmar('Cancelar o plano?') && atualizar({ status: 'cancelado' }));
  ligar('#reabrir', () => atualizar({ status: 'em_andamento', eficacia: 'pendente' }));
  ligar('#excluir', tentar(async () => { if (!confirmar('Excluir o plano e suas ações?')) return; await api('/planos/' + id, { metodo: 'DELETE' }); irPara('#/planos'); }));
  ligar('#gut', () => abrirModal('Prioridade GUT', `<form>${camposGut(p)}<p class="dica">Gravidade: impacto se nada for feito · Urgência: prazo para agir · Tendência: piora se nada for feito.</p>${rodape()}</form>`, (d) => api('/planos/' + id, { metodo: 'PUT', corpo: d })));
  ligar('#eficacia', () => abrirModal('Verificação de eficácia', `<form><div class="campos">
    <label>Resultado *<select name="eficacia">${opcoes([['eficaz', 'Eficaz — causa eliminada'], ['nao_eficaz', 'Não eficaz — requer nova análise'], ['pendente', 'Pendente']], p.eficacia)}</select></label>
    <label>Data da verificação<input type="date" name="verificacao_data" value="${hojeISO()}"></label>
    <label class="largo">Evidências / observações<textarea name="verificacao_obs">${esc(p.verificacao_obs)}</textarea></label></div>${rodape()}</form>`,
  (d) => api('/planos/' + id, { metodo: 'PUT', corpo: d })));
  ligar('#novaAcao', () => abrirModal('Nova ação', `<form>${linhaAcaoForm('')}${rodape('Adicionar')}</form>`, (d) => api(`/planos/${id}/acoes`, { metodo: 'POST', corpo: d }), { largo: true }));
  el.addEventListener('change', async (e) => {
    const s = e.target.dataset.statusAcao;
    if (s) { try { await api('/planos/acoes/' + s, { metodo: 'PUT', corpo: { status: e.target.value } }); toast('Status atualizado'); render(); } catch (err) { toast(err.message, true); render(); } }
  });
  el.addEventListener('click', tentar(async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.delAcao && confirmar('Excluir a ação?')) { await api('/planos/acoes/' + b.dataset.delAcao, { metodo: 'DELETE' }); render(); }
    if (b.dataset.editAcao) {
      const a = p.acoes.find((x) => x.id === +b.dataset.editAcao);
      abrirModal('Editar ação', `<form>${linhaAcaoForm('', a)}${rodape()}</form>`, (d) => api('/planos/acoes/' + a.id, { metodo: 'PUT', corpo: d }), { largo: true });
    }
  }));
  await painelColaboracao($('#colab', el), 'indicadores', 'plano', id, { podeAnexar: editavel });
});
