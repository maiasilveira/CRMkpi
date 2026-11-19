'use strict';
/* SPA sem dependências: roteamento por hash, um "view" por tela. */

// ============ Utilidades ============
const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, casas = 2) => (v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: casas }));
const moeda = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (s) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '—');
const mesBR = (p) => { if (!p) return '—'; const [a, m] = p.split('-'); return `${['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][+m - 1]}/${a.slice(2)}`; };
const pct = (v) => (v === null || v === undefined ? '—' : `${fmt(v, 1)}%`);

const ROTULOS = {
  atingido: 'Atingido', atencao: 'Atenção', desvio: 'Desvio', sem_medicao: 'Sem medição',
  maior_melhor: 'Maior é melhor', menor_melhor: 'Menor é melhor', faixa: 'Dentro da faixa',
  aberto: 'Aberto', em_andamento: 'Em andamento', concluido: 'Concluído', cancelado: 'Cancelado',
  pendente: 'Pendente', concluida: 'Concluída', cancelada: 'Cancelada',
  eficaz: 'Eficaz', nao_eficaz: 'Não eficaz',
  '5w2h': '5W2H', '5porques': '5 Porquês', ishikawa: 'Ishikawa (6M)',
  planejamento: 'Planejamento', ativo: 'Ativo', encerrado: 'Encerrado',
  submetido: 'Submetido', aprovado: 'Aprovado',
  sem_resultado: 'Sem resultado', abaixo_gatilho: 'Abaixo do gatilho', parcial: 'Parcial', atingida: 'Atingida', superada: 'Superada',
  melhorando: '↗ Melhorando', piorando: '↘ Piorando', estavel: '→ Estável', variando: '↕ Variando', indefinida: '—',
  manual: 'Manual', indicador: 'Indicador', soma: 'Soma', media: 'Média', ultimo: 'Último valor',
  financeira: 'Financeira', clientes: 'Clientes', processos: 'Processos internos', aprendizado: 'Aprendizado e crescimento',
};
const rot = (k) => ROTULOS[k] || k || '—';
const selo = (k, texto) => `<span class="selo ${esc(k)}">${esc(texto || rot(k))}</span>`;
const opcoes = (lista, sel, vazio) => (vazio !== undefined ? `<option value="">${esc(vazio)}</option>` : '')
  + lista.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(sel ?? '') ? 'selected' : ''}>${esc(t)}</option>`).join('');
const SEISM = [['metodo', 'Método'], ['maquina', 'Máquina'], ['material', 'Material'], ['mao_de_obra', 'Mão de obra'], ['medicao', 'Medição'], ['meio_ambiente', 'Meio ambiente']];
const W2H = [['o_que', 'O quê? (What)'], ['por_que', 'Por quê? (Why)'], ['onde', 'Onde? (Where)'], ['quando', 'Quando? (When)'], ['quem', 'Quem? (Who)'], ['como', 'Como? (How)'], ['quanto', 'Quanto? (How much)']];

async function api(url, { metodo = 'GET', corpo } = {}) {
  const r = await fetch('/api' + url, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : {}, body: corpo ? JSON.stringify(corpo) : undefined });
  if (r.status === 204) return null;
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(dados.erro || `Erro ${r.status}`);
  return dados;
}

function toast(msg, erro = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast' + (erro ? ' erro' : ''); t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, erro ? 5000 : 2500);
}

function dadosForm(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') o[el.name] = el.checked; else o[el.name] = el.value;
  }
  return o;
}

// ============ Modal ============
function abrirModal(titulo, html, aoEnviar) {
  $('#modalTitulo').textContent = titulo;
  $('#modalCorpo').innerHTML = html;
  $('#modal').hidden = false;
  const form = $('#modalCorpo form');
  if (form && aoEnviar) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      try { await aoEnviar(dadosForm(form), form); fecharModal(); render(); } catch (err) { toast(err.message, true); } finally { btn.disabled = false; }
    });
    setTimeout(() => form.querySelector('input,select,textarea')?.focus(), 30);
  }
  return $('#modalCorpo');
}
function fecharModal() { $('#modal').hidden = true; $('#modalCorpo').innerHTML = ''; }
document.addEventListener('click', (e) => { if (e.target.matches('[data-fechar]') || e.target.id === 'modal') fecharModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) fecharModal(); });
const rodape = (txt = 'Salvar') => `<div class="rodape-form"><button type="button" class="btn" data-fechar>Cancelar</button><button type="submit" class="btn pri">${txt}</button></div>`;

// ============ Estado global ============
const estado = { modulos: [], departamentos: [] };
const temModulo = (n) => estado.modulos.some((m) => m.nome === n);
const deptoOpcoes = (sel, vazio) => opcoes(estado.departamentos.map((d) => [d.id, d.nome]), sel, vazio);

// ============ Roteador ============
const rotas = [];
const rota = (padrao, fn) => rotas.push([new RegExp('^' + padrao.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn]);

async function render() {
  const hash = location.hash.slice(1) || '/';
  const [caminho, qs] = hash.split('?');
  const params = Object.fromEntries(new URLSearchParams(qs || ''));
  // Substitui o contêiner para descartar listeners da tela anterior
  const antigo = $('#app'); const el = antigo.cloneNode(false); antigo.replaceWith(el);
  for (const a of document.querySelectorAll('#nav a')) {
    const alvo = a.getAttribute('href').slice(1);
    a.classList.toggle('ativo', alvo === '/' ? caminho === '/' : caminho.startsWith(alvo));
  }
  $('#nav').classList.remove('aberto');
  for (const [re, fn] of rotas) {
    const m = caminho.match(re);
    if (m) {
      try { await fn(el, { ...m.groups }, params); } catch (err) { el.innerHTML = `<div class="card vazio">⚠ ${esc(err.message)}</div>`; }
      return;
    }
  }
  el.innerHTML = '<div class="card vazio">Página não encontrada</div>';
}

function montarNav() {
  const itens = [['#/', 'Painel']];
  if (temModulo('indicadores')) itens.push(['#/indicadores', 'Indicadores'], ['#/planos', 'Planos de ação']);
  if (temModulo('metas')) itens.push(['#/metas', 'Metas bonificáveis']);
  itens.push(['#/departamentos', 'Departamentos'], ['#/auditoria', 'Auditoria']);
  $('#nav').innerHTML = itens.map(([h, t]) => `<a href="${h}">${t}</a>`).join('');
}

// ============ Gráfico SVG ============
function grafico(ind, medicoes) {
  if (!medicoes.length) return '<div class="vazio">Sem medições registradas</div>';
  const W = 760; const H = 260; const pe = 48; const pd = 28; const pt = 16; const pb = 32;
  const vals = medicoes.map((m) => m.valor);
  const refs = [ind.meta, ind.limite_inferior, ind.limite_superior].filter((v) => v !== null && v !== undefined);
  let min = Math.min(...vals, ...refs); let max = Math.max(...vals, ...refs);
  const folga = (max - min) * 0.12 || Math.abs(max) * 0.1 || 1; min -= folga; max += folga;
  const x = (i) => pe + (medicoes.length === 1 ? (W - pe - pd) / 2 : (i * (W - pe - pd)) / (medicoes.length - 1));
  const y = (v) => pt + (1 - (v - min) / (max - min)) * (H - pt - pb);
  // Faixa aceitável
  let faixa = '';
  const li = ind.limite_inferior; const ls = ind.limite_superior;
  let fTopo = null; let fBase = null;
  if (ind.polaridade === 'maior_melhor' && li !== null) { fTopo = max; fBase = li; }
  if (ind.polaridade === 'menor_melhor' && ls !== null) { fTopo = ls; fBase = min; }
  if (ind.polaridade === 'faixa') { fTopo = ls ?? max; fBase = li ?? min; }
  if (fTopo !== null) faixa = `<rect class="faixa" x="${pe}" y="${y(fTopo)}" width="${W - pe - pd}" height="${Math.max(0, y(fBase) - y(fTopo))}"/>`;
  const ticks = Array.from({ length: 5 }, (_, i) => min + ((max - min) * i) / 4);
  const cor = { atingido: 'var(--ok)', atencao: 'var(--at)', desvio: 'var(--er)' };
  const passo = Math.ceil(medicoes.length / 12);
  return `<svg class="grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolução de ${esc(ind.nome)}">
    ${ticks.map((t) => `<line class="eixo" x1="${pe}" x2="${W - pd}" y1="${y(t)}" y2="${y(t)}" opacity=".5"/><text x="${pe - 6}" y="${y(t) + 4}" text-anchor="end">${fmt(t, 1)}</text>`).join('')}
    ${faixa}
    <line class="meta" x1="${pe}" x2="${W - pd}" y1="${y(ind.meta)}" y2="${y(ind.meta)}"/>
    <polyline class="linha" points="${medicoes.map((m, i) => `${x(i)},${y(m.valor)}`).join(' ')}"/>
    ${medicoes.map((m, i) => `<circle cx="${x(i)}" cy="${y(m.valor)}" r="5" fill="${cor[m.status]}" stroke="var(--sup)" stroke-width="2"><title>${mesBR(m.periodo)}: ${fmt(m.valor)} ${esc(ind.unidade || '')} — ${rot(m.status)}</title></circle>`).join('')}
    ${medicoes.map((m, i) => (i % passo === 0 ? `<text x="${x(i)}" y="${H - 10}" text-anchor="middle">${mesBR(m.periodo)}</text>` : '')).join('')}
  </svg>
  <div class="legenda"><span><i style="background:transparent;border-top:2px dashed var(--txt);border-radius:0;height:0"></i>Meta (${fmt(ind.meta)})</span>
    ${fTopo !== null ? '<span><i style="background:var(--ok);opacity:.25"></i>Range aceitável</span>' : ''}
    <span><i style="background:var(--ok)"></i>Atingido</span><span><i style="background:var(--at)"></i>Atenção</span><span><i style="background:var(--er)"></i>Desvio</span></div>`;
}

const barra = (v, max = 120) => {
  if (v === null || v === undefined) return '<span class="muted">—</span>';
  const cls = v >= 100 ? 'ok' : v > 0 ? 'at' : 'er';
  return `<div class="barra-rot"><div class="barra ${cls}"><span style="width:${Math.min(100, (v / max) * 100)}%"></span></div><span class="num">${pct(v)}</span></div>`;
};

function faixaTexto(i) {
  const u = i.unidade ? ` ${i.unidade}` : '';
  if (i.polaridade === 'maior_melhor') return `≥ ${fmt(i.meta)}${u}` + (i.limite_inferior !== null ? ` (aceitável ≥ ${fmt(i.limite_inferior)})` : '');
  if (i.polaridade === 'menor_melhor') return `≤ ${fmt(i.meta)}${u}` + (i.limite_superior !== null ? ` (aceitável ≤ ${fmt(i.limite_superior)})` : '');
  return `${fmt(i.limite_inferior)} a ${fmt(i.limite_superior)}${u} (ideal ${fmt(i.meta)})`;
}

// ============ PAINEL ============
rota('/', async (el) => {
  const [pi, ciclos] = await Promise.all([
    temModulo('indicadores') ? api('/indicadores/painel') : null,
    temModulo('metas') ? api('/metas/ciclos') : [],
  ]);
  const ciclo = ciclos.find((c) => c.status === 'ativo') || ciclos[0];
  const ap = ciclo ? await api(`/metas/ciclos/${ciclo.id}/apuracao`) : null;
  let html = '<div class="cabecalho"><h1>Painel de gestão</h1></div>';
  if (pi) {
    html += `<div class="grid g4" style="margin-bottom:16px">
      <div class="stat"><div class="rot">Indicadores ativos</div><div class="val">${pi.total_indicadores}</div></div>
      <div class="stat ok"><div class="rot">Atingidos</div><div class="val">${pi.status.atingido}</div></div>
      <div class="stat at"><div class="rot">Em atenção</div><div class="val">${pi.status.atencao}</div></div>
      <div class="stat er"><div class="rot">Em desvio</div><div class="val">${pi.status.desvio}</div></div>
      <div class="stat"><div class="rot">Planos em aberto</div><div class="val">${pi.planos.abertos}</div></div>
      <div class="stat ${pi.planos.com_atraso ? 'er' : ''}"><div class="rot">Planos com atraso</div><div class="val">${pi.planos.com_atraso}</div></div>
    </div>
    <div class="grid g2">
      <div class="card"><h2>Alertas</h2>${pi.alertas.length ? pi.alertas.map((a) => `<div class="alerta">${selo(a.gravidade === 'alta' ? 'desvio' : a.gravidade === 'media' ? 'atencao' : 'pendente', a.gravidade)}
        <a href="${a.plano_id ? '#/planos/' + a.plano_id : '#/indicadores/' + a.indicador_id}">${esc(a.mensagem)}</a></div>`).join('') : '<div class="vazio">Nenhum alerta 🎉</div>'}</div>
      <div class="card"><h2>Indicadores por departamento</h2><div class="tabela-wrap"><table><thead><tr><th>Departamento</th><th class="num">Total</th><th class="num">Atingido</th><th class="num">Atenção</th><th class="num">Desvio</th><th>Saúde</th></tr></thead><tbody>
        ${pi.por_departamento.map((d) => `<tr><td><a href="#/indicadores?departamento_id=${d.departamento_id}">${esc(d.departamento)}</a></td><td class="num">${d.total}</td><td class="num">${d.atingido}</td><td class="num">${d.atencao}</td><td class="num">${d.desvio}</td><td>${barra(d.total ? (d.atingido / d.total) * 100 : 0, 100)}</td></tr>`).join('') || '<tr><td colspan="6" class="vazio">Sem indicadores</td></tr>'}
      </tbody></table></div></div>
    </div>`;
  }
  if (ap) {
    html += `<div class="card"><div class="cabecalho" style="margin:0 0 8px"><h2 style="margin:0">Metas bonificáveis — ${esc(ap.ciclo.nome)} ${selo(ap.ciclo.status)}</h2><a class="btn peq" href="#/metas?ciclo=${ap.ciclo.id}">Abrir scorecard</a></div>
      <div class="resumo-meta" style="margin-bottom:12px"><div>Nota média<b>${pct(ap.totais.nota_media)}</b></div><div>Bônus-alvo<b>${moeda(ap.totais.valor_base)}</b></div><div>Bônus apurado<b>${moeda(ap.totais.bonus)}</b></div><div>% do alvo<b>${pct(ap.totais.pct_pago)}</b></div></div>
      <div class="tabela-wrap"><table><thead><tr><th>Departamento</th><th>Nota</th><th class="num">Bônus</th><th>Apuração</th></tr></thead><tbody>
      ${ap.departamentos.map((d) => `<tr><td>${esc(d.departamento)}</td><td style="min-width:180px">${barra(d.nota)}</td><td class="num">${moeda(d.bonus)}</td><td>${selo(d.status_apuracao)}</td></tr>`).join('')}
      </tbody></table></div></div>`;
  }
  if (!pi && !ap) html += '<div class="card vazio">Nenhum dado disponível. Cadastre departamentos e comece por um dos módulos.</div>';
  el.innerHTML = html;
});

// ============ INDICADORES ============
function formIndicador(i = {}) {
  return `<form><div class="campos">
    <label>Código<input name="codigo" value="${esc(i.codigo)}" placeholder="Ex.: COM-01"></label>
    <label class="largo">Nome *<input name="nome" required value="${esc(i.nome)}"></label>
    <label>Departamento *<select name="departamento_id" required>${deptoOpcoes(i.departamento_id, 'Selecione…')}</select></label>
    <label>Responsável<input name="responsavel" value="${esc(i.responsavel)}"></label>
    <label>Unidade<input name="unidade" value="${esc(i.unidade)}" placeholder="%, R$, dias…"></label>
    <label>Frequência<select name="frequencia">${opcoes([['mensal', 'Mensal'], ['bimestral', 'Bimestral'], ['trimestral', 'Trimestral'], ['semestral', 'Semestral'], ['anual', 'Anual']], i.frequencia || 'mensal')}</select></label>
    <label>Perspectiva (BSC)<select name="perspectiva">${opcoes(['financeira', 'clientes', 'processos', 'aprendizado'].map((p) => [p, rot(p)]), i.perspectiva, '—')}</select></label>
    <label>Polaridade *<select name="polaridade" required>${opcoes(['maior_melhor', 'menor_melhor', 'faixa'].map((p) => [p, rot(p)]), i.polaridade || 'maior_melhor')}</select></label>
    <label>Meta *<input name="meta" type="number" step="any" required value="${esc(i.meta)}"></label>
    <label>Limite inferior aceitável<input name="limite_inferior" type="number" step="any" value="${esc(i.limite_inferior)}"></label>
    <label>Limite superior aceitável<input name="limite_superior" type="number" step="any" value="${esc(i.limite_superior)}"></label>
    <label class="largo">Descrição<textarea name="descricao">${esc(i.descricao)}</textarea></label>
    <label>Fórmula de cálculo<input name="formula" value="${esc(i.formula)}"></label>
    <label>Fonte dos dados<input name="fonte_dados" value="${esc(i.fonte_dados)}"></label>
  </div>
  <p class="dica"><b>Range aceitável:</b> "maior é melhor" usa o limite inferior (entre ele e a meta = atenção); "menor é melhor" usa o limite superior; "faixa" exige que o valor fique entre os dois limites. Fora do range = <b>desvio</b>, o que exige análise de causa.</p>
  ${rodape()}</form>`;
}

rota('/indicadores', async (el, _, q) => {
  const lista = await api('/indicadores?' + new URLSearchParams(Object.entries(q).filter(([, v]) => v)));
  el.innerHTML = `<div class="cabecalho"><h1>Indicadores de desempenho</h1><div class="acoes"><button class="btn pri" id="novo">+ Novo indicador</button></div></div>
  <div class="card"><form class="filtros" id="filtros">
    <label>Departamento<select name="departamento_id">${deptoOpcoes(q.departamento_id, 'Todos')}</select></label>
    <label>Status atual<select name="status">${opcoes([['atingido', 'Atingido'], ['atencao', 'Atenção'], ['desvio', 'Desvio']], q.status, 'Todos')}</select></label>
  </form>
  <div class="tabela-wrap"><table><thead><tr><th>Indicador</th><th>Departamento</th><th>Meta / range</th><th class="num">Último</th><th>Status</th><th class="num">Desvio</th><th>Tendência</th><th>Pendências</th></tr></thead><tbody>
  ${lista.map((i) => `<tr><td><a href="#/indicadores/${i.id}"><b>${esc(i.codigo ? i.codigo + ' · ' : '')}${esc(i.nome)}</b></a></td><td>${esc(i.departamento)}</td>
    <td class="muted">${esc(faixaTexto(i))}</td>
    <td class="num">${i.ultima_medicao ? fmt(i.ultima_medicao.valor) + ' <span class="muted">' + mesBR(i.ultima_medicao.periodo) + '</span>' : '—'}</td>
    <td>${selo(i.ultima_medicao?.status || 'sem_medicao')}</td><td class="num">${i.desvio_pct === null ? '—' : (i.desvio_pct > 0 ? '+' : '') + fmt(i.desvio_pct, 1) + '%'}</td>
    <td>${selo(i.tendencia)}</td>
    <td>${i.analises_pendentes ? selo('desvio', i.analises_pendentes + ' sem análise') : ''} ${i.planos_abertos ? selo('em_andamento', i.planos_abertos + ' plano(s)') : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="vazio">Nenhum indicador encontrado</td></tr>'}
  </tbody></table></div></div>`;
  $('#filtros').addEventListener('change', (e) => { location.hash = '#/indicadores?' + new URLSearchParams(Object.entries(dadosForm(e.currentTarget)).filter(([, v]) => v)); });
  $('#novo').onclick = () => abrirModal('Novo indicador', formIndicador(), async (d) => { const n = await api('/indicadores', { metodo: 'POST', corpo: d }); location.hash = '#/indicadores/' + n.id; toast('Indicador criado'); });
});

