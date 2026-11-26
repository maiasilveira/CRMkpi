'use strict';
/* Governança: reuniões de análise crítica (o ranking de KPIs fica no Painel). */

// A antiga aba Benchmark foi substituída pelo card 'Ranking de KPIs' no Painel; endereços salvos levam ao Painel.
rota('/benchmark', async () => { irPara('#/'); });

rota('/reunioes', async (el) => {
  const lista = await api('/governanca/reunioes');
  el.innerHTML = `<div class="cabecalho"><div><h1>Reuniões de análise crítica</h1><div class="muted">Pauta gerada automaticamente com desvios, planos e pendências — ciclo PDCA</div></div>
    ${ehGestorOuMais() ? '<button class="btn pri" id="nova">+ Agendar reunião</button>' : ''}</div>
  <div class="card"><div class="tabela-wrap"><table><thead><tr><th>Data</th><th>Reunião</th><th>Escopo</th><th>Status</th><th class="num">Encaminhamentos pendentes</th></tr></thead><tbody>
  ${lista.map((r) => `<tr><td>${dataBR(r.data)}</td><td><a href="#/reunioes/${r.id}"><b>${esc(r.titulo)}</b></a></td><td>${esc(r.departamento || 'Corporativa')}</td><td>${selo(r.status)}</td><td class="num">${r.decisoes_pendentes || '—'}</td></tr>`).join('') || '<tr><td colspan="5" class="vazio">Nenhuma reunião</td></tr>'}</tbody></table></div></div>`;
  if ($('#nova', el)) $('#nova', el).onclick = () => abrirModal('Agendar reunião', `<form><div class="campos">
    <label class="largo">Título *<input name="titulo" required placeholder="Ex.: Análise crítica mensal — Operações"></label><label>Data *<input type="date" name="data" required value="${hojeISO()}"></label>
    <label>Escopo<select name="departamento_id">${ehDiretoria() ? opcoes(estado.departamentos.map((d) => [d.id, d.nome]), '', 'Corporativa (todas as áreas)') : deptoOpcoesEditaveis('', undefined)}</select></label>
    <label class="largo">Participantes<input name="participantes"></label></div><p class="dica">A pauta é gerada automaticamente na criação e pode ser atualizada até a reunião.</p>${rodape('Agendar')}</form>`,
  async (d) => { const r = await api('/governanca/reunioes', { metodo: 'POST', corpo: d }); irPara('#/reunioes/' + r.id); return false; });
});

