'use strict';
/* Módulo Indicadores: lista, ficha, análises de desvio, importação, mapa estratégico e integrações. */

let cacheObjetivos = null;
async function objetivosOpcoes(sel) {
  if (!cacheObjetivos) cacheObjetivos = (await api('/indicadores/mapa')).perspectivas.flatMap((p) => p.objetivos.map((o) => [o.id, `${rot(p.perspectiva)} · ${o.nome}`]));
  return opcoes(cacheObjetivos, sel, '—');
}

async function formIndicador(i = {}) {
  const editando = !!i.id;
  return `<form><div class="campos">
    <label>Código<input name="codigo" value="${esc(i.codigo)}" placeholder="Ex.: COM-01"></label>
    <label class="largo">Nome *<input name="nome" required value="${esc(i.nome)}"></label>
    <label>Departamento *<select name="departamento_id" required>${deptoOpcoesEditaveis(i.departamento_id, 'Selecione…')}</select></label>
    <label>Responsável<input name="responsavel" value="${esc(i.responsavel)}" list="dlPessoas"></label>
    <label>Unidade<input name="unidade" value="${esc(i.unidade)}" placeholder="%, R$, dias…"></label>
    <label>Frequência<select name="frequencia">${opcoes([['mensal', 'Mensal'], ['bimestral', 'Bimestral'], ['trimestral', 'Trimestral'], ['semestral', 'Semestral'], ['anual', 'Anual']], i.frequencia || 'mensal')}</select></label>
    <label>Perspectiva (BSC)<select name="perspectiva">${opcoes(['financeira', 'clientes', 'processos', 'aprendizado'].map((p) => [p, rot(p)]), i.perspectiva, '—')}</select></label>
    <label>Objetivo estratégico<select name="objetivo_id">${await objetivosOpcoes(i.objetivo_id)}</select></label>
    <label>Polaridade *<select name="polaridade" required>${opcoes(['maior_melhor', 'menor_melhor', 'faixa'].map((p) => [p, rot(p)]), i.polaridade || 'maior_melhor')}</select></label>
    <label>Meta *<input name="meta" type="number" step="any" required value="${esc(i.meta)}"></label>
    <label>Limite inferior aceitável<input name="limite_inferior" type="number" step="any" value="${esc(i.limite_inferior)}"></label>
    <label>Limite superior aceitável<input name="limite_superior" type="number" step="any" value="${esc(i.limite_superior)}"></label>
    <label>Tipo<select name="tipo" id="tipoInd">${opcoes([['manual', 'Lançamento manual / importação / integração'], ['calculado', 'Calculado por fórmula']], i.tipo || 'manual')}</select></label>
    <label class="largo" id="lblFormula">Fórmula<input name="formula_calculo" value="${esc(i.formula_calculo)}" placeholder="Ex.: {COM-01} / {COM-02} * 100"></label>
    <label class="largo">Descrição<textarea name="descricao">${esc(i.descricao)}</textarea></label>
    <label>Fórmula descritiva<input name="formula" value="${esc(i.formula)}"></label>
    <label>Fonte dos dados<input name="fonte_dados" value="${esc(i.fonte_dados)}"></label>
    ${editando ? '<label class="largo">Justificativa da alteração<input name="justificativa" placeholder="Obrigatória ao mudar meta, range, polaridade ou fórmula de indicador com histórico"></label>' : ''}
  </div>
  <p class="dica"><b>Range aceitável:</b> "maior é melhor" usa o limite inferior (entre ele e a meta = atenção); "menor é melhor" usa o limite superior; "faixa" exige o valor entre os dois limites. Fora do range = <b>desvio</b>, que exige análise de causa.
  Indicadores calculados referenciam outros pelo código entre chaves e são recalculados automaticamente.</p>
  ${rodape()}</form>`;
}
function ligarFormIndicador(corpo) {
  const sync = () => { $('#lblFormula', corpo).style.display = $('#tipoInd', corpo).value === 'calculado' ? '' : 'none'; };
  $('#tipoInd', corpo).onchange = sync; sync();
}