function renderAnalise(a) {
  const c = a.conteudo;
  let corpo = '';
  if (a.tecnica === '5w2h') corpo = `<dl>${W2H.map(([k, t]) => (c[k] ? `<dt>${t}</dt><dd>${esc(c[k])}</dd>` : '')).join('')}</dl>`;
  if (a.tecnica === '5porques') corpo = `<div><b>Problema:</b> ${esc(c.problema)}</div><ol class="porques">${c.porques.map((p) => `<li>Por quê? ${esc(p)}</li>`).join('')}</ol>`;
  if (a.tecnica === 'ishikawa') corpo = `<div><b>Efeito:</b> ${esc(c.problema)}</div><div class="ishikawa">${SEISM.map(([k, t]) => `<div><b>${t}</b>${c[k]?.length ? `<ul>${c[k].map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<div class="muted">—</div>'}</div>`).join('')}</div>`;
  return `<div class="analise"><div class="depto-topo" style="margin:0"><div>${selo('pendente', rot(a.tecnica))} <b>${mesBR(a.periodo)}</b> — valor ${fmt(a.valor)} <span class="muted">· ${esc(a.responsavel || '')} · ${dataBR(a.criado_em)}</span></div>
    <div class="linha-acoes"><button class="btn peq" data-plano-analise="${a.id}">+ Plano de ação</button><button class="btn peq perigo" data-del-analise="${a.id}">Excluir</button></div></div>
    ${corpo}${a.causa_raiz ? `<div class="causa"><b>Causa raiz:</b> ${esc(a.causa_raiz)}</div>` : ''}</div>`;
}

function formAnalise(med) {
  return `<form id="fAnalise"><p class="muted" style="margin-top:0">Período <b>${mesBR(med.periodo)}</b> · valor ${fmt(med.valor)} · meta ${fmt(med.meta)} · ${selo(med.status)}</p>
  <div class="campos"><label>Técnica *<select name="tecnica" id="tecnica">${opcoes([['5w2h', '5W2H — descrição estruturada do desvio'], ['5porques', '5 Porquês — causa raiz por aprofundamento'], ['ishikawa', 'Ishikawa / 6M — espinha de peixe']], '5w2h')}</select></label>
  <label>Responsável pela análise<input name="responsavel"></label></div>
  <div id="camposTecnica"></div>
  <div class="campos" style="margin-top:12px"><label class="largo">Causa raiz identificada<textarea name="causa_raiz" placeholder="Conclusão da análise (no 5 Porquês, se vazio, usa o último porquê)"></textarea></label></div>
  ${rodape('Registrar análise')}</form>`;
}
function camposTecnica(t) {
  if (t === '5w2h') return `<fieldset><legend>5W2H do desvio</legend><div class="campos">${W2H.map(([k, l]) => `<label class="${k === 'o_que' || k === 'por_que' ? 'largo' : ''}">${l}${k === 'o_que' || k === 'por_que' ? ' *' : ''}<input name="c_${k}"></label>`).join('')}</div></fieldset>`;
  if (t === '5porques') return `<fieldset><legend>5 Porquês</legend><div class="campos"><label class="largo">Problema *<input name="c_problema"></label>
    ${[1, 2, 3, 4, 5].map((n) => `<label class="largo">${n}º Por quê?<input name="c_porque_${n}"></label>`).join('')}</div></fieldset>`;
  return `<fieldset><legend>Diagrama de Ishikawa (6M)</legend><div class="campos"><label class="largo">Efeito / problema *<input name="c_problema"></label>
    ${SEISM.map(([k, l]) => `<label>${l}<textarea name="c_${k}" placeholder="Uma causa por linha"></textarea></label>`).join('')}</div></fieldset>`;
}
function montarConteudoAnalise(d) {
  const t = d.tecnica;
  if (t === '5w2h') return Object.fromEntries(W2H.map(([k]) => [k, d['c_' + k]]));
  if (t === '5porques') return { problema: d.c_problema, porques: [1, 2, 3, 4, 5].map((n) => d['c_porque_' + n]).filter((x) => x && x.trim()) };
  return { problema: d.c_problema, ...Object.fromEntries(SEISM.map(([k]) => [k, (d['c_' + k] || '').split('\n').map((s) => s.trim()).filter(Boolean)])) };
}

function linhaAcaoForm(n, a = {}) {
  return `<fieldset data-acao><legend>Ação ${n}</legend><div class="campos">
    <label class="largo">O quê? (What) *<input name="o_que" value="${esc(a.o_que)}" required></label>
    <label class="largo">Por quê? (Why)<input name="por_que" value="${esc(a.por_que)}"></label>
    <label>Onde? (Where)<input name="onde" value="${esc(a.onde)}"></label>
    <label>Quando? (prazo) *<input name="quando" type="date" value="${esc(a.quando)}" required></label>
    <label>Quem? (Who) *<input name="quem" value="${esc(a.quem)}" required></label>
    <label>Quanto? (R$)<input name="quanto" type="number" step="any" min="0" value="${esc(a.quanto)}"></label>
    <label class="largo">Como? (How)<input name="como" value="${esc(a.como)}"></label>
  </div></fieldset>`;
}
const lerAcoes = (form) => [...form.querySelectorAll('[data-acao]')].map((fs) => Object.fromEntries([...fs.querySelectorAll('[name]')].map((i) => [i.name, i.value])));

function abrirNovoPlano(indicadorId, analises, analiseId) {
  const corpo = abrirModal('Novo plano de ação (5W2H)', `<form id="fPlano"><div class="campos">
      <label class="largo">Título *<input name="titulo" required></label>
      <label>Análise de origem<select name="analise_id">${opcoes(analises.map((a) => [a.id, `${mesBR(a.periodo)} · ${rot(a.tecnica)}${a.causa_raiz ? ' · ' + a.causa_raiz.slice(0, 50) : ''}`]), analiseId, 'Sem análise vinculada')}</select></label>
      <label>Responsável pelo plano<input name="responsavel"></label>
      <label class="largo">Objetivo<input name="objetivo" placeholder="Ex.: retornar o indicador à meta até…"></label></div>
      <div id="acoes">${linhaAcaoForm(1)}</div>
      <button type="button" class="btn peq" id="maisAcao" style="margin-top:8px">+ Adicionar ação</button>
      ${rodape('Criar plano')}</form>`);
  const form = $('#fPlano', corpo);
  $('#maisAcao', corpo).onclick = () => $('#acoes', corpo).insertAdjacentHTML('beforeend', linhaAcaoForm(form.querySelectorAll('[data-acao]').length + 1));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(['titulo', 'analise_id', 'responsavel', 'objetivo'].map((k) => [k, form.elements[k].value]));
    try {
      const p = await api('/planos', { metodo: 'POST', corpo: { ...d, indicador_id: indicadorId, acoes: lerAcoes(form) } });
      fecharModal(); toast('Plano criado'); location.hash = '#/planos/' + p.id;
    } catch (err) { toast(err.message, true); }
  });
}

rota('/indicadores/:id', async (el, { id }) => {
  const [ind, meds, analises, planos] = await Promise.all([api('/indicadores/' + id), api(`/indicadores/${id}/medicoes`), api(`/indicadores/${id}/analises`), api('/planos?indicador_id=' + id)]);
  const proximo = (() => { const u = meds[meds.length - 1]?.periodo; if (!u) return new Date().toISOString().slice(0, 7); const [a, m] = u.split('-').map(Number); return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`; })();
  el.innerHTML = `<div class="trilha"><a href="#/indicadores">Indicadores</a> / ${esc(ind.departamento)}</div>
  <div class="cabecalho"><div><h1>${esc(ind.codigo ? ind.codigo + ' · ' : '')}${esc(ind.nome)}</h1><div class="muted">${esc(ind.descricao || '')}</div></div>
    <div class="acoes"><button class="btn" id="editar">Editar</button><button class="btn perigo" id="excluir">Excluir</button></div></div>
  <div class="grid g4" style="margin-bottom:16px">
    <div class="stat"><div class="rot">Meta / range</div><div style="font-weight:600;margin-top:4px">${esc(faixaTexto(ind))}</div></div>
    <div class="stat ${ind.ultima_medicao?.status === 'atingido' ? 'ok' : ind.ultima_medicao?.status === 'atencao' ? 'at' : ind.ultima_medicao ? 'er' : ''}"><div class="rot">Último valor ${ind.ultima_medicao ? '(' + mesBR(ind.ultima_medicao.periodo) + ')' : ''}</div><div class="val">${ind.ultima_medicao ? fmt(ind.ultima_medicao.valor) : '—'}</div></div>
    <div class="stat"><div class="rot">Tendência</div><div style="margin-top:6px">${selo(ind.tendencia)}</div></div>
    <div class="stat"><div class="rot">Ficha</div><div class="muted" style="font-size:13px">${rot(ind.polaridade)} · ${esc(ind.frequencia)}<br>${esc(ind.responsavel || 'sem responsável')}${ind.perspectiva ? ' · ' + rot(ind.perspectiva) : ''}</div></div>
  </div>
  <div class="card"><h2>Evolução</h2>${grafico(ind, meds)}</div>
  <div class="grid g2">
    <div class="card"><h2>Medições</h2>
      <form id="fMed" class="filtros"><label style="min-width:130px">Período<input type="month" name="periodo" value="${proximo}" required></label>
        <label style="min-width:110px">Valor<input type="number" step="any" name="valor" required></label>
        <label style="flex:1">Comentário<input name="comentario"></label><button class="btn pri">Registrar</button></form>
      <div class="tabela-wrap"><table><thead><tr><th>Período</th><th class="num">Valor</th><th class="num">Meta</th><th>Status</th><th></th></tr></thead><tbody>
      ${[...meds].reverse().map((m) => `<tr><td>${mesBR(m.periodo)}</td><td class="num">${fmt(m.valor)}</td><td class="num">${fmt(m.meta)}</td><td>${selo(m.status)}</td>
        <td class="linha-acoes">${m.status !== 'atingido' ? `<button class="btn peq ${m.analise_pendente ? 'pri' : ''}" data-analisar="${m.id}">${m.analise_pendente ? 'Analisar desvio' : 'Nova análise'}</button>` : ''}<button class="btn peq perigo" data-del-med="${m.id}" title="Excluir">✕</button></td></tr>`).join('') || '<tr><td colspan="5" class="vazio">Nenhuma medição</td></tr>'}
      </tbody></table></div></div>
    <div>
      <div class="card"><h2>Análises de desvio</h2>${analises.map(renderAnalise).join('') || '<div class="vazio">Nenhuma análise registrada</div>'}</div>
      <div class="card"><div class="depto-topo"><h2 style="margin:0">Planos de ação</h2><button class="btn peq" id="novoPlano">+ Novo plano</button></div>
        ${planos.map((p) => `<div class="alerta"><div style="flex:1"><a href="#/planos/${p.id}"><b>${esc(p.titulo)}</b></a><div class="muted" style="font-size:12px">${p.acoes.length} ações · prazo ${dataBR(p.prazo_final)} · ${moeda(p.custo_total)}</div>${barra(p.progresso, 100)}</div><div>${selo(p.status)} ${p.acoes_atrasadas ? selo('atrasada', p.acoes_atrasadas + ' atrasada(s)') : ''}</div></div>`).join('') || '<div class="vazio">Nenhum plano</div>'}</div>
    </div>
  </div>`;
  $('#editar').onclick = () => abrirModal('Editar indicador', formIndicador(ind), async (d) => { await api('/indicadores/' + id, { metodo: 'PUT', corpo: d }); toast('Indicador atualizado'); });
  $('#excluir').onclick = async () => { if (!confirm('Excluir o indicador e todo o histórico (medições, análises e planos)?')) return; await api('/indicadores/' + id, { metodo: 'DELETE' }); location.hash = '#/indicadores'; toast('Indicador excluído'); };
  $('#fMed').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api(`/indicadores/${id}/medicoes`, { metodo: 'POST', corpo: dadosForm(e.target) });
      await render();
      if (r.exige_analise) { toast('Desvio detectado — registre a análise de causa', true); abrirAnalise(r); } else toast(`Medição registrada: ${rot(r.status)}`);
    } catch (err) { toast(err.message, true); }
  });
  const abrirAnalise = (med) => {
    const corpo = abrirModal('Análise de desvio', formAnalise(med));
    const sel = $('#tecnica', corpo); const alvo = $('#camposTecnica', corpo);
    const trocar = () => { alvo.innerHTML = camposTecnica(sel.value); }; trocar(); sel.onchange = trocar;
    $('#fAnalise', corpo).addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = dadosForm(e.target);
      try {
        await api(`/indicadores/medicoes/${med.id}/analises`, { metodo: 'POST', corpo: { tecnica: d.tecnica, responsavel: d.responsavel, causa_raiz: d.causa_raiz, conteudo: montarConteudoAnalise(d) } });
        fecharModal(); toast('Análise registrada'); render();
      } catch (err) { toast(err.message, true); }
    });
  };
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    try {
      if (b.dataset.analisar) abrirAnalise(meds.find((m) => m.id === +b.dataset.analisar));
      if (b.dataset.delMed && confirm('Excluir esta medição?')) { await api('/indicadores/medicoes/' + b.dataset.delMed, { metodo: 'DELETE' }); render(); }
      if (b.dataset.delAnalise && confirm('Excluir esta análise?')) { await api('/indicadores/analises/' + b.dataset.delAnalise, { metodo: 'DELETE' }); render(); }
      if (b.dataset.planoAnalise) abrirNovoPlano(+id, analises, b.dataset.planoAnalise);
      if (b.id === 'novoPlano') abrirNovoPlano(+id, analises);
    } catch (err) { toast(err.message, true); }
  });
});

