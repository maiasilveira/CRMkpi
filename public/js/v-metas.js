'use strict';
/* Metas bonificáveis: ciclos, scorecard por departamento, individuais, desdobramento, versionamento e colaboradores. */

function formCiclo(c = {}) {
  return `<form><div class="campos">
    <label class="largo">Nome *<input name="nome" required value="${esc(c.nome)}" placeholder="Ex.: PLR ${new Date().getFullYear()}"></label>
    <label>Início *<input type="month" name="inicio" required value="${esc(c.inicio)}"></label><label>Fim *<input type="month" name="fim" required value="${esc(c.fim)}"></label>
    <label>Status<select name="status">${opcoes([['planejamento', 'Planejamento'], ['ativo', 'Ativo']], c.status)}</select></label>
    <label>Nota mínima do depto p/ bônus (%)<input type="number" step="any" min="0" max="100" name="nota_minima" value="${esc(c.nota_minima ?? 0)}"></label></div>
    <fieldset><legend>Gatilho corporativo (opcional)</legend><div class="campos">
      <label class="largo">Indicador corporativo<input name="gatilho_corp_descricao" value="${esc(c.gatilho_corp_descricao)}" placeholder="Ex.: EBITDA anual (R$ milhões)"></label>
      <label>Mínimo para liberar o programa<input type="number" step="any" name="gatilho_corp_minimo" value="${esc(c.gatilho_corp_minimo)}"></label>
      <label>Resultado apurado<input type="number" step="any" name="gatilho_corp_resultado" value="${esc(c.gatilho_corp_resultado)}"></label></div></fieldset>
    <fieldset><legend>Bônus individual</legend><div class="campos">
      <label>% da nota vinda do departamento<input type="number" step="any" min="0" max="100" name="peso_departamento_padrao" value="${esc(c.peso_departamento_padrao ?? 70)}"></label>
      <label>Dias mínimos no mês (pró-rata)<input type="number" min="1" max="31" name="dias_minimos_mes" value="${esc(c.dias_minimos_mes ?? 15)}"></label>
      <label>Redutor por falta injustificada (%)<input type="number" step="any" min="0" max="100" name="redutor_falta_pct" value="${esc(c.redutor_falta_pct ?? 0)}"></label>
      <label>Redutor por advertência (%)<input type="number" step="any" min="0" max="100" name="redutor_advertencia_pct" value="${esc(c.redutor_advertencia_pct ?? 0)}"></label>
      <label>Redutor máximo (%)<input type="number" step="any" min="0" max="100" name="redutor_maximo_pct" value="${esc(c.redutor_maximo_pct ?? 100)}"></label></div></fieldset>
    <p class="dica">Departamentos com nota abaixo da mínima não recebem bônus. Se o gatilho corporativo não for atingido, ninguém recebe. Em ciclo ativo, alterações em metas exigem justificativa e aprovação.</p>${rodape()}</form>`;
}

