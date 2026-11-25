'use strict';
/* Base da SPA: utilitários, API, modal, roteador, permissões e gráficos. Sem dependências. */

// ============ Utilidades ============
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v, casas = 2) => (v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: casas }));
const moeda = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (s) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '—');
const dataHoraBR = (s) => (s ? new Date(s.replace(' ', 'T') + (s.includes('Z') || s.includes('+') ? '' : 'Z')).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const mesBR = (p) => { if (!p) return '—'; const [a, m] = p.split('-'); return `${['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][+m - 1]}/${a.slice(2)}`; };
const pct = (v) => (v === null || v === undefined ? '—' : `${fmt(v, 1)}%`);
const hojeISO = () => new Date().toISOString().slice(0, 10);
const tamanho = (b) => (b > 1048576 ? `${fmt(b / 1048576, 1)} MB` : `${fmt(b / 1024, 0)} KB`);

const ROTULOS = {
  atingido: 'Atingido', atencao: 'Atenção', desvio: 'Desvio', sem_medicao: 'Sem medição',
  maior_melhor: 'Maior é melhor', menor_melhor: 'Menor é melhor', faixa: 'Dentro da faixa',
  aberto: 'Aberto', em_andamento: 'Em andamento', concluido: 'Concluído', cancelado: 'Cancelado',
  pendente: 'Pendente', concluida: 'Concluída', cancelada: 'Cancelada', aplicada: 'Aplicada', aprovada: 'Aprovada', rejeitada: 'Rejeitada',
  eficaz: 'Eficaz', nao_eficaz: 'Não eficaz',
  '5w2h': '5W2H', '5porques': '5 Porquês', ishikawa: 'Ishikawa (6M)', pareto: 'Pareto', a3: 'Relatório A3', arvore: 'Árvore de falhas',
  planejamento: 'Planejamento', ativo: 'Ativo', encerrado: 'Encerrado',
  submetido: 'Submetido', aprovado: 'Aprovado', agendada: 'Agendada', realizada: 'Realizada',
  sem_resultado: 'Sem resultado', abaixo_gatilho: 'Abaixo do gatilho', parcial: 'Parcial', atingida: 'Atingida', superada: 'Superada',
  melhorando: '↗ Melhorando', piorando: '↘ Piorando', estavel: '→ Estável', variando: '↕ Variando', indefinida: '—',
  manual: 'Manual', calculado: 'Calculado', indicador: 'Indicador', soma: 'Soma', media: 'Média', ultimo: 'Último valor',
  financeira: 'Financeira', clientes: 'Clientes', processos: 'Processos internos', aprendizado: 'Aprendizado e crescimento',
  admin: 'Administrador', diretoria: 'Diretoria', gestor: 'Gestor', colaborador: 'Colaborador',
  empresa: 'Empresa', departamento: 'Departamento',
  P: 'P · Planejar', D: 'D · Executar', C: 'C · Verificar', A: 'A · Agir',
  contencao: 'Contenção', corretiva: 'Corretiva', preventiva: 'Preventiva', alta: 'Alta', media_c: 'Média', baixa: 'Baixa',
};
const rot = (k) => ROTULOS[k] || k || '—';
const selo = (k, texto) => `<span class="selo ${esc(k)}">${esc(texto || rot(k))}</span>`;
const opcoes = (lista, sel, vazio) => (vazio !== undefined ? `<option value="">${esc(vazio)}</option>` : '')
  + lista.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(sel ?? '') ? 'selected' : ''}>${esc(t)}</option>`).join('');
const SEISM = [['metodo', 'Método'], ['maquina', 'Máquina'], ['material', 'Material'], ['mao_de_obra', 'Mão de obra'], ['medicao', 'Medição'], ['meio_ambiente', 'Meio ambiente']];
const W2H = [['o_que', 'O quê? (What)'], ['por_que', 'Por quê? (Why)'], ['onde', 'Onde? (Where)'], ['quando', 'Quando? (When)'], ['quem', 'Quem? (Who)'], ['como', 'Como? (How)'], ['quanto', 'Quanto? (How much)']];
const A3 = [['contexto', 'Contexto / histórico'], ['situacao_atual', 'Situação atual'], ['objetivo', 'Objetivo'], ['analise_causa', 'Análise de causa'], ['contramedidas', 'Contramedidas'], ['plano_implementacao', 'Plano de implementação'], ['acompanhamento', 'Acompanhamento']];
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();

// ============ API ============
async function api(url, { metodo = 'GET', corpo, bruto } = {}) {
  const headers = { 'X-Requested-With': 'kpi' };
  let body;
  if (bruto) { body = bruto; headers['Content-Type'] = 'application/octet-stream'; } else if (corpo !== undefined) { body = JSON.stringify(corpo); headers['Content-Type'] = 'application/json'; }
  const r = await fetch('/api' + url, { method: metodo, headers, body, credentials: 'same-origin' });
  if (r.status === 401 && !url.startsWith('/auth/')) { estado.usuario = null; irPara('#/login'); throw new Error('Sessão expirada. Entre novamente.'); }
  if (r.status === 204) return null;
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(dados.erro || `Erro ${r.status}`);
  return dados;
}
const enviarArquivo = (url, arquivo, extra = {}) => api(`${url}${url.includes('?') ? '&' : '?'}${qs({ nome: arquivo.name, ...extra })}`, { metodo: 'POST', bruto: arquivo });

function toast(msg, erro = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast' + (erro ? ' erro' : ''); t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, erro ? 5000 : 2500);
}
const tentar = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, true); return undefined; } };

function dadosForm(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; } else o[el.name] = el.value;
  }
  return o;
}

// ============ Modal ============
function abrirModal(titulo, html, aoEnviar, { largo = false } = {}) {
  $('#modalTitulo').textContent = titulo;
  $('#modalCorpo').innerHTML = html;
  $('.modal-caixa').classList.toggle('largo', largo);
  $('#modal').hidden = false;
  modalAlterado = false;
  const form = $('#modalCorpo form');
  if (form && aoEnviar) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('[type=submit]');
      if (btn) btn.disabled = true;
      try { const r = await aoEnviar(dadosForm(form), form); if (r !== false) { fecharModal(); render(); } } catch (err) { toast(err.message, true); } finally { if (btn) btn.disabled = false; }
    });
    setTimeout(() => form.querySelector('input:not([type=hidden]),select,textarea')?.focus(), 30);
  }
  return $('#modalCorpo');
}
function fecharModal() { $('#modal').hidden = true; $('#modalCorpo').innerHTML = ''; modalAlterado = false; }
// O modal só fecha pelo ✕, pelo botão Cancelar ou pela tecla Esc — clicar fora não fecha,
// para não perder o que foi digitado. Com dados digitados, o Esc pede confirmação.
let modalAlterado = false;
document.addEventListener('input', (e) => { if (e.target.closest('#modalCorpo')) modalAlterado = true; });
document.addEventListener('click', (e) => { if (e.target.closest('[data-fechar]')) fecharModal(); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || $('#modal').hidden) return;
  if (!modalAlterado || confirmar('Descartar as informações digitadas?')) fecharModal();
});
const rodape = (txt = 'Salvar') => `<div class="rodape-form"><button type="button" class="btn" data-fechar>Cancelar</button><button type="submit" class="btn pri">${txt}</button></div>`;
const confirmar = (msg) => window.confirm(msg);

// ============ Estado e permissões ============
const estado = { usuario: null, modulos: [], departamentos: [], diretorio: [], sso: null };
const temModulo = (n) => estado.modulos.some((m) => m.nome === n);
const perfil = () => estado.usuario?.perfil;
const ehAdmin = () => perfil() === 'admin';
const ehDiretoria = () => ['admin', 'diretoria'].includes(perfil());
const podeEditarDepto = (id) => ehDiretoria() || (perfil() === 'gestor' && (estado.usuario.departamentos_visiveis || []).includes(Number(id)));
const ehGestorOuMais = () => ehDiretoria() || perfil() === 'gestor';
const deptoOpcoes = (sel, vazio) => opcoes(estado.departamentos.map((d) => [d.id, d.nome]), sel, vazio);
const deptoOpcoesEditaveis = (sel, vazio) => opcoes(estado.departamentos.filter((d) => podeEditarDepto(d.id)).map((d) => [d.id, d.nome]), sel, vazio);

// ============ Roteador ============
const rotas = [];
const rota = (padrao, fn, { publica = false } = {}) => rotas.push([new RegExp('^' + padrao.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn, publica]);
const irPara = (h) => { if (location.hash !== h) location.hash = h; else render(); };

async function render() {
  const hash = location.hash.slice(1) || '/';
  const [caminho, q] = hash.split('?');
  const params = Object.fromEntries(new URLSearchParams(q || ''));
  // Substitui o contêiner para descartar listeners da tela anterior
  const antigo = $('#app'); const el = antigo.cloneNode(false); antigo.replaceWith(el);
  document.body.classList.toggle('sem-sessao', !estado.usuario);
  for (const a of $$('#nav a')) {
    const alvo = a.getAttribute('href').slice(1);
    a.classList.toggle('ativo', alvo === '/' ? caminho === '/' : caminho === alvo || caminho.startsWith(alvo + '/'));
  }
  $('#nav').classList.remove('aberto');
  for (const [re, fn, publica] of rotas) {
    const m = caminho.match(re);
    if (!m) continue;
    if (!publica && !estado.usuario) { irPara('#/login'); return; }
    try { await fn(el, { ...m.groups }, params); } catch (err) { el.innerHTML = `<div class="card vazio">⚠ ${esc(err.message)}</div>`; }
    window.scrollTo?.(0, 0);
    return;
  }
  el.innerHTML = '<div class="card vazio">Página não encontrada</div>';
}

// ============ Componentes visuais ============
const barra = (v, max = 120) => {
  if (v === null || v === undefined) return '<span class="muted">—</span>';
  const cls = v >= 100 ? 'ok' : v > 0 ? 'at' : 'er';
  return `<div class="barra-rot"><div class="barra ${cls}"><span style="width:${Math.min(100, (v / max) * 100)}%"></span></div><span class="num">${pct(v)}</span></div>`;
};
/** Card de número. Com `link`, o card inteiro é clicável e abre a lista correspondente. */
const stat = (rotulo, valor, cls = '', extra = '', link = '') => (link
  ? `<a class="stat clicavel ${cls}" href="${esc(link)}"><div class="rot">${rotulo}</div><div class="val">${valor}</div>${extra}<span class="ver" aria-hidden="true">Ver →</span></a>`
  : `<div class="stat ${cls}"><div class="rot">${rotulo}</div><div class="val">${valor}</div>${extra}</div>`);
/** Opções de responsáveis (indicadores, planos e ações) para filtros. */
let cacheResponsaveis = null;
async function responsavelOpcoes(sel) {
  if (!cacheResponsaveis) cacheResponsaveis = await api('/indicadores/responsaveis');
  const lista = sel && !cacheResponsaveis.includes(sel) ? [...cacheResponsaveis, sel] : cacheResponsaveis;
  return opcoes(lista.map((n) => [n, n]), sel, 'Todos');
}
const vazio = (txt) => `<div class="vazio">${esc(txt)}</div>`;
const abas = (itens, ativa) => `<div class="abas" role="tablist">${itens.map(([k, t]) => `<button class="aba ${k === ativa ? 'ativa' : ''}" data-aba="${k}" role="tab" aria-selected="${k === ativa}">${t}</button>`).join('')}</div>`;

function faixaTexto(i) {
  const u = i.unidade ? ` ${i.unidade}` : '';
  if (i.polaridade === 'maior_melhor') return `≥ ${fmt(i.meta)}${u}` + (i.limite_inferior !== null && i.limite_inferior !== undefined ? ` (aceitável ≥ ${fmt(i.limite_inferior)})` : '');
  if (i.polaridade === 'menor_melhor') return `≤ ${fmt(i.meta)}${u}` + (i.limite_superior !== null && i.limite_superior !== undefined ? ` (aceitável ≤ ${fmt(i.limite_superior)})` : '');
  return `${fmt(i.limite_inferior)} a ${fmt(i.limite_superior)}${u} (ideal ${fmt(i.meta)})`;
}

/** Gráfico de linha com meta, faixa aceitável e, opcionalmente, limites de controle (CEP). */
function grafico(ind, medicoes, cep = null) {
  if (!medicoes.length) return vazio('Sem medições registradas');
  const W = 760; const H = 260; const pe = 48; const pd = 28; const pt = 16; const pb = 32;
  const vals = medicoes.map((m) => m.valor);
  const refs = [ind.meta, ind.limite_inferior, ind.limite_superior, ...(cep?.suficiente ? [cep.lsc, cep.lic] : [])].filter((v) => v !== null && v !== undefined);
  let min = Math.min(...vals, ...refs); let max = Math.max(...vals, ...refs);
  const folga = (max - min) * 0.12 || Math.abs(max) * 0.1 || 1; min -= folga; max += folga;
  const x = (i) => pe + (medicoes.length === 1 ? (W - pe - pd) / 2 : (i * (W - pe - pd)) / (medicoes.length - 1));
  const y = (v) => pt + (1 - (v - min) / (max - min)) * (H - pt - pb);
  let faixa = ''; let fTopo = null; let fBase = null;
  const li = ind.limite_inferior; const ls = ind.limite_superior;
  if (ind.polaridade === 'maior_melhor' && li !== null && li !== undefined) { fTopo = max; fBase = li; }
  if (ind.polaridade === 'menor_melhor' && ls !== null && ls !== undefined) { fTopo = ls; fBase = min; }
  if (ind.polaridade === 'faixa') { fTopo = ls ?? max; fBase = li ?? min; }
  if (fTopo !== null) faixa = `<rect class="faixa" x="${pe}" y="${y(fTopo)}" width="${W - pe - pd}" height="${Math.max(0, y(fBase) - y(fTopo))}"/>`;
  const ticks = Array.from({ length: 5 }, (_, i) => min + ((max - min) * i) / 4);
  const cor = { atingido: 'var(--ok)', atencao: 'var(--at)', desvio: 'var(--er)' };
  const passo = Math.ceil(medicoes.length / 12);
  const linhaCep = cep?.suficiente ? [['lsc', cep.lsc, 'LSC'], ['lic', cep.lic, 'LIC'], ['lc', cep.media, 'Média']]
    .map(([c, v, t]) => `<line class="cep ${c}" x1="${pe}" x2="${W - pd}" y1="${y(v)}" y2="${y(v)}"/><text x="${W - pd}" y="${y(v) - 3}" text-anchor="end" class="cep-rot">${t} ${fmt(v, 1)}</text>`).join('') : '';
  const sinal = (i) => cep?.pontos?.[i]?.sinais?.length;
  // Linha de meta por período (sazonal) quando as metas variam
  const metasVariam = new Set(medicoes.map((m) => m.meta)).size > 1;
  const linhaMeta = metasVariam ? `<polyline class="meta" fill="none" points="${medicoes.map((m, i) => `${x(i)},${y(m.meta)}`).join(' ')}"/>`
    : `<line class="meta" x1="${pe}" x2="${W - pd}" y1="${y(ind.meta)}" y2="${y(ind.meta)}"/>`;
  return `<svg class="grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolução de ${esc(ind.nome)}">
    ${ticks.map((t) => `<line class="eixo" x1="${pe}" x2="${W - pd}" y1="${y(t)}" y2="${y(t)}" opacity=".5"/><text x="${pe - 6}" y="${y(t) + 4}" text-anchor="end">${fmt(t, 1)}</text>`).join('')}
    ${faixa}${linhaCep}${linhaMeta}
    <polyline class="linha" points="${medicoes.map((m, i) => `${x(i)},${y(m.valor)}`).join(' ')}"/>
    ${medicoes.map((m, i) => `${sinal(i) ? `<circle cx="${x(i)}" cy="${y(m.valor)}" r="9" class="halo"/>` : ''}<circle cx="${x(i)}" cy="${y(m.valor)}" r="5" fill="${cor[m.status]}" stroke="var(--sup)" stroke-width="2"><title>${mesBR(m.periodo)}: ${fmt(m.valor)} ${esc(ind.unidade || '')} — ${rot(m.status)}${sinal(i) ? ' — sinal de instabilidade: ' + cep.pontos[i].sinais.join(', ') : ''}</title></circle>`).join('')}
    ${medicoes.map((m, i) => (i % passo === 0 ? `<text x="${x(i)}" y="${H - 10}" text-anchor="middle">${mesBR(m.periodo)}</text>` : '')).join('')}
  </svg>
  <div class="legenda"><span><i class="leg-meta"></i>Meta${metasVariam ? ' (sazonal)' : ` (${fmt(ind.meta)})`}</span>
    ${fTopo !== null ? '<span><i style="background:var(--ok);opacity:.25"></i>Range aceitável</span>' : ''}
    ${cep?.suficiente ? '<span><i class="leg-cep"></i>Limites de controle ±3σ</span>' : ''}
    <span><i style="background:var(--ok)"></i>Atingido</span><span><i style="background:var(--at)"></i>Atenção</span><span><i style="background:var(--er)"></i>Desvio</span></div>`;
}