// ============ PLANOS DE AÇÃO ============
rota('/planos', async (el, _, q) => {
  const planos = await api('/planos?' + new URLSearchParams(Object.entries(q).filter(([, v]) => v)));
  el.innerHTML = `<div class="cabecalho"><h1>Planos de ação</h1></div>
  <div class="card"><form class="filtros" id="filtros">
    <label>Departamento<select name="departamento_id">${deptoOpcoes(q.departamento_id, 'Todos')}</select></label>
    <label>Status<select name="status">${opcoes(['aberto', 'em_andamento', 'concluido', 'cancelado'].map((s) => [s, rot(s)]), q.status, 'Todos')}</select></label>
    <label>Prazo<select name="atrasados">${opcoes([['1', 'Somente com atraso']], q.atrasados, 'Todos')}</select></label></form>
  <div class="tabela-wrap"><table><thead><tr><th>Plano</th><th>Indicador</th><th>Responsável</th><th>Progresso</th><th>Prazo final</th><th class="num">Custo</th><th>Status</th><th>Eficácia</th></tr></thead><tbody>
  ${planos.map((p) => `<tr><td><a href="#/planos/${p.id}"><b>${esc(p.titulo)}</b></a>${p.acoes_atrasadas ? ' ' + selo('atrasada', p.acoes_atrasadas + ' atrasada(s)') : ''}</td>
    <td><a href="#/indicadores/${p.indicador_id}">${esc(p.indicador)}</a><div class="muted" style="font-size:12px">${esc(p.departamento)}</div></td>
    <td>${esc(p.responsavel || '—')}</td><td style="min-width:150px">${barra(p.progresso, 100)}</td><td>${dataBR(p.prazo_final)}</td><td class="num">${moeda(p.custo_total)}</td>
    <td>${selo(p.status)}</td><td>${p.status === 'concluido' ? selo(p.eficacia) : '—'}</td></tr>`).join('') || '<tr><td colspan="8" class="vazio">Nenhum plano encontrado</td></tr>'}
  </tbody></table></div></div>`;
  $('#filtros').addEventListener('change', (e) => { location.hash = '#/planos?' + new URLSearchParams(Object.entries(dadosForm(e.currentTarget)).filter(([, v]) => v)); });
});