function formMeta(m, ciclo, inds, todasMetas, { individual = false, colaboradores = [] } = {}) {
  const ativo = ciclo.status === 'ativo' && m.id;
  return `<form id="fMeta"><div class="campos">
    <label class="largo">Nome da meta *<input name="nome" required value="${esc(m.nome)}"></label>
    ${individual ? `<label>Colaborador *<select name="colaborador_id" required>${opcoes(colaboradores.map((c) => [c.id, `${c.nome} (${c.departamento})`]), m.colaborador_id, 'Selecione…')}</select></label>`
    : `<label>Departamento *<select name="departamento_id" required>${deptoOpcoes(m.departamento_id, 'Selecione…')}</select></label>`}
    <label>Desdobrada da meta<select name="meta_pai_id">${opcoes(todasMetas.filter((x) => x.id !== m.id).map((x) => [x.id, `${x.nome} — ${x.colaborador || x.departamento}`]), m.meta_pai_id, '— (meta raiz)')}</select></label>
    <label>Responsável<input name="responsavel" value="${esc(m.responsavel)}" list="dlPessoas"></label>
    <label>Unidade<input name="unidade" value="${esc(m.unidade)}"></label>
    <label>Polaridade *<select name="polaridade">${opcoes([['maior_melhor', 'Maior é melhor'], ['menor_melhor', 'Menor é melhor']], m.polaridade || 'maior_melhor')}</select></label>
    <label>Peso (%) *<input name="peso" type="number" step="any" min="0" max="100" required value="${esc(m.peso)}"></label>
    <label>Gatilho (mínimo) *<input name="gatilho" type="number" step="any" required value="${esc(m.gatilho)}"></label>
    <label>Alvo (100%) *<input name="alvo" type="number" step="any" required value="${esc(m.alvo)}"></label>
    <label>Superação (teto)<input name="superacao" type="number" step="any" value="${esc(m.superacao)}"></label>
    <label>% pago no gatilho<input name="pct_gatilho" type="number" step="any" value="${esc(m.pct_gatilho ?? 50)}"></label>
    <label>% pago na superação<input name="pct_superacao" type="number" step="any" value="${esc(m.pct_superacao ?? 120)}"></label>
    <label>Fonte do resultado<select name="fonte" id="fonte">${opcoes([['manual', 'Lançamento manual'], ...(inds ? [['indicador', 'Indicador (automático)']] : [])], m.fonte || 'manual')}</select></label>
    <label id="lblInd">Indicador vinculado<select name="indicador_id">${opcoes((inds || []).map((i) => [i.id, `${i.codigo ? i.codigo + ' · ' : ''}${i.nome}`]), m.indicador_id, 'Selecione…')}</select></label>
    <label>Agregação no ciclo<select name="agregacao">${opcoes([['ultimo', 'Último valor'], ['media', 'Média'], ['soma', 'Soma (acumulado)']], m.agregacao || 'ultimo')}</select></label>
    <label class="largo">Descrição / regra de apuração<textarea name="descricao">${esc(m.descricao)}</textarea></label>
    ${m.id ? `<label class="largo">Justificativa da alteração${ativo ? ' *' : ''}<input name="justificativa" ${ativo ? 'required' : ''} placeholder="${ativo ? 'Ciclo ativo: a alteração ficará pendente de aprovação da diretoria' : 'Opcional'}"></label>` : ''}
  </div><p class="dica">Curva: abaixo do gatilho = 0%; gatilho = % no gatilho; alvo = 100%; superação = teto. Intermediários interpolados. Ciclo ${mesBR(ciclo.inicio)} a ${mesBR(ciclo.fim)}.</p>
  ${rodape(ativo ? 'Solicitar alteração' : 'Salvar')}</form>`;
}
function ligarFormMeta(corpo) {
  const sync = () => { $('#lblInd', corpo).style.display = $('#fonte', corpo).value === 'indicador' ? '' : 'none'; };
  $('#fonte', corpo).onchange = sync; sync();
}
const tabelaMetas = (metas, { editavel, lancavel }) => `<div class="tabela-wrap"><table><thead><tr><th>Meta</th><th class="num">Peso</th><th class="num">Gatilho</th><th class="num">Alvo</th><th class="num">Superação</th><th class="num">Resultado</th><th>Atingimento</th><th class="num">Contrib.</th><th></th></tr></thead><tbody>
  ${metas.map((m) => `<tr><td><b>${esc(m.nome)}</b><div class="muted" style="font-size:12px">${m.fonte === 'indicador' ? '🔗 indicador · ' : '✎ manual · '}${rot(m.agregacao)} · ${rot(m.polaridade)}${m.unidade ? ' · ' + esc(m.unidade) : ''}</div>
    ${m.projecao ? `<div class="muted" style="font-size:12px">Projeção fim do ciclo: ${fmt(m.projecao.valor)} → ${pct(m.projecao.atingimento)}</div>` : ''}</td>
    <td class="num">${fmt(m.peso)}%</td><td class="num">${fmt(m.gatilho)}</td><td class="num">${fmt(m.alvo)}</td><td class="num">${fmt(m.superacao)}</td><td class="num">${fmt(m.valor_apurado)}</td>
    <td style="min-width:170px">${barra(m.atingimento)}<div style="margin-top:2px">${selo(m.faixa)}</div></td><td class="num">${fmt(m.contribuicao)}</td>
    <td class="linha-acoes">${lancavel && m.fonte === 'manual' ? `<button class="btn peq" data-resultado="${m.id}">Resultado</button>` : ''}${editavel ? `<button class="btn peq" data-edit-meta="${m.id}">Editar</button><button class="btn peq perigo" data-del-meta="${m.id}" aria-label="Excluir meta">✕</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="vazio">Sem metas</td></tr>'}
  </tbody></table></div>`;

rota('/metas', async (el, _, q) => {
  const ciclos = await api('/metas/ciclos');
  const salvarCiclo = (c = {}) => abrirModal(c.id ? 'Editar ciclo' : 'Novo ciclo de metas', formCiclo(c),
    async (d) => { const r = await api('/metas/ciclos' + (c.id ? '/' + c.id : ''), { metodo: c.id ? 'PUT' : 'POST', corpo: d }); irPara('#/metas?ciclo=' + r.id); return false; }, { largo: true });
  if (!ciclos.length) {
    el.innerHTML = `<div class="cabecalho"><h1>Metas bonificáveis</h1></div><div class="card vazio">Nenhum ciclo cadastrado.${ehDiretoria() ? '<br><br><button class="btn pri" id="nc">+ Criar primeiro ciclo</button>' : ''}</div>`;
    if ($('#nc', el)) $('#nc', el).onclick = () => salvarCiclo();
    return;
  }
  const cid = Number(q.ciclo || (ciclos.find((c) => c.status === 'ativo') || ciclos[0]).id);
  const aba = q.aba || 'departamentos';
  const [ap, ciclo, inds] = await Promise.all([api(`/metas/ciclos/${cid}/apuracao`), api(`/metas/ciclos/${cid}`), temModulo('indicadores') ? api('/metas/indicadores-disponiveis') : null]);
  const fechado = ciclo.status === 'encerrado';
  const g = ap.gatilho_corporativo;
  const link = (a) => `#/metas?ciclo=${cid}&aba=${a}`;
  el.innerHTML = `<div class="cabecalho"><h1>Metas bonificáveis</h1>
    <div class="acoes"><select id="selCiclo" aria-label="Ciclo" style="width:auto">${opcoes(ciclos.map((x) => [x.id, `${x.nome} (${rot(x.status)})`]), cid)}</select>
    ${ehDiretoria() ? `<button class="btn" id="novoCiclo">+ Ciclo</button>${!fechado ? '<button class="btn" id="editCiclo">Regras do ciclo</button>' : ''}
      <details class="menu"><summary class="btn">Relatórios ▾</summary><div>
        <a href="/api/metas/ciclos/${cid}/acordo.pdf" target="_blank">Acordo do programa (PDF)</a><a href="/api/metas/ciclos/${cid}/apuracao.pdf" target="_blank">Apuração (PDF)</a>
        <a href="/api/metas/ciclos/${cid}/exportar.csv">Metas por departamento (CSV)</a>${veRemuneracao() ? `<a href="/api/metas/ciclos/${cid}/individuais.csv">Bônus individual (CSV)</a>` : ''}</div></details>
      ${!fechado ? '<button class="btn" id="encerrar">Encerrar ciclo</button>' : ''}` : ''}</div></div>
  <div class="grid g4" style="margin-bottom:16px">
    <div class="stat"><div class="rot">Ciclo</div><div style="font-weight:600;margin-top:4px">${mesBR(ciclo.inicio)} a ${mesBR(ciclo.fim)} ${selo(ciclo.status)}</div><div class="muted" style="font-size:12px">Nota mínima: ${pct(ciclo.nota_minima)}${ap.congelado ? ' · resultados congelados' : ''}</div></div>
    ${stat('Nota média', pct(ap.totais.nota_media))}
    ${g.definido ? `<div class="stat ${g.atingido ? 'ok' : g.apurado ? 'er' : 'at'}"><div class="rot">Gatilho corporativo</div><div style="font-weight:600;margin-top:4px">${esc(g.descricao || '')} ≥ ${fmt(g.minimo)}</div>
      <div>${g.apurado ? `Resultado ${fmt(g.resultado)} — ${g.atingido ? 'atingido' : 'NÃO atingido'}` : 'Resultado a apurar'} ${ehDiretoria() && !fechado ? '<button class="link-btn" id="gatilho">informar</button>' : ''}</div></div>`
    : stat('Bônus-alvo (departamentos)', ehDiretoria() ? moeda(ap.totais.valor_base) : '—')}
    ${ehDiretoria() ? stat(`Bônus apurado (${pct(ap.totais.pct_pago)})`, moeda(ap.totais.bonus), 'ok') : stat('Departamentos', ap.departamentos.length)}
  </div>
  ${abas([['departamentos', 'Departamentos'], ['individuais', 'Bônus individual'], ...(ehDiretoria() ? [['participantes', 'Participantes']] : []), ['desdobramento', 'Desdobramento']], aba)}
  <div id="conteudo"></div>`;
  $('#selCiclo', el).onchange = (e) => irPara('#/metas?ciclo=' + e.target.value);
  el.addEventListener('click', (e) => { const a = e.target.closest('[data-aba]'); if (a) irPara(link(a.dataset.aba)); });
  const ligar = (s, fn) => { const b = $(s, el); if (b) b.onclick = fn; };
  ligar('#novoCiclo', () => salvarCiclo());
  ligar('#editCiclo', () => salvarCiclo(ciclo));
  ligar('#gatilho', () => abrirModal('Resultado do gatilho corporativo', `<form><div class="campos"><label>${esc(g.descricao || 'Resultado')}<input type="number" step="any" name="resultado" required value="${esc(g.resultado)}"></label></div>
    <p class="dica">Mínimo exigido: ${fmt(g.minimo)}. Abaixo dele, nenhum bônus é pago no ciclo.</p>${rodape()}</form>`, (d) => api(`/metas/ciclos/${cid}/gatilho`, { metodo: 'PUT', corpo: d })));
  ligar('#encerrar', tentar(async () => {
    if (!confirmar('Encerrar o ciclo? Os resultados (departamentos e individuais) serão congelados e não poderão mais ser alterados.')) return;
    await api(`/metas/ciclos/${cid}/encerrar`, { metodo: 'POST' }); toast('Ciclo encerrado'); render();
  }));
  const alvo = $('#conteudo', el);

  // ---- Departamentos ----
  if (aba === 'departamentos') {
    const todas = await api(`/metas?ciclo_id=${cid}&individuais=todas`);
    alvo.innerHTML = `${ehDiretoria() && !fechado ? '<div class="rodape-form" style="margin:0 0 12px"><button class="btn pri" id="novaMeta">+ Nova meta de departamento</button></div>' : ''}
    ${ap.departamentos.map((d) => {
    const aberto = !fechado && d.status_apuracao === 'aberto';
    return `<div class="card"><div class="depto-topo"><div><h2 style="margin:0">${esc(d.departamento)} ${selo(d.status_apuracao)}</h2>
      <div class="muted" style="font-size:13px">Pesos: ${fmt(d.peso_total)}% ${d.pesos_validos ? '' : selo('desvio', 'soma ≠ 100%')}${ehDiretoria() ? ` · Bônus-alvo ${moeda(d.valor_base)}` : ''} ${d.aprovado_por ? '· aprovado por ' + esc(d.aprovado_por) + ' em ' + dataBR(d.aprovado_em) : ''}</div></div>
      <div style="text-align:right"><div class="nota-grande" style="color:${d.elegivel ? 'var(--ok)' : 'var(--er)'}">${pct(d.nota)}</div>${ehDiretoria() ? `<div><b>${moeda(d.bonus)}</b></div>` : ''}
        ${d.elegivel ? '' : selo('desvio', 'abaixo da nota mínima')} ${d.bloqueado_gatilho ? selo('desvio', 'gatilho corporativo') : ''}</div></div>
    ${tabelaMetas(d.metas, { editavel: ehDiretoria() && aberto, lancavel: aberto && podeEditarDepto(d.departamento_id) })}
    ${!fechado ? `<div class="linha-acoes" style="margin-top:10px">${aberto && ehDiretoria() ? `<button class="btn peq" data-bonus="${d.departamento_id}">Definir bônus-alvo</button>` : ''}
      ${aberto && podeEditarDepto(d.departamento_id) ? `<button class="btn peq pri" data-trans="submeter" data-depto="${d.departamento_id}">Submeter apuração</button>` : ''}
      <button class="btn peq" data-simular="${d.departamento_id}">Simular</button>
      ${d.status_apuracao === 'submetido' && ehDiretoria() ? `<button class="btn peq pri" data-trans="aprovar" data-depto="${d.departamento_id}">Aprovar</button>` : ''}
      ${d.status_apuracao !== 'aberto' && ehDiretoria() ? `<button class="btn peq" data-trans="reabrir" data-depto="${d.departamento_id}">Reabrir</button>` : ''}</div>` : ''}
    </div>`;
  }).join('') || '<div class="card vazio">Nenhuma meta neste ciclo.</div>'}`;
    const doDepto = ap.departamentos.flatMap((d) => d.metas);
    const abrirMeta = (m = {}) => {
      const c = abrirModal(m.id ? 'Editar meta' : 'Nova meta bonificável', formMeta(m, ciclo, inds, todas),
        async (d) => { const r = await api('/metas' + (m.id ? '/' + m.id : ''), { metodo: m.id ? 'PUT' : 'POST', corpo: { ...d, ciclo_id: cid } }); if (r.alteracao_pendente) toast('Alteração enviada para aprovação da diretoria'); }, { largo: true });
      ligarFormMeta(c);
    };
    if ($('#novaMeta', alvo)) $('#novaMeta', alvo).onclick = () => abrirMeta();
    alvo.addEventListener('click', tentar(async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.editMeta) abrirMeta(doDepto.find((m) => m.id === +b.dataset.editMeta));
      if (b.dataset.delMeta && confirmar('Excluir a meta?')) { await api('/metas/' + b.dataset.delMeta, { metodo: 'DELETE' }); render(); }
      if (b.dataset.resultado) abrirResultados(doDepto.find((x) => x.id === +b.dataset.resultado), ciclo);
      if (b.dataset.bonus) {
        const d = ap.departamentos.find((x) => x.departamento_id === +b.dataset.bonus);
        abrirModal(`Bônus-alvo — ${d.departamento}`, `<form><div class="campos"><label>Valor do bônus a 100% de nota (R$) *<input type="number" step="any" min="0" name="valor_base" required value="${d.valor_base}"></label></div>
          <p class="dica">Bônus apurado = bônus-alvo × nota do departamento (se nota ≥ mínima e gatilho corporativo atingido).</p>${rodape()}</form>`,
        (x) => api(`/metas/ciclos/${cid}/departamentos/${d.departamento_id}/bonus`, { metodo: 'PUT', corpo: x }));
      }
      if (b.dataset.trans) {
        await api(`/metas/ciclos/${cid}/departamentos/${b.dataset.depto}/${b.dataset.trans}`, { metodo: 'POST', corpo: {} });
        toast('Apuração atualizada'); render();
      }
      if (b.dataset.simular) abrirSimulacao(ap.departamentos.find((x) => x.departamento_id === +b.dataset.simular), cid);
    }));
  }

  // ---- Bônus individual ----
  if (aba === 'individuais') {
    const [lista, colabs, metasInd] = await Promise.all([api(`/metas/ciclos/${cid}/individuais`), ehGestorOuMais() ? api('/metas/colaboradores') : [], api(`/metas?ciclo_id=${cid}&individuais=1`)]);
    const todas = await api(`/metas?ciclo_id=${cid}&individuais=todas`);
    alvo.innerHTML = `<div class="card"><div class="depto-topo"><h2 style="margin:0">Bônus individual</h2>${ehGestorOuMais() && !fechado ? '<button class="btn pri peq" id="novaInd">+ Meta individual</button>' : ''}</div>
      <p class="dica">Nota final = ${fmt(ciclo.peso_departamento_padrao, 0)}% nota do departamento + ${fmt(100 - ciclo.peso_departamento_padrao, 0)}% metas individuais (se houver). Bônus = salário × múltiplo × pró-rata × nota final × (1 − redutores).</p>
      <div class="tabela-wrap"><table><thead><tr><th>Colaborador</th><th>Departamento</th><th class="num">Meses</th><th class="num">Nota depto</th><th class="num">Nota indiv.</th><th class="num">Nota final</th><th class="num">Redutor</th>${veRemuneracao() ? '<th class="num">Bônus-alvo</th><th class="num">Bônus</th>' : ''}<th>Observações</th></tr></thead><tbody>
      ${lista.map((i) => `<tr><td><b>${esc(i.nome)}</b><div class="muted" style="font-size:12px">${esc(i.matricula)}</div></td><td>${esc(i.departamento)}</td><td class="num">${i.meses_elegiveis}/${i.meses_ciclo}</td>
        <td class="num">${pct(i.nota_departamento)}</td><td class="num">${pct(i.nota_individual)}${i.pesos_individuais_validos ? '' : ' ⚠'}</td><td class="num"><b>${pct(i.nota_final)}</b></td><td class="num">${i.redutor_pct ? pct(i.redutor_pct) : '—'}</td>
        ${veRemuneracao() ? `<td class="num">${moeda(i.bonus_alvo)}</td><td class="num"><b>${moeda(i.bonus)}</b></td>` : ''}<td class="muted" style="font-size:12px">${esc(i.motivos.join('; '))}</td></tr>`).join('') || `<tr><td colspan="10" class="vazio">Nenhum participante no ciclo${ehDiretoria() ? ' — inclua na aba Participantes' : ''}</td></tr>`}</tbody></table></div></div>
      <div class="card"><h2>Metas individuais</h2>${tabelaMetas(metasInd.map((m) => ({ ...m, nome: `${m.colaborador}: ${m.nome}` })), { editavel: !fechado && ehGestorOuMais(), lancavel: !fechado && ehGestorOuMais() })}</div>`;
    const abrirInd = (m = {}) => { const c = abrirModal(m.id ? 'Editar meta individual' : 'Nova meta individual', formMeta(m, ciclo, inds, todas, { individual: true, colaboradores: colabs }),
      async (d) => { const r = await api('/metas' + (m.id ? '/' + m.id : ''), { metodo: m.id ? 'PUT' : 'POST', corpo: { ...d, ciclo_id: cid } }); if (r.alteracao_pendente) toast('Alteração enviada para aprovação'); }, { largo: true }); ligarFormMeta(c); };
    if ($('#novaInd', alvo)) $('#novaInd', alvo).onclick = () => abrirInd();
    alvo.addEventListener('click', tentar(async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.editMeta) abrirInd(metasInd.find((m) => m.id === +b.dataset.editMeta));
      if (b.dataset.delMeta && confirmar('Excluir a meta individual?')) { await api('/metas/' + b.dataset.delMeta, { metodo: 'DELETE' }); render(); }
      if (b.dataset.resultado) abrirResultados(metasInd.find((x) => x.id === +b.dataset.resultado), ciclo);
    }));
  }

  // ---- Participantes ----
  if (aba === 'participantes') {
    const lista = await api(`/metas/ciclos/${cid}/participantes`);
    alvo.innerHTML = `<div class="card"><div class="depto-topo"><h2 style="margin:0">Participantes do ciclo</h2>${!fechado ? '<button class="btn peq" id="incluir">Incluir todos os colaboradores ativos</button>' : ''}</div>
      <div class="tabela-wrap"><table><thead><tr><th>Colaborador</th><th>Departamento</th>${veRemuneracao() ? '<th class="num">Salário</th>' : ''}<th class="num">Múltiplo</th><th class="num">% depto</th><th class="num">Faltas</th><th class="num">Advert.</th><th></th></tr></thead><tbody>
      ${lista.map((p) => `<tr><td>${esc(p.nome)} <span class="muted">${esc(p.matricula)}</span></td><td>${esc(p.departamento)}</td>${veRemuneracao() ? `<td class="num">${moeda(p.salario)}</td>` : ''}<td class="num">${fmt(p.multiplo_salarios)}×</td>
        <td class="num">${fmt(p.peso_departamento)}%</td><td class="num">${p.faltas}</td><td class="num">${p.advertencias}</td>
        <td class="linha-acoes">${!fechado ? `<button class="btn peq" data-part="${p.colaborador_id}">Editar</button><button class="btn peq perigo" data-rem="${p.colaborador_id}" aria-label="Remover do ciclo">✕</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="vazio">Nenhum participante</td></tr>'}</tbody></table></div>
      <p class="dica">Cadastre e importe colaboradores em <a href="#/colaboradores">Colaboradores</a>.</p></div>`;
    if ($('#incluir', alvo)) $('#incluir', alvo).onclick = () => abrirModal('Incluir colaboradores', `<form><div class="campos"><label>Múltiplo salarial padrão<input type="number" step="any" min="0" name="multiplo_salarios" value="1"></label></div>
      <p class="dica">Inclui colaboradores ativos com vínculo no período do ciclo. Ajuste individualmente depois.</p>${rodape('Incluir')}</form>`,
    async (d) => { const r = await api(`/metas/ciclos/${cid}/participantes/incluir-todos`, { metodo: 'POST', corpo: d }); toast(`${r.incluidos} incluído(s)`); });
    alvo.addEventListener('click', tentar(async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.rem && confirmar('Remover do ciclo?')) { await api(`/metas/ciclos/${cid}/participantes/${b.dataset.rem}`, { metodo: 'DELETE' }); render(); }
      if (b.dataset.part) {
        const p = lista.find((x) => x.colaborador_id === +b.dataset.part);
        abrirModal(`Participação — ${p.nome}`, `<form><div class="campos"><label>Múltiplo salarial<input type="number" step="any" min="0" name="multiplo_salarios" value="${p.multiplo_salarios}"></label>
          <label>% da nota vinda do departamento<input type="number" step="any" min="0" max="100" name="peso_departamento" value="${p.peso_departamento}"></label>
          <label>Faltas injustificadas<input type="number" min="0" name="faltas" value="${p.faltas}"></label><label>Advertências<input type="number" min="0" name="advertencias" value="${p.advertencias}"></label></div>${rodape()}</form>`,
        (d) => api(`/metas/ciclos/${cid}/participantes/${p.colaborador_id}`, { metodo: 'PUT', corpo: d }));
      }
    }));
  }

  // ---- Desdobramento ----
  if (aba === 'desdobramento') {
    const arv = await api(`/metas/ciclos/${cid}/desdobramento`);
    const no = (n) => `<li><div class="no-meta"><span>${esc(n.nome)} <span class="muted">— ${esc(n.colaborador || n.departamento)} · peso ${fmt(n.peso)}%</span></span><span>${barra(n.atingimento)}</span></div>
      ${n.filhas.length ? `<ul>${n.filhas.map(no).join('')}</ul>` : ''}</li>`;
    alvo.innerHTML = `<div class="card"><h2>Desdobramento de metas</h2><p class="dica">Empresa → áreas → pessoas. Defina a "meta-mãe" ao criar ou editar uma meta.</p>
      ${arv.length ? `<ul class="arvore-metas">${arv.map(no).join('')}</ul>` : vazio('Nenhuma meta')}</div>`;
  }
});