rota('/indicadores', async (el, _, q) => {
  const lista = await api('/indicadores?' + qs(q));
  el.innerHTML = `<div class="cabecalho"><h1>Indicadores de desempenho</h1><div class="acoes">
    ${ehGestorOuMais() ? '<a class="btn" href="#/importar">Importar planilha</a><button class="btn pri" id="novo">+ Novo indicador</button>' : ''}</div></div>
  <div class="card"><form class="filtros" id="filtros">
    <label>Departamento<select name="departamento_id">${deptoOpcoes(q.departamento_id, 'Todos')}</select></label>
    <label>Responsável<select name="responsavel">${await responsavelOpcoes(q.responsavel)}</select></label>
    <label>Status atual<select name="status">${opcoes([['atingido', 'Atingido'], ['atencao', 'Atenção'], ['desvio', 'Desvio'], ['sem_medicao', 'Sem medição']], q.status, 'Todos')}</select></label>
    ${Object.values(q).some(Boolean) ? '<a class="btn peq" href="#/indicadores">Limpar filtros</a>' : ''}
  </form>
  <div class="tabela-wrap"><table><thead><tr><th>Indicador</th><th>Departamento</th><th>Meta / range</th><th class="num">Último</th><th>Status</th><th class="num">Desvio</th><th>Tendência</th><th>Pendências</th></tr></thead><tbody>
  ${lista.map((i) => `<tr><td><a href="#/indicadores/${i.id}"><b>${esc(i.codigo ? i.codigo + ' · ' : '')}${esc(i.nome)}</b></a>${i.tipo === 'calculado' ? ' ' + selo('pendente', 'ƒ calculado') : ''}</td><td>${esc(i.departamento)}</td>
    <td class="muted">${esc(faixaTexto(i))}</td>
    <td class="num">${i.ultima_medicao ? fmt(i.ultima_medicao.valor) + ' <span class="muted">' + mesBR(i.ultima_medicao.periodo) + '</span>' : '—'}</td>
    <td>${selo(i.ultima_medicao?.status || 'sem_medicao')}</td><td class="num">${i.desvio_pct === null ? '—' : (i.desvio_pct > 0 ? '+' : '') + fmt(i.desvio_pct, 1) + '%'}</td>
    <td>${selo(i.tendencia)}</td>
    <td>${i.analises_pendentes ? selo('desvio', i.analises_pendentes + ' sem análise') : ''} ${i.planos_abertos ? selo('em_andamento', i.planos_abertos + ' plano(s)') : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="vazio">Nenhum indicador encontrado</td></tr>'}
  </tbody></table></div></div>`;
  $('#filtros', el).addEventListener('change', (e) => irPara('#/indicadores?' + qs(dadosForm(e.currentTarget))));
  if ($('#novo', el)) $('#novo', el).onclick = tentar(async () => {
    const corpo = abrirModal('Novo indicador', await formIndicador(), async (d) => { const n = await api('/indicadores', { metodo: 'POST', corpo: d }); cacheObjetivos = null; cacheResponsaveis = null; irPara('#/indicadores/' + n.id); toast('Indicador criado'); return false; }, { largo: true });
    ligarFormIndicador(corpo); fecharModalSeNavegar();
  });
});
function fecharModalSeNavegar() { window.addEventListener('hashchange', fecharModal, { once: true }); }

// ---------- Análises ----------
function renderAnalise(a, editavel) {
  const c = a.conteudo;
  let corpo = '';
  if (a.tecnica === '5w2h') corpo = `<dl>${W2H.map(([k, t]) => (c[k] ? `<dt>${t}</dt><dd>${esc(c[k])}</dd>` : '')).join('')}</dl>`;
  if (a.tecnica === '5porques') corpo = `<div><b>Problema:</b> ${esc(c.problema)}</div><ol class="porques">${c.porques.map((p) => `<li>Por quê? ${esc(p)}</li>`).join('')}</ol>`;
  if (a.tecnica === 'ishikawa') corpo = `<div><b>Efeito:</b> ${esc(c.problema)}</div><div class="ishikawa">${SEISM.map(([k, t]) => `<div><b>${t}</b>${c[k]?.length ? `<ul>${c[k].map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="muted">—</p>'}</div>`).join('')}</div>`;
  if (a.tecnica === 'pareto') {
    const max = Math.max(...c.itens.map((i) => i.frequencia));
    corpo = `<div><b>Problema:</b> ${esc(c.problema)}</div><table class="pareto"><tbody>${c.itens.map((i) => `<tr class="${i.vital ? 'vital' : ''}"><td>${esc(i.causa)}</td>
      <td style="width:45%"><div class="barra ${i.vital ? 'er' : ''}"><span style="width:${(i.frequencia / max) * 100}%"></span></div></td><td class="num">${fmt(i.frequencia)}</td><td class="num muted">${fmt(i.acumulado, 1)}%</td></tr>`).join('')}</tbody></table>
      <p class="dica">Em destaque: as poucas causas vitais (até ~80% acumulado).</p>`;
  }
  if (a.tecnica === 'a3') corpo = `<div class="a3">${A3.map(([k, t]) => (c[k] ? `<div><b>${t}</b><p>${esc(c[k])}</p></div>` : '')).join('')}</div>`;
  if (a.tecnica === 'arvore') {
    const no = (n) => `<li><span class="porta">${n.porta}</span> ${esc(n.descricao)}${n.filhos?.length ? `<ul>${n.filhos.map(no).join('')}</ul>` : ''}</li>`;
    corpo = `<div class="arvore"><b>Evento topo:</b> ${esc(c.evento_topo)} <span class="porta">${c.porta}</span><ul>${c.causas.map(no).join('')}</ul></div>`;
  }
  return `<div class="analise"><div class="depto-topo" style="margin:0"><div>${selo('pendente', rot(a.tecnica))} <b>${mesBR(a.periodo)}</b> — valor ${fmt(a.valor)} <span class="muted">· ${esc(a.responsavel || '')} · ${dataBR(a.criado_em)}</span></div>
    ${editavel ? `<div class="linha-acoes"><button class="btn peq" data-plano-analise="${a.id}">+ Plano de ação</button><button class="btn peq perigo" data-del-analise="${a.id}">Excluir</button></div>` : ''}</div>
    ${corpo}${a.causa_raiz ? `<div class="causa"><b>Causa raiz:</b> ${esc(a.causa_raiz)}</div>` : ''}</div>`;
}

function camposTecnica(t) {
  if (t === '5w2h') return `<fieldset><legend>5W2H do desvio</legend><div class="campos">${W2H.map(([k, l]) => `<label class="${k === 'o_que' || k === 'por_que' ? 'largo' : ''}">${l}${k === 'o_que' || k === 'por_que' ? ' *' : ''}<input name="c_${k}"></label>`).join('')}</div></fieldset>`;
  if (t === '5porques') return `<fieldset><legend>5 Porquês</legend><div class="campos"><label class="largo">Problema *<input name="c_problema"></label>
    ${[1, 2, 3, 4, 5].map((n) => `<label class="largo">${n}º Por quê?<input name="c_porque_${n}"></label>`).join('')}</div></fieldset>`;
  if (t === 'pareto') return `<fieldset><legend>Pareto — causas e frequência</legend><div class="campos"><label class="largo">Problema analisado *<input name="c_problema"></label></div>
    <div id="paretoItens">${[1, 2, 3, 4].map(linhaPareto).join('')}</div><button type="button" class="btn peq" id="maisPareto">+ Causa</button></fieldset>`;
  if (t === 'a3') return `<fieldset><legend>Relatório A3</legend><div class="campos">${A3.map(([k, l]) => `<label class="largo">${l}${['contexto', 'situacao_atual', 'analise_causa'].includes(k) ? ' *' : ''}<textarea name="c_${k}"></textarea></label>`).join('')}</div></fieldset>`;
  if (t === 'arvore') return `<fieldset><legend>Árvore de falhas</legend><div class="campos"><label class="largo">Evento topo (falha) *<input name="c_evento_topo"></label>
    <label class="largo">Causas — uma por linha; use dois espaços de recuo para subcausas e termine com [E] quando todas as subcausas forem necessárias (padrão: OU)
    <textarea name="c_arvore" rows="6" placeholder="Falha elétrica\n  Sensor queimado\n  Cabo rompido\nErro de operação [E]\n  Procedimento ausente\n  Operador sem treinamento"></textarea></label></div></fieldset>`;
  return `<fieldset><legend>Diagrama de Ishikawa (6M)</legend><div class="campos"><label class="largo">Efeito / problema *<input name="c_problema"></label>
    ${SEISM.map(([k, l]) => `<label>${l}<textarea name="c_${k}" placeholder="Uma causa por linha"></textarea></label>`).join('')}</div></fieldset>`;
}
const linhaPareto = (n) => `<div class="campos linha-pareto"><label>Causa ${n}<input name="p_causa"></label><label>Frequência<input type="number" step="any" min="0" name="p_freq"></label></div>`;
function arvoreDeTexto(txt) {
  const raiz = { filhos: [] }; const pilha = [{ nivel: -1, no: raiz }];
  for (const linha of String(txt || '').split('\n')) {
    if (!linha.trim()) continue;
    const nivel = Math.floor((linha.match(/^\s*/)[0].length) / 2);
    let d = linha.trim(); let porta = 'OU';
    if (/\[E\]$/i.test(d)) { porta = 'E'; d = d.replace(/\s*\[E\]$/i, ''); }
    const no = { descricao: d, porta, filhos: [] };
    while (pilha.length > 1 && pilha[pilha.length - 1].nivel >= nivel) pilha.pop();
    pilha[pilha.length - 1].no.filhos.push(no);
    pilha.push({ nivel, no });
  }
  return raiz.filhos;
}
function montarConteudoAnalise(d, form) {
  const t = d.tecnica;
  if (t === '5w2h') return Object.fromEntries(W2H.map(([k]) => [k, d['c_' + k]]));
  if (t === '5porques') return { problema: d.c_problema, porques: [1, 2, 3, 4, 5].map((n) => d['c_porque_' + n]).filter((x) => x && x.trim()) };
  if (t === 'pareto') return { problema: d.c_problema, itens: $$('.linha-pareto', form).map((l) => ({ causa: $('[name=p_causa]', l).value, frequencia: $('[name=p_freq]', l).value })).filter((i) => i.causa) };
  if (t === 'a3') return Object.fromEntries(A3.map(([k]) => [k, d['c_' + k]]));
  if (t === 'arvore') return { evento_topo: d.c_evento_topo, causas: arvoreDeTexto(d.c_arvore) };
  return { problema: d.c_problema, ...Object.fromEntries(SEISM.map(([k]) => [k, (d['c_' + k] || '').split('\n').map((s) => s.trim()).filter(Boolean)])) };
}

function abrirAnalise(med) {
  const corpo = abrirModal('Análise de desvio', `<form id="fAnalise"><p class="muted" style="margin-top:0">Período <b>${mesBR(med.periodo)}</b> · valor ${fmt(med.valor)} · meta ${fmt(med.meta)} · ${selo(med.status)}</p>
    <div class="campos"><label>Técnica *<select name="tecnica" id="tecnica">${opcoes([['5porques', '5 Porquês — aprofundamento até a causa raiz'], ['5w2h', '5W2H — descrição estruturada do desvio'],
      ['ishikawa', 'Ishikawa / 6M — espinha de peixe'], ['pareto', 'Pareto — causas mais frequentes'], ['a3', 'Relatório A3 — resolução estruturada'], ['arvore', 'Árvore de falhas — combinação de causas']], '5porques')}</select></label>
    <label>Responsável pela análise<input name="responsavel" value="${esc(estado.usuario.nome)}"></label></div>
    <div class="assistente"><button type="button" class="btn peq" id="sugerir">✨ Sugerir causas e ações</button><div id="sugestoes"></div></div>
    <div id="camposTecnica"></div>
    <div class="campos" style="margin-top:12px"><label class="largo">Causa raiz identificada<textarea name="causa_raiz" placeholder="Conclusão da análise (preenchida automaticamente em 5 Porquês, Pareto e A3 se ficar vazia)"></textarea></label></div>
    ${rodape('Registrar análise')}</form>`, null, { largo: true });
  const sel = $('#tecnica', corpo); const alvo = $('#camposTecnica', corpo);
  const trocar = () => {
    alvo.innerHTML = camposTecnica(sel.value);
    const mais = $('#maisPareto', alvo);
    if (mais) mais.onclick = () => $('#paretoItens', alvo).insertAdjacentHTML('beforeend', linhaPareto($$('.linha-pareto', alvo).length + 1));
  };
  trocar(); sel.onchange = trocar;
  $('#sugerir', corpo).onclick = tentar(async (e) => {
    e.target.disabled = true; e.target.textContent = 'Analisando…';
    try {
      const s = await api(`/indicadores/medicoes/${med.id}/sugestoes`, { metodo: 'POST' });
      $('#sugestoes', corpo).innerHTML = `<div class="sugestao"><div class="muted" style="font-size:12px">${s.fonte === 'claude' ? '✨ Sugestões geradas por IA a partir do histórico — confirme com dados antes de concluir' : '📚 Sugestões a partir do histórico da empresa'}${s.aviso ? ` · ${esc(s.aviso)}` : ''}</div>
        <p>${esc(s.resumo)}</p>
        ${s.causas_provaveis.length ? `<b>Causas prováveis</b><ul>${s.causas_provaveis.map((c) => `<li><button type="button" class="link-btn" data-usar-causa="${esc(c.causa)}">usar</button> ${esc(c.causa)} ${selo(c.confianca === 'alta' ? 'atingido' : c.confianca === 'media' ? 'atencao' : 'pendente', 'confiança ' + c.confianca)}${c.categoria_6m && c.categoria_6m !== 'outro' ? ` <span class="muted">(${esc(SEISM.find(([k]) => k === c.categoria_6m)?.[1] || c.categoria_6m)})</span>` : ''}<div class="muted" style="font-size:12px">${esc(c.justificativa)}</div></li>`).join('')}</ul>` : ''}
        ${s.acoes_sugeridas.length ? `<b>Ações sugeridas</b><ul>${s.acoes_sugeridas.map((a) => `<li>${esc(a.o_que)} <span class="muted">— ${rot(a.tipo)}, ~${a.prazo_dias} dias. ${esc(a.como || '')}</span></li>`).join('')}</ul>` : ''}
        ${s.perguntas_para_investigar?.length ? `<b>Perguntas para investigar</b><ul>${s.perguntas_para_investigar.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}</div>`;
      sessionStorage.setItem('sugestoes_' + med.id, JSON.stringify(s.acoes_sugeridas || []));
    } finally { e.target.disabled = false; e.target.textContent = '✨ Sugerir causas e ações'; }
  });
  corpo.addEventListener('click', (e) => { const c = e.target.dataset?.usarCausa; if (c) $('[name=causa_raiz]', corpo).value = c; });
  $('#fAnalise', corpo).addEventListener('submit', tentar(async (e) => {
    e.preventDefault();
    const d = dadosForm(e.target);
    await api(`/indicadores/medicoes/${med.id}/analises`, { metodo: 'POST', corpo: { tecnica: d.tecnica, responsavel: d.responsavel, causa_raiz: d.causa_raiz, conteudo: montarConteudoAnalise(d, e.target) } });
    fecharModal(); toast('Análise registrada'); render();
  }));
}

function linhaAcaoForm(n, a = {}) {
  return `<fieldset data-acao><legend>Ação ${n}</legend><div class="campos">
    <label class="largo">O quê? (What) *<input name="o_que" value="${esc(a.o_que)}" required></label>
    <label class="largo">Por quê? (Why)<input name="por_que" value="${esc(a.por_que)}"></label>
    <label>Onde? (Where)<input name="onde" value="${esc(a.onde)}"></label>
    <label>Quando? (prazo) *<input name="quando" type="date" value="${esc(a.quando)}" required></label>
    <label>Quem? (Who) *<input name="quem" value="${esc(a.quem)}" list="dlPessoas" required></label>
    <label>Quanto? (R$)<input name="quanto" type="number" step="any" min="0" value="${esc(a.quanto)}"></label>
    <label class="largo">Como? (How)<input name="como" value="${esc(a.como)}"></label>
  </div></fieldset>`;
}
const lerAcoes = (form) => $$('[data-acao]', form).map((fs) => Object.fromEntries($$('[name]', fs).map((i) => [i.name, i.value])));
const camposGut = (p = {}) => `<fieldset><legend>Priorização GUT (1 a 5)</legend><div class="campos">
  ${[['gravidade', 'Gravidade'], ['urgencia', 'Urgência'], ['tendencia_gut', 'Tendência']].map(([k, t]) => `<label>${t}<select name="${k}">${opcoes([1, 2, 3, 4, 5].map((n) => [n, String(n)]), p[k], '—')}</select></label>`).join('')}</div></fieldset>`;

function abrirNovoPlano(indicadorId, analises, analiseId) {
  const medId = analises.find((a) => String(a.id) === String(analiseId))?.medicao_id;
  const sugeridas = medId ? JSON.parse(sessionStorage.getItem('sugestoes_' + medId) || '[]') : [];
  const prazo = (dias) => new Date(Date.now() + dias * 864e5).toISOString().slice(0, 10);
  const iniciais = sugeridas.length ? sugeridas.map((s, k) => linhaAcaoForm(k + 1, { o_que: s.o_que, por_que: s.por_que, como: s.como, quando: prazo(s.prazo_dias || 30) })).join('') : linhaAcaoForm(1);
  const corpo = abrirModal('Novo plano de ação (5W2H)', `<form id="fPlano"><div class="campos">
      <label class="largo">Título *<input name="titulo" required></label>
      <label>Análise de origem<select name="analise_id">${opcoes(analises.map((a) => [a.id, `${mesBR(a.periodo)} · ${rot(a.tecnica)}${a.causa_raiz ? ' · ' + a.causa_raiz.slice(0, 50) : ''}`]), analiseId, 'Sem análise vinculada')}</select></label>
      <label>Responsável pelo plano<input name="responsavel" list="dlPessoas"></label>
      <label class="largo">Objetivo<input name="objetivo" placeholder="Ex.: retornar o indicador à meta até…"></label></div>
      ${camposGut()}
      ${sugeridas.length ? '<p class="dica">Ações pré-preenchidas a partir das sugestões do assistente — revise antes de salvar.</p>' : ''}
      <div id="acoes">${iniciais}</div>
      <button type="button" class="btn peq" id="maisAcao" style="margin-top:8px">+ Adicionar ação</button>
      ${rodape('Criar plano')}</form>`, null, { largo: true });
  const form = $('#fPlano', corpo);
  $('#maisAcao', corpo).onclick = () => $('#acoes', corpo).insertAdjacentHTML('beforeend', linhaAcaoForm($$('[data-acao]', form).length + 1));
  form.addEventListener('submit', tentar(async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(['titulo', 'analise_id', 'responsavel', 'objetivo', 'gravidade', 'urgencia', 'tendencia_gut'].map((k) => [k, form.elements[k].value]));
    const p = await api('/planos', { metodo: 'POST', corpo: { ...d, indicador_id: indicadorId, acoes: lerAcoes(form) } });
    fecharModal(); toast('Plano criado'); irPara('#/planos/' + p.id);
  }));
}

// ---------- Ficha do indicador ----------
rota('/indicadores/:id', async (el, { id }, q) => {
  const aba = q.aba || 'geral';
  const [ind, meds, analises, planos, cep] = await Promise.all([api('/indicadores/' + id), api(`/indicadores/${id}/medicoes`), api(`/indicadores/${id}/analises`),
    api('/planos?indicador_id=' + id), api(`/indicadores/${id}/cep`)]);
  const editavel = podeEditarDepto(ind.departamento_id);
  const proximo = (() => { const u = meds[meds.length - 1]?.periodo; if (!u) return new Date().toISOString().slice(0, 7); const [a, m] = u.split('-').map(Number); return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`; })();
  const ult = ind.ultima_medicao;
  el.innerHTML = `<div class="trilha"><a href="#/indicadores">Indicadores</a> / ${esc(ind.departamento)}</div>
  <div class="cabecalho"><div><h1>${esc(ind.codigo ? ind.codigo + ' · ' : '')}${esc(ind.nome)}</h1><div class="muted">${esc(ind.descricao || '')}</div></div>
    ${editavel ? '<div class="acoes"><button class="btn" id="editar">Editar</button><button class="btn perigo" id="excluir">Excluir</button></div>' : ''}</div>
  <div class="grid g4" style="margin-bottom:16px">
    <div class="stat"><div class="rot">Meta / range</div><div style="font-weight:600;margin-top:4px">${esc(faixaTexto(ind))}</div></div>
    ${stat(`Último valor ${ult ? '(' + mesBR(ult.periodo) + ')' : ''}`, ult ? fmt(ult.valor) : '—', ult?.status === 'atingido' ? 'ok' : ult?.status === 'atencao' ? 'at' : ult ? 'er' : '')}
    <div class="stat"><div class="rot">Tendência / estabilidade</div><div style="margin-top:6px">${selo(ind.tendencia)} ${cep.suficiente ? selo(cep.ultimo_instavel ? 'desvio' : cep.estavel ? 'atingido' : 'atencao', cep.ultimo_instavel ? 'Fora de controle' : cep.estavel ? 'Processo estável' : 'Sinais de instabilidade') : ''}</div></div>
    <div class="stat"><div class="rot">Ficha</div><div class="muted" style="font-size:13px">${rot(ind.tipo)} · ${rot(ind.polaridade)} · ${esc(ind.frequencia)}<br>${esc(ind.responsavel || 'sem responsável')}${ind.perspectiva ? ' · ' + rot(ind.perspectiva) : ''}
      ${ind.tipo === 'calculado' ? `<br><code>${esc(ind.formula_calculo)}</code>` : ''}</div></div>
  </div>
  ${abas([['geral', 'Evolução e medições'], ['analises', `Análises e planos (${analises.length}/${planos.length})`], ['sazonal', 'Metas por período'], ['historico', 'Histórico da ficha'], ['colab', 'Comentários e anexos']], aba)}
  <div id="conteudoAba"></div>`;
  const alvo = $('#conteudoAba', el);
  el.addEventListener('click', (e) => { const a = e.target.closest('[data-aba]'); if (a) irPara(`#/indicadores/${id}?aba=${a.dataset.aba}`); });

  if (aba === 'geral') {
    alvo.innerHTML = `<div class="card"><div class="depto-topo"><h2 style="margin:0">Evolução</h2><label class="check"><input type="checkbox" id="verCep" ${cep.suficiente ? '' : 'disabled'}> Limites de controle (CEP)</label></div><div id="graf">${grafico(ind, meds)}</div>
      ${cep.suficiente ? `<p class="dica">Carta I-MR: média ${fmt(cep.media)}, σ ${fmt(cep.sigma)}. Sinais: ponto fora de ±3σ, 8 pontos seguidos do mesmo lado da média ou 6 em tendência.</p>` : '<p class="dica">São necessárias ao menos 5 medições para a carta de controle.</p>'}</div>
    <div class="card"><h2>Medições</h2>
      ${editavel && ind.tipo !== 'calculado' ? `<form id="fMed" class="filtros"><label style="min-width:130px">Período<input type="month" name="periodo" value="${proximo}" required></label>
        <label style="min-width:110px">Valor<input type="number" step="any" name="valor" required></label>
        <label style="flex:1">Comentário<input name="comentario"></label><button class="btn pri">Registrar</button></form>` : ''}
      ${ind.tipo === 'calculado' ? '<p class="dica">Valores calculados automaticamente a partir da fórmula.</p>' : ''}
      <div class="tabela-wrap"><table><thead><tr><th>Período</th><th class="num">Valor</th><th class="num">Meta</th><th>Status</th><th>Comentário</th><th></th></tr></thead><tbody>
      ${[...meds].reverse().map((m) => `<tr><td>${mesBR(m.periodo)}</td><td class="num">${fmt(m.valor)}</td><td class="num">${fmt(m.meta)}</td><td>${selo(m.status)}</td><td class="muted">${esc(m.comentario || '')}</td>
        <td class="linha-acoes">${editavel && m.status !== 'atingido' ? `<button class="btn peq ${m.analise_pendente ? 'pri' : ''}" data-analisar="${m.id}">${m.analise_pendente ? 'Analisar desvio' : 'Nova análise'}</button>` : ''}${editavel && ind.tipo !== 'calculado' ? `<button class="btn peq perigo" data-del-med="${m.id}" aria-label="Excluir medição">✕</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="vazio">Nenhuma medição</td></tr>'}
      </tbody></table></div></div>`;
    $('#verCep', alvo).onchange = (e) => { $('#graf', alvo).innerHTML = grafico(ind, meds, e.target.checked ? cep : null); };
    if ($('#fMed', alvo)) $('#fMed', alvo).addEventListener('submit', tentar(async (e) => {
      e.preventDefault();
      const r = await api(`/indicadores/${id}/medicoes`, { metodo: 'POST', corpo: dadosForm(e.target) });
      await render();
      if (r.exige_analise) { toast('Desvio detectado — registre a análise de causa', true); abrirAnalise(r); } else toast(`Medição registrada: ${rot(r.status)}`);
    }));
  }
  if (aba === 'analises') {
    alvo.innerHTML = `<div class="grid g2"><div class="card"><h2>Análises de desvio</h2>${analises.map((a) => renderAnalise(a, editavel)).join('') || vazio('Nenhuma análise registrada')}</div>
      <div class="card"><div class="depto-topo"><h2 style="margin:0">Planos de ação</h2>${editavel ? '<button class="btn peq" id="novoPlano">+ Novo plano</button>' : ''}</div>
        ${planos.map((p) => `<div class="alerta"><div style="flex:1"><a href="#/planos/${p.id}"><b>${esc(p.titulo)}</b></a><div class="muted" style="font-size:12px">${p.acoes.length} ações · prazo ${dataBR(p.prazo_final)} · ${moeda(p.custo_total)}${p.prioridade ? ` · GUT ${p.prioridade}` : ''}</div>${barra(p.progresso, 100)}</div>
          <div>${p.fase_pdca ? selo('pendente', rot(p.fase_pdca)) : ''} ${selo(p.status)} ${p.acoes_atrasadas ? selo('atrasada', p.acoes_atrasadas + ' atrasada(s)') : ''}</div></div>`).join('') || vazio('Nenhum plano')}</div></div>`;
  }
  if (aba === 'sazonal') {
    const mps = await api(`/indicadores/${id}/metas-periodo`);
    alvo.innerHTML = `<div class="card"><h2>Metas por período (sazonalidade)</h2><p class="dica">Defina meta e range específicos para períodos com comportamento sazonal. Nos demais, vale a meta da ficha (${esc(faixaTexto(ind))}).</p>
      ${editavel ? `<form id="fSaz" class="filtros"><label>Período<input type="month" name="periodo" required></label><label>Meta<input type="number" step="any" name="meta" required></label>
        <label>Limite inferior<input type="number" step="any" name="limite_inferior"></label><label>Limite superior<input type="number" step="any" name="limite_superior"></label><button class="btn pri">Salvar</button></form>` : ''}
      <div class="tabela-wrap"><table><thead><tr><th>Período</th><th class="num">Meta</th><th class="num">Lim. inferior</th><th class="num">Lim. superior</th><th></th></tr></thead><tbody>
      ${mps.map((m) => `<tr><td>${mesBR(m.periodo)}</td><td class="num">${fmt(m.meta)}</td><td class="num">${fmt(m.limite_inferior)}</td><td class="num">${fmt(m.limite_superior)}</td><td>${editavel ? `<button class="btn peq perigo" data-del-saz="${m.periodo}">✕</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="vazio">Nenhuma meta sazonal</td></tr>'}</tbody></table></div></div>`;
    if ($('#fSaz', alvo)) $('#fSaz', alvo).addEventListener('submit', tentar(async (e) => { e.preventDefault(); await api(`/indicadores/${id}/metas-periodo`, { metodo: 'POST', corpo: dadosForm(e.target) }); toast('Meta do período salva; medição reclassificada'); render(); }));
  }
  if (aba === 'historico') {
    const vs = await api(`/indicadores/${id}/versoes`);
    alvo.innerHTML = `<div class="card"><h2>Histórico de alterações da ficha</h2>${vs.map((v) => `<div class="versao"><div class="muted" style="font-size:12px">${dataHoraBR(v.criado_em)} · ${esc(v.usuario || '')}</div>
      <ul>${Object.keys(v.dados_novos).map((k) => `<li><b>${esc(k)}</b>: ${esc(v.dados_anteriores[k] ?? '—')} → ${esc(v.dados_novos[k] ?? '—')}</li>`).join('')}</ul>${v.justificativa ? `<div class="causa"><b>Justificativa:</b> ${esc(v.justificativa)}</div>` : ''}</div>`).join('') || vazio('Nenhuma alteração registrada')}</div>`;
  }
  if (aba === 'colab') await painelColaboracao(alvo, 'indicadores', 'indicador', id, { podeAnexar: editavel });

  if ($('#editar', el)) $('#editar', el).onclick = tentar(async () => { const c = abrirModal('Editar indicador', await formIndicador(ind), async (d) => { await api('/indicadores/' + id, { metodo: 'PUT', corpo: d }); cacheObjetivos = null; cacheResponsaveis = null; toast('Indicador atualizado'); }, { largo: true }); ligarFormIndicador(c); });
  if ($('#excluir', el)) $('#excluir', el).onclick = tentar(async () => { if (!confirmar('Excluir o indicador e todo o histórico (medições, análises e planos)?')) return; await api('/indicadores/' + id, { metodo: 'DELETE' }); irPara('#/indicadores'); toast('Indicador excluído'); });
  el.addEventListener('click', tentar(async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.analisar) abrirAnalise(meds.find((m) => m.id === +b.dataset.analisar));
    if (b.dataset.delMed && confirmar('Excluir esta medição?')) { await api('/indicadores/medicoes/' + b.dataset.delMed, { metodo: 'DELETE' }); render(); }
    if (b.dataset.delAnalise && confirmar('Excluir esta análise?')) { await api('/indicadores/analises/' + b.dataset.delAnalise, { metodo: 'DELETE' }); render(); }
    if (b.dataset.delSaz) { await api(`/indicadores/${id}/metas-periodo/${b.dataset.delSaz}`, { metodo: 'DELETE' }); render(); }
    if (b.dataset.planoAnalise) abrirNovoPlano(+id, analises, b.dataset.planoAnalise);
    if (b.id === 'novoPlano') abrirNovoPlano(+id, analises);
  }));
});

// ---------- Importação ----------
rota('/importar', async (el) => {
  el.innerHTML = `<div class="cabecalho"><h1>Importar medições</h1></div><div class="card">
    <p>Envie uma planilha <b>.xlsx</b> ou <b>.csv</b> (separador ; ou ,) com as colunas <code>codigo</code>, <code>periodo</code>, <code>valor</code> e, opcionalmente, <code>comentario</code>.
    Períodos aceitos: <code>2026-03</code>, <code>03/2026</code> ou uma data. Valores podem usar vírgula decimal.</p>
    <a class="btn peq" id="modelo" download="modelo-importacao.csv">Baixar modelo CSV</a>
    <form id="fImp" class="filtros" style="margin-top:12px"><label style="flex:1">Arquivo<input type="file" name="arquivo" accept=".csv,.xlsx" required></label>
    <button type="button" class="btn" id="simular">Validar (simulação)</button><button class="btn pri">Importar</button></form><div id="resultado"></div></div>`;
  $('#modelo', el).href = URL.createObjectURL(new Blob(['﻿codigo;periodo;valor;comentario\nCOM-01;2026-03;1250,5;Fechamento do mês\n'], { type: 'text/csv' }));
  const enviar = tentar(async (simular) => {
    const f = $('[name=arquivo]', el).files[0]; if (!f) { toast('Escolha um arquivo', true); return; }
    const r = await enviarArquivo('/indicadores/importar', f, simular ? { simular: 1 } : {});
    $('#resultado', el).innerHTML = `<div class="aviso ${r.erros ? 'erro' : ''}">${r.simulacao ? 'Simulação: ' : ''}${r.importadas} de ${r.total} linha(s) ${r.simulacao ? 'válidas' : 'importadas'}${r.erros ? `, ${r.erros} com erro` : ''}.</div>
      <div class="tabela-wrap"><table><thead><tr><th>Linha</th><th>Resultado</th><th>Indicador</th><th>Período</th><th class="num">Valor</th></tr></thead><tbody>
      ${r.linhas.map((l) => `<tr><td>${l.linha}</td><td>${l.ok ? selo(l.status || 'atingido', l.status ? rot(l.status) : 'OK') : selo('desvio', 'Erro') + ' ' + esc(l.erro)}</td><td>${esc(l.codigo || '')}</td><td>${esc(l.periodo || '')}</td><td class="num">${fmt(l.valor)}</td></tr>`).join('')}</tbody></table></div>`;
    if (!simular) toast('Importação concluída');
  });
  $('#simular', el).onclick = () => enviar(true);
  $('#fImp', el).addEventListener('submit', (e) => { e.preventDefault(); enviar(false); });
});

// ---------- Mapa estratégico ----------
rota('/mapa', async (el) => {
  const m = await api('/indicadores/mapa');
  const todos = m.perspectivas.flatMap((p) => p.objetivos);
  const nome = (id) => todos.find((o) => o.id === id)?.nome || '';
  el.innerHTML = `<div class="cabecalho"><div><h1>Mapa estratégico</h1><div class="muted">Balanced Scorecard — objetivos por perspectiva e situação dos indicadores vinculados</div></div>
    ${ehDiretoria() ? '<button class="btn pri" id="novoObj">+ Objetivo</button>' : ''}</div>
    <div class="mapa">${m.perspectivas.map((p) => `<section class="perspectiva"><h2>${rot(p.perspectiva)}</h2><div class="objetivos">
      ${p.objetivos.map((o) => `<article class="objetivo ${o.situacao}"><div class="depto-topo" style="margin:0"><b>${esc(o.nome)}</b>${ehDiretoria() ? `<button class="link-btn" data-edit-obj="${o.id}">editar</button>` : ''}</div>
        ${o.descricao ? `<div class="muted" style="font-size:12px">${esc(o.descricao)}</div>` : ''}
        <div class="obj-inds">${o.indicadores.map((i) => `<a href="#/indicadores/${i.id}" class="selo ${i.status}" title="${esc(i.departamento)}">${esc(i.codigo || i.nome)}</a>`).join('') || '<span class="muted" style="font-size:12px">sem indicadores</span>'}</div>
        ${o.contribui_para.length ? `<div class="muted" style="font-size:12px">→ contribui para: ${o.contribui_para.map((x) => esc(nome(x))).join(', ')}</div>` : ''}</article>`).join('') || '<p class="muted">Nenhum objetivo</p>'}</div></section>`).join('')}</div>
    ${m.sem_objetivo ? `<p class="dica">${m.sem_objetivo} indicador(es) visível(is) sem objetivo estratégico vinculado.</p>` : ''}`;
  const form = (o = {}) => abrirModal(o.id ? 'Editar objetivo' : 'Novo objetivo estratégico', `<form><div class="campos">
    <label>Perspectiva *<select name="perspectiva" required>${opcoes(['financeira', 'clientes', 'processos', 'aprendizado'].map((p) => [p, rot(p)]), o.perspectiva)}</select></label>
    <label class="largo">Nome *<input name="nome" required value="${esc(o.nome)}"></label><label class="largo">Descrição<textarea name="descricao">${esc(o.descricao)}</textarea></label>
    <label>Ordem<input type="number" name="ordem" value="${esc(o.ordem ?? 0)}"></label>
    <label class="largo">Contribui para (causa e efeito)<select name="contribui_para" multiple size="5">${todos.filter((x) => x.id !== o.id).map((x) => `<option value="${x.id}" ${o.contribui_para?.includes(x.id) ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</select></label></div>
    ${o.id ? '<button type="button" class="btn perigo peq" id="delObj">Excluir objetivo</button>' : ''}${rodape()}</form>`,
  async (d, f) => { d.contribui_para = [...f.elements.contribui_para.selectedOptions].map((x) => x.value); await api('/indicadores/objetivos' + (o.id ? '/' + o.id : ''), { metodo: o.id ? 'PUT' : 'POST', corpo: d }); cacheObjetivos = null; });
  if ($('#novoObj', el)) $('#novoObj', el).onclick = () => form();
  el.addEventListener('click', (e) => {
    const id = e.target.dataset?.editObj;
    if (id) {
      const c = form(todos.find((o) => o.id === +id));
      $('#delObj', c).onclick = tentar(async () => { if (!confirmar('Excluir o objetivo?')) return; await api('/indicadores/objetivos/' + id, { metodo: 'DELETE' }); cacheObjetivos = null; fecharModal(); render(); });
    }
  });
});

// ---------- Integrações (diretoria/admin) ----------
rota('/admin/integracoes', async (el) => {
  const [lista, inds] = await Promise.all([api('/indicadores/integracoes'), api('/indicadores')]);
  el.innerHTML = `<div class="cabecalho"><div><h1>Integrações de dados</h1><div class="muted">Coleta automática de valores via API HTTP/JSON (a cada 6 horas)</div></div><button class="btn pri" id="nova">+ Integração</button></div>
  <div class="card"><div class="tabela-wrap"><table><thead><tr><th>Indicador</th><th>URL</th><th>Caminho</th><th>Período</th><th>Última execução</th><th></th></tr></thead><tbody>
  ${lista.map((g) => `<tr><td>${esc(g.codigo || '')} ${esc(g.indicador)}</td><td class="quebra">${esc(g.url)}</td><td><code>${esc(g.caminho)}</code></td><td>${g.periodo_ref === 'atual' ? 'mês atual' : 'mês anterior'}</td>
    <td>${g.ultima_execucao ? dataHoraBR(g.ultima_execucao) + '<br>' : ''}<span class="muted">${esc(g.ultimo_status || '—')}</span></td>
    <td class="linha-acoes"><button class="btn peq" data-exec="${g.id}">Executar agora</button><button class="btn peq perigo" data-del="${g.id}">✕</button></td></tr>`).join('') || '<tr><td colspan="6" class="vazio">Nenhuma integração</td></tr>'}</tbody></table></div>
  <p class="dica">Também é possível enviar valores ao sistema: crie um token em Administração → Tokens de API e use <code>POST /api/indicadores/{id}/medicoes</code> com <code>Authorization: Bearer &lt;token&gt;</code>.</p></div>`;
  $('#nova', el).onclick = () => abrirModal('Nova integração', `<form><div class="campos">
    <label class="largo">Indicador *<select name="indicador_id" required>${opcoes(inds.filter((i) => i.tipo !== 'calculado').map((i) => [i.id, `${i.codigo ? i.codigo + ' · ' : ''}${i.nome}`]), '', 'Selecione…')}</select></label>
    <label class="largo">URL (GET, resposta JSON) *<input name="url" type="url" required placeholder="https://erp.empresa.com/api/kpis/faturamento"></label>
    <label>Caminho do valor no JSON *<input name="caminho" required placeholder="data.total ou itens[0].valor"></label>
    <label>Período de referência<select name="periodo_ref">${opcoes([['anterior', 'Mês anterior'], ['atual', 'Mês atual']], 'anterior')}</select></label>
    <label>Cabeçalho de autenticação<input name="cab_nome" placeholder="Authorization"></label><label>Valor do cabeçalho<input name="cab_valor" type="password" autocomplete="off"></label></div>
    <p class="dica">O valor do cabeçalho fica armazenado no servidor e não é exibido novamente.</p>${rodape()}</form>`,
  (d) => api('/indicadores/integracoes', { metodo: 'POST', corpo: { ...d, cabecalhos: d.cab_nome ? { [d.cab_nome]: d.cab_valor } : null } }));
  el.addEventListener('click', tentar(async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.exec) { const r = await api(`/indicadores/integracoes/${b.dataset.exec}/executar`, { metodo: 'POST' }); toast(r.status, r.status.startsWith('erro')); render(); }
    if (b.dataset.del && confirmar('Excluir integração?')) { await api('/indicadores/integracoes/' + b.dataset.del, { metodo: 'DELETE' }); render(); }
  }));
});