rota('/planos/:id', async (el, { id }) => {
  const p = await api('/planos/' + id);
  const encerrado = ['concluido', 'cancelado'].includes(p.status);
  el.innerHTML = `<div class="trilha"><a href="#/planos">Planos de ação</a> / <a href="#/indicadores/${p.indicador_id}">${esc(p.indicador)}</a></div>
  <div class="cabecalho"><div><h1>${esc(p.titulo)}</h1><div class="muted">${esc(p.objetivo || '')}</div></div>
    <div class="acoes">${!encerrado ? '<button class="btn pri" id="concluir">Concluir plano</button><button class="btn" id="cancelar">Cancelar plano</button>' : ''}
    ${p.status === 'concluido' ? '<button class="btn pri" id="eficacia">Verificar eficácia</button>' : ''}${encerrado ? '<button class="btn" id="reabrir">Reabrir</button>' : ''}
    <button class="btn perigo" id="excluir">Excluir</button></div></div>
  <div class="grid g4" style="margin-bottom:16px">
    <div class="stat"><div class="rot">Status</div><div style="margin-top:6px">${selo(p.status)}</div></div>
    <div class="stat"><div class="rot">Progresso</div><div class="val">${p.progresso}%</div></div>
    <div class="stat ${p.acoes_atrasadas ? 'er' : ''}"><div class="rot">Ações atrasadas</div><div class="val">${p.acoes_atrasadas}</div></div>
    <div class="stat"><div class="rot">Custo previsto</div><div class="val" style="font-size:20px">${moeda(p.custo_total)}</div></div>
  </div>
  ${p.status === 'concluido' ? `<div class="card"><h2>Verificação de eficácia</h2>${selo(p.eficacia)} ${p.verificacao_data ? 'em ' + dataBR(p.verificacao_data) : ''}<p>${esc(p.verificacao_obs || (p.eficacia === 'pendente' ? 'Acompanhe o indicador nos próximos períodos e registre se o plano eliminou a causa do desvio.' : ''))}</p></div>` : ''}
  <div class="card"><div class="depto-topo"><h2 style="margin:0">Ações (5W2H)</h2>${!encerrado ? '<button class="btn peq" id="novaAcao">+ Nova ação</button>' : ''}</div>
  <div class="tabela-wrap"><table><thead><tr><th>O quê</th><th>Por quê</th><th>Onde</th><th>Quando</th><th>Quem</th><th>Como</th><th class="num">Quanto</th><th>Status</th><th></th></tr></thead><tbody>
  ${p.acoes.map((a) => `<tr><td><b>${esc(a.o_que)}</b></td><td>${esc(a.por_que || '—')}</td><td>${esc(a.onde || '—')}</td><td>${dataBR(a.quando)} ${a.atrasada ? selo('atrasada', 'atrasada') : ''}</td><td>${esc(a.quem)}</td><td>${esc(a.como || '—')}</td><td class="num">${a.quanto ? moeda(a.quanto) : '—'}</td>
    <td><select data-status-acao="${a.id}" ${p.status === 'cancelado' ? 'disabled' : ''} style="min-width:130px">${opcoes(['pendente', 'em_andamento', 'concluida', 'cancelada'].map((s) => [s, rot(s)]), a.status)}</select>${a.concluida_em ? `<div class="muted" style="font-size:12px">em ${dataBR(a.concluida_em)}</div>` : ''}</td>
    <td class="linha-acoes"><button class="btn peq" data-edit-acao="${a.id}">Editar</button><button class="btn peq perigo" data-del-acao="${a.id}">✕</button></td></tr>`).join('') || '<tr><td colspan="9" class="vazio">Nenhuma ação cadastrada</td></tr>'}
  </tbody></table></div></div>`;
  const atualizar = (corpo) => api('/planos/' + id, { metodo: 'PUT', corpo }).then(() => render()).catch((e) => toast(e.message, true));
  $('#concluir') && ($('#concluir').onclick = () => atualizar({ status: 'concluido' }));
  $('#cancelar') && ($('#cancelar').onclick = () => confirm('Cancelar o plano?') && atualizar({ status: 'cancelado' }));
  $('#reabrir') && ($('#reabrir').onclick = () => atualizar({ status: 'em_andamento', eficacia: 'pendente' }));
  $('#excluir').onclick = async () => { if (!confirm('Excluir o plano e suas ações?')) return; await api('/planos/' + id, { metodo: 'DELETE' }); location.hash = '#/planos'; };
  $('#eficacia') && ($('#eficacia').onclick = () => abrirModal('Verificação de eficácia', `<form><div class="campos">
    <label>Resultado *<select name="eficacia">${opcoes([['eficaz', 'Eficaz — causa eliminada'], ['nao_eficaz', 'Não eficaz — requer nova análise'], ['pendente', 'Pendente']], p.eficacia)}</select></label>
    <label>Data da verificação<input type="date" name="verificacao_data" value="${new Date().toISOString().slice(0, 10)}"></label>
    <label class="largo">Evidências / observações<textarea name="verificacao_obs">${esc(p.verificacao_obs)}</textarea></label></div>${rodape()}</form>`,
  (d) => api('/planos/' + id, { metodo: 'PUT', corpo: d })));
  $('#novaAcao') && ($('#novaAcao').onclick = () => abrirModal('Nova ação', `<form>${linhaAcaoForm('')}${rodape('Adicionar')}</form>`, (d) => api(`/planos/${id}/acoes`, { metodo: 'POST', corpo: d })));
  el.addEventListener('change', async (e) => {
    const s = e.target.dataset.statusAcao;
    if (s) { try { await api('/planos/acoes/' + s, { metodo: 'PUT', corpo: { status: e.target.value } }); render(); } catch (err) { toast(err.message, true); render(); } }
  });
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.delAcao && confirm('Excluir a ação?')) { await api('/planos/acoes/' + b.dataset.delAcao, { metodo: 'DELETE' }); render(); }
    if (b.dataset.editAcao) {
      const a = p.acoes.find((x) => x.id === +b.dataset.editAcao);
      abrirModal('Editar ação', `<form>${linhaAcaoForm('', a)}${rodape()}</form>`, (d) => api('/planos/acoes/' + a.id, { metodo: 'PUT', corpo: d }));
    }
  });
});