function abrirResultados(m, ciclo) {
  abrirModal(`Resultados — ${m.nome}`, `<div class="tabela-wrap" style="margin-bottom:12px"><table><thead><tr><th>Período</th><th class="num">Valor</th><th>Observação</th></tr></thead><tbody>
    ${m.resultados.map((r) => `<tr><td>${mesBR(r.periodo)}</td><td class="num">${fmt(r.valor)}</td><td>${esc(r.observacao || '')}</td></tr>`).join('') || '<tr><td colspan="3" class="vazio">Sem lançamentos</td></tr>'}</tbody></table></div>
    <form><div class="campos"><label>Período *<input type="month" name="periodo" required min="${ciclo.inicio}" max="${ciclo.fim}"></label><label>Valor *<input type="number" step="any" name="valor" required></label>
    <label class="largo">Observação / evidência<input name="observacao"></label></div><p class="dica">Agregação: ${rot(m.agregacao)}. Lançar no mesmo período substitui o valor. Anexe evidências pelo indicador ou pela reunião.</p>${rodape('Lançar')}</form>`,
  (d) => api(`/metas/${m.id}/resultados`, { metodo: 'POST', corpo: d }));
}

function abrirSimulacao(d, cid) {
  const corpo = abrirModal(`Simulação "e se" — ${d.departamento}`, `<form id="fSim"><p class="muted" style="margin-top:0">Altere os resultados para ver o impacto na nota e no bônus. Nada é gravado.</p>
    <div class="tabela-wrap"><table><thead><tr><th>Meta</th><th class="num">Peso</th><th>Resultado simulado</th><th class="num">Atingimento</th></tr></thead><tbody>
    ${d.metas.map((m) => `<tr><td>${esc(m.nome)}</td><td class="num">${fmt(m.peso)}%</td><td><input type="number" step="any" name="${m.id}" value="${m.valor_apurado ?? ''}" aria-label="Resultado de ${esc(m.nome)}"></td><td class="num" data-at="${m.id}">${pct(m.atingimento)}</td></tr>`).join('')}
    </tbody></table></div><div class="resumo-meta" style="margin-top:12px"><div>Nota simulada<b id="simNota">${pct(d.nota)}</b></div>${ehDiretoria() ? `<div>Bônus simulado<b id="simBonus">${moeda(d.bonus)}</b></div>` : ''}</div>
    <div class="rodape-form"><button type="button" class="btn" data-fechar>Fechar</button></div></form>`);
  $('#fSim', corpo).addEventListener('submit', (ev) => ev.preventDefault());
  $('#fSim', corpo).addEventListener('input', tentar(async (ev) => {
    const r = await api(`/metas/ciclos/${cid}/departamentos/${d.departamento_id}/simular`, { metodo: 'POST', corpo: { valores: dadosForm(ev.currentTarget) } });
    r.metas.forEach((m) => { const td = corpo.querySelector(`[data-at="${m.id}"]`); if (td) td.textContent = pct(m.atingimento); });
    $('#simNota', corpo).textContent = pct(r.nota);
    if ($('#simBonus', corpo)) $('#simBonus', corpo).textContent = moeda(r.bonus) + (r.elegivel ? '' : ' (abaixo da nota mínima)');
  }));
}