rota('/reunioes/:id', async (el, { id }) => {
  const r = await api('/governanca/reunioes/' + id);
  const editavel = r.departamento_id ? podeEditarDepto(r.departamento_id) : ehDiretoria();
  const icone = { indicador_desvio: '🔴', indicador_atencao: '🟡', plano_atrasado: '⏰', plano_ineficaz: '↻', eficacia_pendente: '✔', decisao_pendente: '📌', apuracao_pendente: '🗳', metas_risco: '⚠', alteracao_meta: '✎' };
  el.innerHTML = `<div class="trilha"><a href="#/reunioes">Reuniões</a></div>
  <div class="cabecalho"><div><h1>${esc(r.titulo)}</h1><div class="muted">${dataBR(r.data)} · ${esc(r.departamento || 'Corporativa')} · ${selo(r.status)}${r.participantes ? ' · ' + esc(r.participantes) : ''}</div></div>
    ${editavel ? `<div class="acoes">${r.status === 'agendada' ? '<button class="btn" id="pauta">Atualizar pauta</button>' : ''}<button class="btn pri" id="editar">Ata e status</button><button class="btn perigo" id="excluir">Excluir</button></div>` : ''}</div>
  <div class="grid g2">
    <div class="card"><h2>Pauta</h2><div class="muted" style="font-size:12px;margin-bottom:8px">Gerada em ${dataHoraBR(r.pauta?.gerada_em)}</div>
      <ol class="pauta">${(r.pauta?.itens || []).map((i) => `<li><span aria-hidden="true">${icone[i.tipo] || '•'}</span> <a href="${esc(i.referencia)}">${esc(i.texto)}</a></li>`).join('') || '<li class="muted">Nada pendente — ótimo sinal!</li>'}</ol></div>
    <div class="card"><h2>Ata</h2>${r.ata ? `<div class="ata">${esc(r.ata).replace(/\n/g, '<br>')}</div>` : vazio('Ata ainda não registrada')}</div>
  </div>
  <div class="card"><div class="depto-topo"><h2 style="margin:0">Decisões e encaminhamentos</h2>${editavel ? '<button class="btn peq" id="novaDec">+ Encaminhamento</button>' : ''}</div>
    <div class="tabela-wrap"><table><thead><tr><th>Descrição</th><th>Responsável</th><th>Prazo</th><th>Status</th><th></th></tr></thead><tbody>
    ${r.decisoes.map((d) => `<tr><td>${esc(d.descricao)}</td><td>${esc(d.responsavel || '—')}</td><td>${dataBR(d.prazo)} ${d.atrasada ? selo('atrasada', 'atrasada') : ''}</td>
      <td>${editavel ? `<select data-st-dec="${d.id}" aria-label="Status">${opcoes(['pendente', 'concluida', 'cancelada'].map((s) => [s, rot(s)]), d.status)}</select>` : selo(d.status)}</td>
      <td>${editavel ? `<button class="btn peq perigo" data-del-dec="${d.id}" aria-label="Excluir">✕</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="vazio">Nenhum encaminhamento</td></tr>'}</tbody></table></div></div>
  <div id="colab"></div>`;
  const ligar = (s, fn) => { const b = $(s, el); if (b) b.onclick = fn; };
  ligar('#pauta', tentar(async () => { await api(`/governanca/reunioes/${id}/pauta`, { metodo: 'POST' }); toast('Pauta atualizada'); render(); }));
  ligar('#excluir', tentar(async () => { if (!confirmar('Excluir a reunião?')) return; await api('/governanca/reunioes/' + id, { metodo: 'DELETE' }); irPara('#/reunioes'); }));
  ligar('#editar', () => abrirModal('Ata e status', `<form><div class="campos"><label class="largo">Título<input name="titulo" required value="${esc(r.titulo)}"></label>
    <label>Data<input type="date" name="data" required value="${r.data}"></label><label>Status<select name="status">${opcoes(['agendada', 'realizada', 'cancelada'].map((s) => [s, rot(s)]), r.status)}</select></label>
    <label class="largo">Participantes<input name="participantes" value="${esc(r.participantes)}"></label><label class="largo">Ata<textarea name="ata" rows="10">${esc(r.ata)}</textarea></label>
    <input type="hidden" name="departamento_id" value="${r.departamento_id ?? ''}"></div>${rodape()}</form>`,
  (d) => api('/governanca/reunioes/' + id, { metodo: 'PUT', corpo: d }), { largo: true }));
  ligar('#novaDec', () => abrirModal('Novo encaminhamento', `<form><div class="campos"><label class="largo">Descrição *<textarea name="descricao" required></textarea></label>
    <label>Responsável<input name="responsavel" list="dlPessoas"></label><label>Prazo<input type="date" name="prazo"></label></div>${rodape()}</form>`,
  (d) => api(`/governanca/reunioes/${id}/decisoes`, { metodo: 'POST', corpo: d })));
  el.addEventListener('change', tentar(async (e) => {
    const did = e.target.dataset.stDec;
    if (did) { const d = r.decisoes.find((x) => x.id === +did); await api(`/governanca/reunioes/${id}/decisoes/${did}`, { metodo: 'PUT', corpo: { ...d, status: e.target.value } }); toast('Atualizado'); render(); }
  }));
  el.addEventListener('click', tentar(async (e) => {
    const did = e.target.dataset?.delDec;
    if (did && confirmar('Excluir encaminhamento?')) { await api(`/governanca/reunioes/${id}/decisoes/${did}`, { metodo: 'DELETE' }); render(); }
  }));
  await painelColaboracao($('#colab', el), 'governanca', 'reuniao', id, { podeAnexar: editavel });
});