// ============ METAS BONIFICÁVEIS ============
function formMeta(m, ciclo, inds) {
  return `<form id="fMeta"><div class="campos">
    <label class="largo">Nome da meta *<input name="nome" required value="${esc(m.nome)}"></label>
    <label>Departamento *<select name="departamento_id" required>${deptoOpcoes(m.departamento_id, 'Selecione…')}</select></label>
    <label>Responsável<input name="responsavel" value="${esc(m.responsavel)}"></label>
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
  </div><p class="dica">Curva de pagamento: abaixo do gatilho = 0%; no gatilho = % pago no gatilho; no alvo = 100%; na superação = % de superação (teto). Valores intermediários são interpolados linearmente. Ciclo: ${mesBR(ciclo.inicio)} a ${mesBR(ciclo.fim)}.</p>
  ${rodape()}</form>`;
}

rota('/metas', async (el, _, q) => {
  const ciclos = await api('/metas/ciclos');
  const novoCiclo = (c = {}) => abrirModal(c.id ? 'Editar ciclo' : 'Novo ciclo de metas', `<form><div class="campos">
      <label class="largo">Nome *<input name="nome" required value="${esc(c.nome)}" placeholder="Ex.: PLR ${new Date().getFullYear()}"></label>
      <label>Início *<input type="month" name="inicio" required value="${esc(c.inicio)}"></label><label>Fim *<input type="month" name="fim" required value="${esc(c.fim)}"></label>
      <label>Status<select name="status">${opcoes([['planejamento', 'Planejamento'], ['ativo', 'Ativo']], c.status)}</select></label>
      <label>Nota mínima p/ bônus (%)<input type="number" step="any" min="0" max="100" name="nota_minima" value="${esc(c.nota_minima ?? 0)}"></label></div>
      <p class="dica">Departamentos com nota abaixo da nota mínima não recebem bônus no ciclo.</p>${rodape()}</form>`,
  async (d) => { const r = await api('/metas/ciclos' + (c.id ? '/' + c.id : ''), { metodo: c.id ? 'PUT' : 'POST', corpo: d }); location.hash = '#/metas?ciclo=' + r.id; });
  if (!ciclos.length) {
    el.innerHTML = '<div class="cabecalho"><h1>Metas bonificáveis</h1></div><div class="card vazio">Nenhum ciclo cadastrado.<br><br><button class="btn pri" id="nc">+ Criar primeiro ciclo</button></div>';
    $('#nc').onclick = () => novoCiclo();
    return;
  }
  const cid = q.ciclo || (ciclos.find((c) => c.status === 'ativo') || ciclos[0]).id;
  const [ap, inds] = await Promise.all([api(`/metas/ciclos/${cid}/apuracao`), temModulo('indicadores') ? api('/metas/indicadores-disponiveis') : null]);
  const c = ap.ciclo; const fechado = c.status === 'encerrado';
  el.innerHTML = `<div class="cabecalho"><div><h1>Metas bonificáveis</h1></div>
    <div class="acoes"><select id="selCiclo" style="width:auto">${opcoes(ciclos.map((x) => [x.id, `${x.nome} (${rot(x.status)})`]), cid)}</select>
    <button class="btn" id="novoCiclo">+ Ciclo</button>${!fechado ? '<button class="btn" id="editCiclo">Editar ciclo</button><button class="btn pri" id="novaMeta">+ Nova meta</button>' : ''}
    <a class="btn" href="/api/metas/ciclos/${cid}/exportar.csv">Exportar CSV</a>${!fechado ? '<button class="btn" id="encerrar">Encerrar ciclo</button>' : ''}</div></div>
  <div class="grid g4" style="margin-bottom:16px">
    <div class="stat"><div class="rot">Ciclo</div><div style="font-weight:600;margin-top:4px">${mesBR(c.inicio)} a ${mesBR(c.fim)} ${selo(c.status)}</div><div class="muted" style="font-size:12px">Nota mínima: ${pct(c.nota_minima)}${ap.congelado ? ' · resultados congelados' : ''}</div></div>
    <div class="stat"><div class="rot">Nota média</div><div class="val">${pct(ap.totais.nota_media)}</div></div>
    <div class="stat"><div class="rot">Bônus-alvo total</div><div class="val" style="font-size:20px">${moeda(ap.totais.valor_base)}</div></div>
    <div class="stat ok"><div class="rot">Bônus apurado (${pct(ap.totais.pct_pago)})</div><div class="val" style="font-size:20px">${moeda(ap.totais.bonus)}</div></div>
  </div>
  ${ap.departamentos.map((d) => {
    const editavel = !fechado && d.status_apuracao === 'aberto';
    return `<div class="card"><div class="depto-topo"><div><h2 style="margin:0">${esc(d.departamento)} ${selo(d.status_apuracao)}</h2>
      <div class="muted" style="font-size:13px">Pesos: ${fmt(d.peso_total)}% ${d.pesos_validos ? '' : selo('desvio', 'soma ≠ 100%')} · Bônus-alvo ${moeda(d.valor_base)} ${d.aprovado_por ? '· aprovado por ' + esc(d.aprovado_por) + ' em ' + dataBR(d.aprovado_em) : ''}</div></div>
      <div style="text-align:right"><div class="nota-grande" style="color:${d.elegivel ? 'var(--ok)' : 'var(--er)'}">${pct(d.nota)}</div><div><b>${moeda(d.bonus)}</b> ${d.elegivel ? '' : selo('desvio', 'abaixo da nota mínima')}</div></div></div>
    <div class="tabela-wrap"><table><thead><tr><th>Meta</th><th class="num">Peso</th><th class="num">Gatilho</th><th class="num">Alvo</th><th class="num">Superação</th><th class="num">Resultado</th><th>Atingimento</th><th class="num">Contrib.</th><th></th></tr></thead><tbody>
    ${d.metas.map((m) => `<tr><td><b>${esc(m.nome)}</b><div class="muted" style="font-size:12px">${m.fonte === 'indicador' ? '🔗 indicador · ' : '✎ manual · '}${rot(m.agregacao)} · ${rot(m.polaridade)}${m.unidade ? ' · ' + esc(m.unidade) : ''}</div>
      ${m.projecao ? `<div class="muted" style="font-size:12px">Projeção fim do ciclo: ${fmt(m.projecao.valor)} → ${pct(m.projecao.atingimento)}</div>` : ''}</td>
      <td class="num">${fmt(m.peso)}%</td><td class="num">${fmt(m.gatilho)}</td><td class="num">${fmt(m.alvo)}</td><td class="num">${fmt(m.superacao)}</td><td class="num">${fmt(m.valor_apurado)}</td>
      <td style="min-width:170px">${barra(m.atingimento)}<div style="margin-top:2px">${selo(m.faixa)}</div></td><td class="num">${fmt(m.contribuicao)}</td>
      <td class="linha-acoes">${editavel ? `${m.fonte === 'manual' ? `<button class="btn peq" data-resultado="${m.id}">Resultado</button>` : ''}<button class="btn peq" data-edit-meta="${m.id}">Editar</button><button class="btn peq perigo" data-del-meta="${m.id}">✕</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="vazio">Sem metas</td></tr>'}
    </tbody></table></div>
    ${!fechado ? `<div class="linha-acoes" style="margin-top:10px">${editavel ? `<button class="btn peq" data-bonus="${d.departamento_id}">Definir bônus-alvo</button><button class="btn peq pri" data-trans="submeter" data-depto="${d.departamento_id}">Submeter apuração</button>` : ''}
      <button class="btn peq" data-simular="${d.departamento_id}">Simular</button>
      ${d.status_apuracao === 'submetido' ? `<button class="btn peq pri" data-trans="aprovar" data-depto="${d.departamento_id}">Aprovar</button>` : ''}
      ${d.status_apuracao !== 'aberto' ? `<button class="btn peq" data-trans="reabrir" data-depto="${d.departamento_id}">Reabrir</button>` : ''}</div>` : ''}
    </div>`;
  }).join('') || '<div class="card vazio">Nenhuma meta neste ciclo. Clique em "+ Nova meta".</div>'}`;

  const todasMetas = ap.departamentos.flatMap((d) => d.metas);
  $('#selCiclo').onchange = (e) => { location.hash = '#/metas?ciclo=' + e.target.value; };
  $('#novoCiclo').onclick = () => novoCiclo();
  $('#editCiclo') && ($('#editCiclo').onclick = () => api('/metas/ciclos/' + cid).then(novoCiclo));
  const abrirMeta = (m = {}) => {
    const corpo = abrirModal(m.id ? 'Editar meta' : 'Nova meta bonificável', formMeta(m, c, inds), (d) => api('/metas' + (m.id ? '/' + m.id : ''), { metodo: m.id ? 'PUT' : 'POST', corpo: { ...d, ciclo_id: cid } }));
    const sync = () => { $('#lblInd', corpo).style.display = $('#fonte', corpo).value === 'indicador' ? '' : 'none'; };
    $('#fonte', corpo).onchange = sync; sync();
  };
  $('#novaMeta') && ($('#novaMeta').onclick = () => abrirMeta());
  $('#encerrar') && ($('#encerrar').onclick = async () => {
    if (!confirm('Encerrar o ciclo? Os resultados serão congelados e não poderão mais ser alterados.')) return;
    try { await api(`/metas/ciclos/${cid}/encerrar`, { metodo: 'POST' }); toast('Ciclo encerrado'); render(); } catch (err) { toast(err.message, true); }
  });
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    try {
      if (b.dataset.editMeta) abrirMeta(todasMetas.find((m) => m.id === +b.dataset.editMeta));
      if (b.dataset.delMeta && confirm('Excluir a meta?')) { await api('/metas/' + b.dataset.delMeta, { metodo: 'DELETE' }); render(); }
      if (b.dataset.resultado) {
        const m = todasMetas.find((x) => x.id === +b.dataset.resultado);
        abrirModal(`Resultados — ${m.nome}`, `<div class="tabela-wrap" style="margin-bottom:12px"><table><thead><tr><th>Período</th><th class="num">Valor</th><th>Observação</th></tr></thead><tbody>
          ${m.resultados.map((r) => `<tr><td>${mesBR(r.periodo)}</td><td class="num">${fmt(r.valor)}</td><td>${esc(r.observacao || '')}</td></tr>`).join('') || '<tr><td colspan="3" class="vazio">Sem lançamentos</td></tr>'}</tbody></table></div>
          <form><div class="campos"><label>Período *<input type="month" name="periodo" required min="${c.inicio}" max="${c.fim}"></label><label>Valor *<input type="number" step="any" name="valor" required></label>
          <label class="largo">Observação / evidência<input name="observacao"></label></div><p class="dica">Agregação: ${rot(m.agregacao)}. Lançar no mesmo período substitui o valor.</p>${rodape('Lançar')}</form>`,
        (d) => api(`/metas/${m.id}/resultados`, { metodo: 'POST', corpo: d }));
      }
      if (b.dataset.bonus) {
        const d = ap.departamentos.find((x) => x.departamento_id === +b.dataset.bonus);
        abrirModal(`Bônus-alvo — ${d.departamento}`, `<form><div class="campos"><label>Valor do bônus a 100% de nota (R$) *<input type="number" step="any" min="0" name="valor_base" required value="${d.valor_base}"></label></div>
          <p class="dica">Bônus apurado = bônus-alvo × nota do departamento (se nota ≥ nota mínima do ciclo).</p>${rodape()}</form>`,
        (x) => api(`/metas/ciclos/${cid}/departamentos/${d.departamento_id}/bonus`, { metodo: 'PUT', corpo: x }));
      }
      if (b.dataset.trans) {
        const usuario = b.dataset.trans === 'aprovar' ? prompt('Nome do aprovador:') : null;
        if (b.dataset.trans === 'aprovar' && !usuario) return;
        await api(`/metas/ciclos/${cid}/departamentos/${b.dataset.depto}/${b.dataset.trans}`, { metodo: 'POST', corpo: { usuario } });
        toast('Apuração atualizada'); render();
      }
      if (b.dataset.simular) {
        const d = ap.departamentos.find((x) => x.departamento_id === +b.dataset.simular);
        const corpo = abrirModal(`Simulação "e se" — ${d.departamento}`, `<form id="fSim"><p class="muted" style="margin-top:0">Altere os resultados para ver o impacto na nota e no bônus. Nada é gravado.</p>
          <div class="tabela-wrap"><table><thead><tr><th>Meta</th><th class="num">Peso</th><th>Resultado simulado</th><th class="num">Atingimento</th></tr></thead><tbody>
          ${d.metas.map((m) => `<tr><td>${esc(m.nome)}</td><td class="num">${fmt(m.peso)}%</td><td><input type="number" step="any" name="${m.id}" value="${m.valor_apurado ?? ''}"></td><td class="num" data-at="${m.id}">${pct(m.atingimento)}</td></tr>`).join('')}
          </tbody></table></div><div class="resumo-meta" style="margin-top:12px"><div>Nota simulada<b id="simNota">${pct(d.nota)}</b></div><div>Bônus simulado<b id="simBonus">${moeda(d.bonus)}</b></div></div>
          <div class="rodape-form"><button type="button" class="btn" data-fechar>Fechar</button></div></form>`);
        $('#fSim', corpo).addEventListener('submit', (ev) => ev.preventDefault());
        $('#fSim', corpo).addEventListener('input', async (ev) => {
          const r = await api(`/metas/ciclos/${cid}/departamentos/${d.departamento_id}/simular`, { metodo: 'POST', corpo: { valores: dadosForm(ev.currentTarget) } });
          r.metas.forEach((m) => { const td = corpo.querySelector(`[data-at="${m.id}"]`); if (td) td.textContent = pct(m.atingimento); });
          $('#simNota', corpo).textContent = pct(r.nota); $('#simBonus', corpo).textContent = moeda(r.bonus) + (r.elegivel ? '' : ' (abaixo da nota mínima)');
        });
      }
    } catch (err) { toast(err.message, true); }
  });
});