// ---- Alterações de metas (versionamento) ----
rota('/metas/alteracoes', async (el, _, q) => {
  const status = q.status ?? 'pendente';
  const lista = await api('/metas/alteracoes?' + qs({ status }));
  const campo = (k) => ({ alvo: 'Alvo', gatilho: 'Gatilho', superacao: 'Superação', peso: 'Peso', nome: 'Nome', pct_gatilho: '% gatilho', pct_superacao: '% superação' }[k] || k);
  el.innerHTML = `<div class="cabecalho"><div><h1>Alterações de metas</h1><div class="muted">Histórico de versões das regras e aprovações pendentes</div></div>
    <select id="st" aria-label="Status" style="width:auto">${opcoes([['pendente', 'Pendentes'], ['aprovada', 'Aprovadas'], ['rejeitada', 'Rejeitadas'], ['aplicada', 'Aplicadas (planejamento)'], ['', 'Todas']], status)}</select></div>
  <div class="card">${lista.map((a) => `<div class="versao"><div class="depto-topo" style="margin:0"><div><b>${esc(a.meta)}</b> <span class="muted">— ${esc(a.departamento)}</span> ${selo(a.status)}</div>
    ${a.status === 'pendente' && ehDiretoria() ? `<div class="linha-acoes"><button class="btn peq pri" data-aprovar="${a.id}">Aprovar</button><button class="btn peq" data-rejeitar="${a.id}">Rejeitar</button></div>` : ''}</div>
    <ul>${Object.keys(a.propostos).map((k) => `<li>${esc(campo(k))}: ${esc(a.anteriores?.[k] ?? '—')} → <b>${esc(a.propostos[k] ?? '—')}</b></li>`).join('')}</ul>
    <div class="muted" style="font-size:12px">Solicitado por ${esc(a.solicitado_por || '—')} em ${dataHoraBR(a.criado_em)}${a.decidido_por ? ` · decidido por ${esc(a.decidido_por)} em ${dataHoraBR(a.decidido_em)}` : ''}</div>
    ${a.justificativa ? `<div class="causa"><b>Justificativa:</b> ${esc(a.justificativa)}</div>` : ''}${a.motivo_decisao ? `<div class="causa"><b>Decisão:</b> ${esc(a.motivo_decisao)}</div>` : ''}</div>`).join('') || vazio('Nenhuma alteração')}</div>`;
  $('#st', el).onchange = (e) => irPara('#/metas/alteracoes?status=' + e.target.value);
  el.addEventListener('click', tentar(async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.aprovar) { await api(`/metas/alteracoes/${b.dataset.aprovar}/aprovar`, { metodo: 'POST', corpo: {} }); toast('Alteração aprovada e aplicada'); render(); }
    if (b.dataset.rejeitar) abrirModal('Rejeitar alteração', `<form><label>Motivo *<textarea name="motivo" required></textarea></label>${rodape('Rejeitar')}</form>`,
      (d) => api(`/metas/alteracoes/${b.dataset.rejeitar}/rejeitar`, { metodo: 'POST', corpo: d }));
  }));
});

