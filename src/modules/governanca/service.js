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
  function benchmark({ ciclo_id } = {}) {
    const deptos = new Map(core.listarDepartamentos().map((d) => [d.id, { departamento_id: d.id, departamento: d.nome, tipo: d.tipo }]));
    const linha = (id) => deptos.get(id);
    const comparativo = [];
    if (indicadores) {
      const inds = indicadores.listar();
      for (const i of inds) {
        const d = linha(i.departamento_id); if (!d) continue;
        d.indicadores = (d.indicadores || 0) + 1;
        if (i.ultima_medicao) { d.medidos = (d.medidos || 0) + 1; if (i.ultima_medicao.status === 'atingido') d.atingidos = (d.atingidos || 0) + 1; if (i.ultima_medicao.status === 'desvio') d.desvios = (d.desvios || 0) + 1; }
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
    let ciclo = null;
    if (metas) {
      ciclo = ciclo_id ? metas.obterCiclo(Number(ciclo_id)) : cicloAtivo();
      if (ciclo) for (const d of metas.apurarCiclo(ciclo.id).departamentos) { const l = linha(d.departamento_id); if (l) l.nota_metas = d.nota; }
    }
    const r1 = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);
    const ranking = [...deptos.values()].filter((d) => d.indicadores || d.nota_metas !== undefined).map((d) => {
      const pctAtingidos = d.medidos ? (100 * (d.atingidos || 0)) / d.medidos : null;
      const eficacia = d.verificados ? (100 * (d.eficazes || 0)) / d.verificados : null;
      // Índice composto: 50% indicadores atingidos, 30% nota de metas (teto 100), 20% eficácia dos planos — reponderado se faltar algum
      const comps = [[pctAtingidos, 50], [d.nota_metas === undefined ? null : Math.min(100, d.nota_metas), 30], [eficacia, 20]].filter(([v]) => v !== null);
      const peso = comps.reduce((s, [, w]) => s + w, 0);
      return { departamento_id: d.departamento_id, departamento: d.departamento, indicadores: d.indicadores || 0, pct_atingidos: r1(pctAtingidos), desvios: d.desvios || 0,
        planos_abertos: d.planos_abertos || 0, planos_atrasados: d.planos_atrasados || 0, eficacia_planos: r1(eficacia), nota_metas: r1(d.nota_metas ?? null),
        indice: peso ? r1(comps.reduce((s, [v, w]) => s + v * w, 0) / peso) : null };
    }).sort((a, b) => (b.indice ?? -1) - (a.indice ?? -1)).map((d, i) => ({ posicao: i + 1, ...d }));
    return { ciclo: ciclo ? { id: ciclo.id, nome: ciclo.nome } : null, ranking, comparativo,
      metodologia: 'Índice = 50% indicadores atingidos + 30% nota de metas (máx. 100) + 20% eficácia dos planos; componentes ausentes são desconsiderados e os pesos, redistribuídos.' };
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