// ============ DEPARTAMENTOS ============
rota('/departamentos', async (el) => {
  const lista = await api('/departamentos?todos=1');
  el.innerHTML = `<div class="cabecalho"><h1>Departamentos</h1><button class="btn pri" id="novo">+ Novo departamento</button></div>
  <div class="card"><div class="tabela-wrap"><table><thead><tr><th>Nome</th><th>Sigla</th><th>Gestor</th><th>Situação</th><th></th></tr></thead><tbody>
  ${lista.map((d) => `<tr><td><b>${esc(d.nome)}</b></td><td>${esc(d.sigla || '—')}</td><td>${esc(d.gestor || '—')}</td><td>${d.ativo ? selo('atingido', 'Ativo') : selo('cancelado', 'Inativo')}</td><td><button class="btn peq" data-edit="${d.id}">Editar</button></td></tr>`).join('') || '<tr><td colspan="5" class="vazio">Nenhum departamento</td></tr>'}
  </tbody></table></div></div>`;
  const form = (d = {}) => abrirModal(d.id ? 'Editar departamento' : 'Novo departamento', `<form><div class="campos">
    <label class="largo">Nome *<input name="nome" required value="${esc(d.nome)}"></label><label>Sigla<input name="sigla" value="${esc(d.sigla)}"></label>
    <label>Gestor<input name="gestor" value="${esc(d.gestor)}"></label><label style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" name="ativo" style="width:auto" ${d.ativo === 0 ? '' : 'checked'}> Ativo</label></div>${rodape()}</form>`,
  async (x) => { await api('/departamentos' + (d.id ? '/' + d.id : ''), { metodo: d.id ? 'PUT' : 'POST', corpo: x }); await carregarDepartamentos(); });
  $('#novo').onclick = () => form();
  el.onclick = (e) => { const id = e.target.dataset?.edit; if (id) form(lista.find((d) => d.id === +id)); };
});

