'use strict';
// Governança: benchmark entre departamentos e reuniões de análise crítica (PDCA).
// Consome apenas os serviços públicos dos módulos Indicadores e Metas — ambos opcionais.
const E = require('../../core/erros');
const { usuarioAtual } = require('../../core/contexto');

const hoje = () => new Date().toISOString().slice(0, 10);
const CORPORATIVA = 0; // "departamento" lógico das reuniões corporativas (visível só a diretoria/admin)

function criarGovernancaService(db, core, { indicadores = null, metas = null } = {}) {
  const audit = (ent, id, acao, dados) => core.auditar('governanca', ent, id, acao, dados);
  const cicloAtivo = () => (metas ? metas.listarCiclos().find((c) => c.status === 'ativo') || metas.listarCiclos()[0] : null);

  // ================= Benchmark / ranking =================
  // Ranking de DESEMPENHO DOS KPIs entre áreas, num mesmo período e num mesmo nível da estrutura.
  // Pontuação por indicador medido: atingido 100, atenção 50, desvio 0. Índice = média dos pontos.
  // Só entra no ranking a área com pelo menos MIN_COBERTURA dos indicadores medidos no período.
  // A nota das metas bonificáveis é exibida à parte (não compõe o índice).
  const MIN_COBERTURA = 0.5;
  const PONTOS = { atingido: 100, atencao: 50, desvio: 0 };
  const JANELA = { mensal: 1, bimestral: 2, trimestral: 3, semestral: 6, anual: 12 }; // meses em que uma medição vale para o período
  const NIVEIS = ['area', 'gerencia', 'diretoria'];
  const mesesEntre = (a, b) => { const [ya, ma] = a.split('-').map(Number); const [yb, mb] = b.split('-').map(Number); return (yb - ya) * 12 + (mb - ma); };
  function periodoPadrao() { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); }

  function benchmark({ ciclo_id, periodo, nivel } = {}) {
    const per = periodo ? E.periodo(periodo) : periodoPadrao();
    const niv = E.umDe(nivel, 'nivel', NIVEIS, 'gerencia');
    // Estrutura completa (para subir na hierarquia); a visibilidade vem da lista de indicadores, que já respeita o escopo
    const todos = new Map(db.prepare('SELECT id, nome, tipo, pai_id FROM departamentos').all().map((d) => [d.id, d]));
    const grupoDe = (depId) => {
      if (niv === 'area') return todos.get(depId);
      for (let d = todos.get(depId); d; d = todos.get(d.pai_id)) if (d.tipo === niv) return d;
      return todos.get(depId); // sem nó desse nível acima (ex.: KPI direto na diretoria): a própria área
    };
    const grupos = new Map();
    const linha = (depId) => {
      const g = grupoDe(depId); if (!g) return null;
      if (!grupos.has(g.id)) grupos.set(g.id, { departamento_id: g.id, departamento: g.nome, tipo: g.tipo, indicadores: 0, medidos: 0, atingidos: 0, atencao: 0, desvios: 0, pontos: 0 });
      return grupos.get(g.id);
    };
    const comparativo = [];
    if (indicadores) {
      const inds = indicadores.listar();
      for (const i of inds) {
        const d = linha(i.departamento_id); if (!d) continue;
        d.indicadores++;
        // Medição que vale para o período: a mais recente até o período, dentro da janela da frequência
        const janela = JANELA[i.frequencia] || 1;
        const med = indicadores.listarMedicoes(i.id).filter((m) => m.periodo <= per && mesesEntre(m.periodo, per) < janela).pop();
        if (!med || !(med.status in PONTOS)) continue;
        d.medidos++; d.pontos += PONTOS[med.status];
        if (med.status === 'atingido') d.atingidos++; else if (med.status === 'atencao') d.atencao++; else d.desvios++;
      }
      for (const p of indicadores.listarPlanos()) {
        const d = linha(p.departamento_id); if (!d) continue;
        if (['aberto', 'em_andamento'].includes(p.status)) d.planos_abertos = (d.planos_abertos || 0) + 1;
        if (p.acoes_atrasadas && !['concluido', 'cancelado'].includes(p.status)) d.planos_atrasados = (d.planos_atrasados || 0) + 1;
        if (['eficaz', 'nao_eficaz'].includes(p.eficacia)) { d.verificados = (d.verificados || 0) + 1; if (p.eficacia === 'eficaz') d.eficazes = (d.eficazes || 0) + 1; }
      }
      // Mesmo indicador em várias áreas/unidades (agrupado pelo nome)
      const grupos = new Map();
      for (const i of inds) { const k = i.nome.trim().toLowerCase(); if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(i); }
      for (const lista of grupos.values()) {
        if (lista.length < 2) continue;
        const pol = lista[0].polaridade;
        const itens = lista.map((i) => ({ indicador_id: i.id, departamento: i.departamento, valor: i.ultima_medicao?.valor ?? null, periodo: i.ultima_medicao?.periodo ?? null,
          status: i.ultima_medicao?.status || 'sem_medicao', desvio_pct: i.desvio_pct }))
          .sort((a, b) => (a.valor === null) - (b.valor === null) || (pol === 'menor_melhor' ? a.valor - b.valor : b.valor - a.valor));
        comparativo.push({ indicador: lista[0].nome, unidade: lista[0].unidade, polaridade: pol, itens });
      }
    }
    // Metas bonificáveis: informativo, em coluna à parte, só se o ciclo tiver metas
    let ciclo = null; let comMetas = false;
    if (metas) {
      ciclo = ciclo_id ? metas.obterCiclo(Number(ciclo_id)) : cicloAtivo();
      if (ciclo) {
        const notas = new Map();
        for (const d of metas.apurarCiclo(ciclo.id).departamentos.filter((x) => x.metas?.length)) {
          const g = grupoDe(d.departamento_id); if (!g) continue;
          if (!notas.has(g.id)) notas.set(g.id, []); notas.get(g.id).push(d.nota);
        }
        comMetas = notas.size > 0;
        for (const [gid, ns] of notas) { const l = grupos.get(gid) || linha(gid); if (l) l.nota_metas = ns.reduce((s, x) => s + x, 0) / ns.length; }
      }
    }
    const r1 = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);
    const linhas = [...grupos.values()].filter((d) => d.indicadores || d.nota_metas !== undefined).map((d) => ({
      departamento_id: d.departamento_id, departamento: d.departamento, tipo: d.tipo, indicadores: d.indicadores, medidos: d.medidos,
      cobertura: d.indicadores ? r1((100 * d.medidos) / d.indicadores) : null,
      atingidos: d.atingidos, atencao: d.atencao, desvios: d.desvios,
      indice: d.medidos ? r1(d.pontos / d.medidos) : null,
      pct_atingidos: d.medidos ? r1((100 * d.atingidos) / d.medidos) : null,
      planos_abertos: d.planos_abertos || 0, planos_atrasados: d.planos_atrasados || 0,
      eficacia_planos: d.verificados ? r1((100 * (d.eficazes || 0)) / d.verificados) : null,
      nota_metas: r1(d.nota_metas ?? null),
    }));
    const elegivel = (d) => d.indicadores > 0 && d.medidos / d.indicadores >= MIN_COBERTURA;
    const ranking = linhas.filter(elegivel)
      .sort((a, b) => b.indice - a.indice || b.cobertura - a.cobertura || a.departamento.localeCompare(b.departamento, 'pt-BR'))
      .map((d) => ({ posicao: 0, ...d }));
    // Empate no índice divide a posição (ranking "1, 2, 2, 4")
    ranking.forEach((d, i) => { d.posicao = i > 0 && d.indice === ranking[i - 1].indice ? ranking[i - 1].posicao : i + 1; });
    const sem_dados = linhas.filter((d) => !elegivel(d)).sort((a, b) => b.medidos - a.medidos || a.departamento.localeCompare(b.departamento, 'pt-BR'));
    return { periodo: per, nivel: niv, cobertura_minima: MIN_COBERTURA * 100, ciclo: ciclo ? { id: ciclo.id, nome: ciclo.nome } : null, com_metas: comMetas,
      ranking, sem_dados, comparativo,
      metodologia: `Desempenho dos KPIs em ${per}: atingido = 100, atenção = 50, desvio = 0; índice = média dos indicadores medidos. Entram no ranking as áreas com pelo menos ${MIN_COBERTURA * 100}% dos indicadores medidos no período. A nota de metas bonificáveis é informativa e não compõe o índice.` };
  }

  // ================= Reuniões de análise crítica =================
  const deptoReuniao = (r) => r.departamento_id ?? CORPORATIVA;
  const podeVerReuniao = (r) => (r.departamento_id ? core.podeVer(r.departamento_id) : core.deptosVisiveis() === null);
  function garantirVerReuniao(r) { E.exigir(podeVerReuniao(r), 'Sem permissão para esta reunião', 403); }
  function garantirEditarReuniao(r) {
    if (r.departamento_id) core.garantirEditar(r.departamento_id); else core.exigirPerfil('diretoria');
  }

  /** Pauta automática a partir do estado atual de indicadores, planos, metas e decisões anteriores. */
  function gerarPauta(departamentoId) {
    const escopo = departamentoId ? core.descendentes(departamentoId) : null;
    const noEscopo = (id) => !escopo || escopo.includes(id);
    const itens = [];
    if (indicadores) {
      for (const i of indicadores.listar().filter((x) => noEscopo(x.departamento_id))) {
        const st = i.ultima_medicao?.status;
        if (st === 'desvio' || st === 'atencao') itens.push({ tipo: st === 'desvio' ? 'indicador_desvio' : 'indicador_atencao', referencia: `#/indicadores/${i.id}`,
          texto: `${i.nome} (${i.departamento}): ${i.ultima_medicao.valor} ${i.unidade || ''} em ${i.ultima_medicao.periodo} — meta ${i.meta}${i.analises_pendentes ? ' — SEM análise de causa' : ''}` });
      }
      for (const p of indicadores.listarPlanos().filter((x) => noEscopo(x.departamento_id))) {
        if (p.acoes_atrasadas && !['concluido', 'cancelado'].includes(p.status)) itens.push({ tipo: 'plano_atrasado', referencia: `#/planos/${p.id}`,
          texto: `Plano "${p.titulo}" (${p.departamento}): ${p.acoes_atrasadas} ação(ões) atrasada(s), progresso ${p.progresso}%` });
        if (p.status === 'concluido' && p.eficacia === 'pendente') itens.push({ tipo: 'eficacia_pendente', referencia: `#/planos/${p.id}`, texto: `Verificar eficácia do plano "${p.titulo}"` });
        if (p.eficacia === 'nao_eficaz') itens.push({ tipo: 'plano_ineficaz', referencia: `#/planos/${p.id}`, texto: `Plano "${p.titulo}" não foi eficaz — definir nova análise (A do PDCA)` });
      }
    }
    if (metas) {
      const c = cicloAtivo();
      if (c && c.status !== 'encerrado') {
        for (const d of metas.apurarCiclo(c.id).departamentos.filter((x) => noEscopo(x.departamento_id))) {
          if (d.status_apuracao === 'submetido') itens.push({ tipo: 'apuracao_pendente', referencia: `#/metas?ciclo=${c.id}`, texto: `Aprovar apuração de metas de ${d.departamento} (nota ${d.nota}%)` });
          if (!d.elegivel) itens.push({ tipo: 'metas_risco', referencia: `#/metas?ciclo=${c.id}`, texto: `${d.departamento} abaixo da nota mínima de metas (${d.nota}%)` });
        }
        for (const a of metas.listarAlteracoes({ status: 'pendente' }).filter((x) => x.ciclo_id === c.id && noEscopo(x.departamento_id))) itens.push({ tipo: 'alteracao_meta', referencia: '#/metas/alteracoes', texto: `Decidir alteração da meta "${a.meta}" (${a.departamento})` });
      }
    }
    const decisoes = db.prepare(`SELECT d.*, r.titulo, r.data FROM gov_decisoes d JOIN gov_reunioes r ON r.id=d.reuniao_id
        WHERE d.status='pendente' AND r.departamento_id IS ? ORDER BY d.prazo`).all(departamentoId ?? null);
    for (const d of decisoes) itens.push({ tipo: 'decisao_pendente', referencia: `#/reunioes/${d.reuniao_id}`,
      texto: `Encaminhamento pendente (${d.titulo}, ${d.data.split('-').reverse().join('/')}): ${d.descricao}${d.responsavel ? ' — ' + d.responsavel : ''}${d.prazo && d.prazo < hoje() ? ' — ATRASADO' : ''}` });
    const ordem = ['indicador_desvio', 'plano_ineficaz', 'plano_atrasado', 'decisao_pendente', 'metas_risco', 'apuracao_pendente', 'alteracao_meta', 'eficacia_pendente', 'indicador_atencao'];
    return { gerada_em: new Date().toISOString(), itens: itens.sort((a, b) => ordem.indexOf(a.tipo) - ordem.indexOf(b.tipo)) };
  }

  function obterReuniao(id) {
    const r = db.prepare('SELECT r.*, d.nome AS departamento FROM gov_reunioes r LEFT JOIN departamentos d ON d.id=r.departamento_id WHERE r.id=?').get(id);
    if (!r) throw new E.NaoEncontrado('Reunião');
    garantirVerReuniao(r);
    const decisoes = db.prepare('SELECT * FROM gov_decisoes WHERE reuniao_id=? ORDER BY id').all(id)
      .map((d) => ({ ...d, atrasada: d.status === 'pendente' && d.prazo && d.prazo < hoje() }));
    return { ...r, pauta: r.pauta ? JSON.parse(r.pauta) : null, decisoes };
  }
  function listarReunioes() {
    return db.prepare(`SELECT r.id, r.titulo, r.data, r.status, r.departamento_id, d.nome AS departamento,
        (SELECT COUNT(*) FROM gov_decisoes x WHERE x.reuniao_id=r.id AND x.status='pendente') AS decisoes_pendentes
        FROM gov_reunioes r LEFT JOIN departamentos d ON d.id=r.departamento_id ORDER BY r.data DESC, r.id DESC`).all().filter(podeVerReuniao);
  }
  function salvarReuniao(d, id) {
    const r = { titulo: E.texto(d.titulo, 'titulo', { obrigatorio: true }), data: E.data(d.data, 'data', { obrigatorio: true }),
      departamento_id: E.numero(d.departamento_id, 'departamento_id'), participantes: E.texto(d.participantes, 'participantes'),
      ata: E.texto(d.ata, 'ata'), status: E.umDe(d.status, 'status', ['agendada', 'realizada', 'cancelada'], 'agendada') };
    if (r.departamento_id) core.obterDepartamento(r.departamento_id);
    garantirEditarReuniao(r);
    if (id) {
      const atual = obterReuniao(id);
      garantirEditarReuniao(atual);
      db.prepare('UPDATE gov_reunioes SET titulo=?, data=?, departamento_id=?, participantes=?, ata=?, status=? WHERE id=?')
        .run(r.titulo, r.data, r.departamento_id, r.participantes, r.ata, r.status, id);
      audit('reuniao', id, 'atualizar', { status: r.status });
      return obterReuniao(id);
    }
    const pauta = JSON.stringify(gerarPauta(r.departamento_id));
    const n = db.prepare('INSERT INTO gov_reunioes (titulo, data, departamento_id, participantes, pauta, ata, status, criado_por) VALUES (?,?,?,?,?,?,?,?)')
      .run(r.titulo, r.data, r.departamento_id, r.participantes, pauta, r.ata, r.status, usuarioAtual()?.nome || 'sistema');
    audit('reuniao', Number(n.lastInsertRowid), 'criar', { titulo: r.titulo });
    return obterReuniao(Number(n.lastInsertRowid));
  }
  function atualizarPauta(id) {
    const r = obterReuniao(id);
    garantirEditarReuniao(r);
    E.exigir(r.status === 'agendada', 'A pauta só pode ser atualizada antes da reunião');
    db.prepare('UPDATE gov_reunioes SET pauta=? WHERE id=?').run(JSON.stringify(gerarPauta(r.departamento_id)), id);
    return obterReuniao(id);
  }
  function excluirReuniao(id) { const r = obterReuniao(id); garantirEditarReuniao(r); db.prepare('DELETE FROM gov_reunioes WHERE id=?').run(id); audit('reuniao', id, 'excluir'); }

  function salvarDecisao(reuniaoId, d, id) {
    const r = obterReuniao(reuniaoId);
    garantirEditarReuniao(r);
    const x = { descricao: E.texto(d.descricao, 'descricao', { obrigatorio: true }), responsavel: E.texto(d.responsavel, 'responsavel'),
      prazo: E.data(d.prazo, 'prazo'), status: E.umDe(d.status, 'status', ['pendente', 'concluida', 'cancelada'], 'pendente') };
    if (id) db.prepare('UPDATE gov_decisoes SET descricao=?, responsavel=?, prazo=?, status=? WHERE id=? AND reuniao_id=?').run(x.descricao, x.responsavel, x.prazo, x.status, id, reuniaoId);
    else db.prepare('INSERT INTO gov_decisoes (reuniao_id, descricao, responsavel, prazo, status) VALUES (?,?,?,?,?)').run(reuniaoId, x.descricao, x.responsavel, x.prazo, x.status);
    audit('decisao', id || null, id ? 'atualizar' : 'criar', { reuniaoId, ...x });
    return obterReuniao(reuniaoId);
  }
  function excluirDecisao(reuniaoId, id) {
    garantirEditarReuniao(obterReuniao(reuniaoId));
    db.prepare('DELETE FROM gov_decisoes WHERE id=? AND reuniao_id=?').run(id, reuniaoId);
    return obterReuniao(reuniaoId);
  }

  core.registrarEntidade('governanca', 'reuniao', (id) => { const r = db.prepare('SELECT departamento_id FROM gov_reunioes WHERE id=?').get(id); return r ? deptoReuniao(r) : undefined; });

  return { benchmark, gerarPauta, listarReunioes, obterReuniao, salvarReuniao, atualizarPauta, excluirReuniao, salvarDecisao, excluirDecisao };
}

module.exports = { criarGovernancaService };