// ---- Colaboradores ----
rota('/colaboradores', async (el, _, q) => {
  const lista = await api('/metas/colaboradores?' + qs({ ...q, todos: q.todos ? 1 : '' }));
  el.innerHTML = `<div class="cabecalho"><div><h1>Colaboradores</h1><div class="muted">Base para metas individuais e cálculo de bônus</div></div>
    ${ehDiretoria() ? '<div class="acoes"><button class="btn" id="importar">Importar planilha</button><button class="btn pri" id="novo">+ Colaborador</button></div>' : ''}</div>
  <div class="card"><form class="filtros" id="filtros"><label>Departamento<select name="departamento_id">${deptoOpcoes(q.departamento_id, 'Todos')}</select></label>
    <label class="check"><input type="checkbox" name="todos" ${q.todos ? 'checked' : ''}> Incluir inativos</label></form>
  <div class="tabela-wrap"><table><thead><tr><th>Matrícula</th><th>Nome</th><th>Departamento</th><th>Cargo</th>${veRemuneracao() ? '<th class="num">Salário</th>' : ''}<th>Admissão</th><th>Desligamento</th><th></th></tr></thead><tbody>
  ${lista.map((c) => `<tr><td>${esc(c.matricula)}</td><td><b>${esc(c.nome)}</b><div class="muted" style="font-size:12px">${esc(c.email || '')}</div></td><td>${esc(c.departamento)}</td><td>${esc(c.cargo || '—')}</td>
    ${veRemuneracao() ? `<td class="num">${moeda(c.salario)}</td>` : ''}<td>${dataBR(c.admissao)}</td><td>${dataBR(c.desligamento)}</td><td>${ehDiretoria() ? `<button class="btn peq" data-edit="${c.id}">Editar</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="vazio">Nenhum colaborador</td></tr>'}</tbody></table></div></div>`;
  $('#filtros', el).addEventListener('change', (e) => { const d = dadosForm(e.currentTarget); irPara('#/colaboradores?' + qs({ departamento_id: d.departamento_id, todos: d.todos ? 1 : '' })); });
  const form = (c = {}) => abrirModal(c.id ? 'Editar colaborador' : 'Novo colaborador', `<form><div class="campos">
    <label>Matrícula *<input name="matricula" required value="${esc(c.matricula)}"></label><label class="largo">Nome *<input name="nome" required value="${esc(c.nome)}"></label>
    <label>E-mail (vincula ao usuário)<input type="email" name="email" value="${esc(c.email)}"></label><label>Departamento *<select name="departamento_id" required>${deptoOpcoes(c.departamento_id, 'Selecione…')}</select></label>
    <label>Cargo<input name="cargo" value="${esc(c.cargo)}"></label>${veRemuneracao() ? `<label>Salário base (R$)<input type="number" step="any" min="0" name="salario" value="${esc(c.salario)}"></label>` : ''}
    <label>Admissão *<input type="date" name="admissao" required value="${esc(c.admissao)}"></label><label>Desligamento<input type="date" name="desligamento" value="${esc(c.desligamento)}"></label>
    <label class="check"><input type="checkbox" name="ativo" ${c.ativo === 0 ? '' : 'checked'}> Ativo</label></div>${rodape()}</form>`,
  (d) => api('/metas/colaboradores' + (c.id ? '/' + c.id : ''), { metodo: c.id ? 'PUT' : 'POST', corpo: d }), { largo: true });
  if ($('#novo', el)) $('#novo', el).onclick = () => form();
  el.addEventListener('click', (e) => { const id = e.target.dataset?.edit; if (id) form(lista.find((c) => c.id === +id)); });
  if ($('#importar', el)) $('#importar', el).onclick = () => {
    const c = abrirModal('Importar colaboradores', `<form><p>Colunas: <code>matricula, nome, email, departamento</code> (nome ou sigla), <code>cargo, ${veRemuneracao() ? 'salario, ' : ''}admissao, desligamento</code>. Matrículas existentes são atualizadas.${veRemuneracao() ? '' : ' A coluna <code>salario</code> só pode ser usada por quem tem acesso à remuneração; sem ela, os salários atuais são mantidos.'}</p>
      <label>Arquivo (.csv ou .xlsx)<input type="file" name="arquivo" accept=".csv,.xlsx" required></label><div id="resImp"></div>
      <div class="rodape-form"><button type="button" class="btn" id="simImp">Validar</button><button class="btn pri">Importar</button></div></form>`);
    const enviar = tentar(async (sim) => {
      const f = $('[name=arquivo]', c).files[0]; if (!f) return;
      const r = await enviarArquivo('/metas/colaboradores/importar', f, sim ? { simular: 1 } : {});
      $('#resImp', c).innerHTML = `<div class="aviso ${r.erros ? 'erro' : ''}">${r.importadas}/${r.total} ${sim ? 'válida(s)' : 'importada(s)'}</div>${r.linhas.filter((l) => !l.ok).map((l) => `<div class="muted">Linha ${l.linha}: ${esc(l.erro)}</div>`).join('')}`;
      if (!sim) toast('Importação concluída');
    });
    $('#simImp', c).onclick = () => enviar(true);
    $('form', c).addEventListener('submit', (e) => { e.preventDefault(); enviar(false); });
  };
});