// ============ AUDITORIA ============
rota('/auditoria', async (el, _, q) => {
  const lista = await api('/auditoria?' + new URLSearchParams(Object.entries({ limite: 200, ...q }).filter(([, v]) => v)));
  el.innerHTML = `<div class="cabecalho"><h1>Trilha de auditoria</h1></div><div class="card">
  <form class="filtros" id="filtros"><label>Módulo<select name="modulo">${opcoes([['core', 'Núcleo'], ['indicadores', 'Indicadores'], ['metas', 'Metas']], q.modulo, 'Todos')}</select></label></form>
  <div class="tabela-wrap"><table><thead><tr><th>Data/hora (UTC)</th><th>Módulo</th><th>Entidade</th><th>Ação</th><th>Detalhes</th></tr></thead><tbody>
  ${lista.map((a) => `<tr><td style="white-space:nowrap">${esc(a.criado_em)}</td><td>${esc(a.modulo)}</td><td>${esc(a.entidade)} #${a.entidade_id ?? ''}</td><td>${selo('pendente', a.acao)}</td><td class="muted" style="font-size:12px;max-width:480px;overflow-wrap:anywhere">${esc(a.dados ? JSON.stringify(a.dados) : '')}</td></tr>`).join('') || '<tr><td colspan="5" class="vazio">Sem registros</td></tr>'}
  </tbody></table></div></div>`;
  $('#filtros').addEventListener('change', (e) => { location.hash = '#/auditoria?' + new URLSearchParams(Object.entries(dadosForm(e.currentTarget)).filter(([, v]) => v)); });
});

// ============ Inicialização ============
async function carregarDepartamentos() { estado.departamentos = await api('/departamentos'); }

(function tema() {
  let t = null; try { t = localStorage.getItem('tema'); } catch { /* sem storage */ }
  if (t) document.documentElement.dataset.theme = t;
  $('#temaBtn').onclick = () => {
    const escuro = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = escuro ? 'light' : 'dark';
    try { localStorage.setItem('tema', document.documentElement.dataset.theme); } catch { /* ignora */ }
  };
}());
$('#menuBtn').onclick = () => $('#nav').classList.toggle('aberto');

(async function iniciar() {
  try {
    [estado.modulos] = await Promise.all([api('/modulos'), carregarDepartamentos()]);
    montarNav();
    window.addEventListener('hashchange', render);
    render();
  } catch (err) { $('#app').innerHTML = `<div class="card vazio">Não foi possível conectar à API: ${esc(err.message)}</div>`; }
}());
