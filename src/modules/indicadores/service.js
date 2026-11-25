'use strict';
const { transacao } = require('../../db');
const E = require('../../core/erros');
const calc = require('./calculo');
const { usuarioAtual } = require('../../core/contexto');

const POLARIDADES = ['maior_melhor', 'menor_melhor', 'faixa'];
const FREQUENCIAS = ['mensal', 'bimestral', 'trimestral', 'semestral', 'anual'];
const TECNICAS = ['5w2h', '5porques', 'ishikawa', 'pareto', 'a3', 'arvore'];
// Perspectivas do BSC: configuráveis pelo administrador (configuração "bsc_perspectivas", JSON [{chave, nome}]).
// Estas são o padrão quando nada foi configurado.
const PERSPECTIVAS_PADRAO = [
  { chave: 'financeira', nome: 'Financeira' },
  { chave: 'clientes', nome: 'Clientes' },
  { chave: 'processos', nome: 'Processos internos' },
  { chave: 'aprendizado', nome: 'Aprendizado e crescimento' },
];
const PERSPECTIVAS = PERSPECTIVAS_PADRAO.map((p) => p.chave);
const MAX_PERSPECTIVAS = 10;
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'perspectiva';
const CAMPOS_A3 = ['contexto', 'situacao_atual', 'objetivo', 'analise_causa', 'contramedidas', 'plano_implementacao', 'acompanhamento'];
const STATUS_PLANO = ['aberto', 'em_andamento', 'concluido', 'cancelado'];
const STATUS_ACAO = ['pendente', 'em_andamento', 'concluida', 'cancelada'];
const EFICACIA = ['pendente', 'eficaz', 'nao_eficaz'];
const CATEGORIAS_6M = ['metodo', 'maquina', 'material', 'mao_de_obra', 'medicao', 'meio_ambiente'];

const hoje = () => new Date().toISOString().slice(0, 10);

function criarIndicadoresService(db, core) {
  const audit = (ent, id, acao, dados) => core.auditar('indicadores', ent, id, acao, dados);

  // ---------------- Indicadores ----------------
  function normalizarIndicador(d) {
    const ind = {
      codigo: E.texto(d.codigo, 'codigo'),
      nome: E.texto(d.nome, 'nome', { obrigatorio: true }),
      descricao: E.texto(d.descricao, 'descricao'),
      departamento_id: E.numero(d.departamento_id, 'departamento_id', { obrigatorio: true }),
      responsavel: E.texto(d.responsavel, 'responsavel'),
      unidade: E.texto(d.unidade, 'unidade'),
      formula: E.texto(d.formula, 'formula'),
      fonte_dados: E.texto(d.fonte_dados, 'fonte_dados'),
      perspectiva: E.texto(d.perspectiva, 'perspectiva'),
      frequencia: E.umDe(d.frequencia, 'frequencia', FREQUENCIAS, 'mensal'),
      polaridade: E.umDe(d.polaridade, 'polaridade', POLARIDADES),
      meta: E.numero(d.meta, 'meta', { obrigatorio: true }),
      limite_inferior: E.numero(d.limite_inferior, 'limite_inferior'),
      limite_superior: E.numero(d.limite_superior, 'limite_superior'),
      ativo: d.ativo === undefined ? 1 : (d.ativo ? 1 : 0),
      tipo: E.umDe(d.tipo, 'tipo', ['manual', 'calculado'], 'manual'),
      formula_calculo: E.texto(d.formula_calculo, 'formula_calculo'),
      objetivo_id: E.numero(d.objetivo_id, 'objetivo_id'),
    };
    if (ind.perspectiva) E.umDe(ind.perspectiva, 'perspectiva', chavesPerspectivas());
    if (ind.objetivo_id) E.exigir(db.prepare('SELECT 1 FROM ind_objetivos WHERE id=?').get(ind.objetivo_id), 'Objetivo estratégico não encontrado');
    if (ind.tipo === 'calculado') validarFormula(ind);
    else ind.formula_calculo = null;
    core.obterDepartamento(ind.departamento_id);
    core.garantirEditar(ind.departamento_id);
    const erros = calc.validarFaixa(ind);
    if (erros.length) throw new E.ErroValidacao(erros.join('; '));
    return ind;
  }

  function enriquecer(ind) {
    const meds = db.prepare('SELECT periodo, valor, status FROM ind_medicoes WHERE indicador_id=? ORDER BY periodo').all(ind.id);
    const ultima = meds[meds.length - 1] || null;
    const pend = db.prepare(`SELECT COUNT(*) n FROM ind_medicoes m
        WHERE m.indicador_id=? AND m.status='desvio'
          AND NOT EXISTS (SELECT 1 FROM ind_analises a WHERE a.medicao_id=m.id)`).get(ind.id).n;
    const planos = db.prepare(`SELECT COUNT(*) n FROM ind_planos WHERE indicador_id=? AND status IN ('aberto','em_andamento')`).get(ind.id).n;
    return {
      ...ind,
      ultima_medicao: ultima,
      desvio_pct: ultima ? calc.desvioPercentual(ind, ultima.valor) : null,
      tendencia: calc.tendencia(meds.map((m) => m.valor), ind.polaridade),
      analises_pendentes: pend,
      planos_abertos: planos,
    };
  }

  /** Filtro "contém", sem diferenciar maiúsculas/minúsculas. */
  const contem = (t) => `%${String(t).trim().toLowerCase()}%`;

  function listar({ departamento_id, status, todos, responsavel } = {}) {
    const cond = []; const args = [];
    if (responsavel) { cond.push('LOWER(COALESCE(i.responsavel, \'\')) LIKE ?'); args.push(contem(responsavel)); }
    if (!todos) cond.push('i.ativo = 1');
    const f = core.filtroEscopo('i.departamento_id');
    if (f.sql) { cond.push('1=1' + f.sql); args.push(...f.args); }
    if (departamento_id) { cond.push('i.departamento_id = ?'); args.push(Number(departamento_id)); }
    const lista = db.prepare(`SELECT i.*, d.nome AS departamento FROM ind_indicadores i
        JOIN departamentos d ON d.id = i.departamento_id
        ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY d.nome, i.nome`).all(...args).map(enriquecer);
    return status ? lista.filter((i) => (i.ultima_medicao?.status || 'sem_medicao') === status) : lista;
  }

  function obter(id) {
    const ind = db.prepare(`SELECT i.*, d.nome AS departamento FROM ind_indicadores i
        JOIN departamentos d ON d.id = i.departamento_id WHERE i.id = ?`).get(id);
    if (!ind) throw new E.NaoEncontrado('Indicador');
    core.garantirVer(ind.departamento_id);
    return enriquecer(ind);
  }

  function salvar(dados, id) {
    const ind = normalizarIndicador(dados);
    if (ind.codigo) {
      const dup = db.prepare('SELECT id FROM ind_indicadores WHERE codigo=? AND id IS NOT ?').get(ind.codigo, id ?? null);
      E.exigir(!dup, 'Já existe um indicador com esse código');
    }
    if (ind.tipo === 'calculado' && id) E.exigir(!dependeDe(ind.formula_calculo, ind.codigo), 'A fórmula cria uma referência circular');
    const campos = Object.keys(ind);
    if (id) {
      const antes = db.prepare('SELECT * FROM ind_indicadores WHERE id=?').get(id);
      core.garantirEditar(obter(id).departamento_id);
      const mudouRegra = ['meta', 'limite_inferior', 'limite_superior', 'polaridade', 'formula_calculo'].some((c) => antes[c] !== ind[c]);
      const temMedicoes = db.prepare('SELECT COUNT(*) n FROM ind_medicoes WHERE indicador_id=?').get(id).n > 0;
      const justificativa = E.texto(dados.justificativa, 'justificativa');
      E.exigir(!(mudouRegra && temMedicoes) || justificativa, 'Informe a justificativa para alterar meta, range, polaridade ou fórmula de um indicador com histórico');
      db.prepare(`UPDATE ind_indicadores SET ${campos.map((c) => c + '=?').join(',')} WHERE id=?`)
        .run(...campos.map((c) => ind[c]), id);
      const alterados = campos.filter((c) => antes[c] !== ind[c]);
      if (alterados.length) {
        db.prepare('INSERT INTO ind_versoes (indicador_id, dados_anteriores, dados_novos, justificativa, usuario) VALUES (?,?,?,?,?)')
          .run(id, JSON.stringify(Object.fromEntries(alterados.map((c) => [c, antes[c]]))), JSON.stringify(Object.fromEntries(alterados.map((c) => [c, ind[c]]))),
            justificativa, usuarioAtual()?.nome || 'sistema');
      }
      audit('indicador', id, 'atualizar', { ...ind, justificativa });
      if (ind.tipo === 'calculado') recalcularIndicador(id);
      return obter(id);
    }
    const r = db.prepare(`INSERT INTO ind_indicadores (${campos.join(',')}) VALUES (${campos.map(() => '?').join(',')})`)
      .run(...campos.map((c) => ind[c]));
    audit('indicador', Number(r.lastInsertRowid), 'criar', ind);
    if (ind.tipo === 'calculado') recalcularIndicador(Number(r.lastInsertRowid));
    return obter(Number(r.lastInsertRowid));
  }

  function excluir(id) {
    core.garantirEditar(obter(id).departamento_id);
    db.prepare('DELETE FROM ind_indicadores WHERE id=?').run(id);
    audit('indicador', id, 'excluir');
  }

  // ---------------- Medições ----------------
  function listarMedicoes(indicadorId) {
    const { polaridade } = obter(indicadorId);
    return db.prepare(`SELECT m.*,
        (SELECT COUNT(*) FROM ind_analises a WHERE a.medicao_id = m.id) AS analises
        FROM ind_medicoes m WHERE indicador_id=? ORDER BY periodo`).all(indicadorId)
      .map((m) => ({ ...m, desvio_pct: calc.desvioPercentual({ polaridade, meta: m.meta }, m.valor),
        analise_pendente: m.status === 'desvio' && m.analises === 0 }));
  }

  /** Registra (ou substitui) o valor de um período. A meta/range vigentes são gravados como snapshot. */
  /** Meta e range vigentes no período (considera metas sazonais). */
  function metaVigente(ind, periodo) {
    const mp = db.prepare('SELECT meta, limite_inferior, limite_superior FROM ind_metas_periodo WHERE indicador_id=? AND periodo=?').get(ind.id, periodo);
    return mp ? { ...ind, ...mp, sazonal: true } : { ...ind, sazonal: false };
  }

  function registrarMedicao(indicadorId, dados, { interno = false } = {}) {
    const indBase = obter(indicadorId);
    core.garantirEditar(indBase.departamento_id);
    E.exigir(interno || indBase.tipo !== 'calculado', 'Indicador calculado: o valor é obtido automaticamente pela fórmula');
    const periodo = E.periodo(dados.periodo);
    const valor = E.numero(dados.valor, 'valor', { obrigatorio: true });
    const ind = metaVigente(indBase, periodo);
    const status = calc.classificar(ind, valor);
    const existente = db.prepare('SELECT id FROM ind_medicoes WHERE indicador_id=? AND periodo=?').get(indicadorId, periodo);
    const args = [valor, ind.meta, ind.limite_inferior, ind.limite_superior, status,
      E.texto(dados.comentario, 'comentario'), E.texto(dados.registrado_por, 'registrado_por')];
    let medId;
    if (existente) {
      db.prepare(`UPDATE ind_medicoes SET valor=?, meta=?, limite_inferior=?, limite_superior=?, status=?, comentario=?, registrado_por=?
                  WHERE id=?`).run(...args, existente.id);
      medId = existente.id;
    } else {
      medId = Number(db.prepare(`INSERT INTO ind_medicoes (valor, meta, limite_inferior, limite_superior, status, comentario, registrado_por, indicador_id, periodo)
                  VALUES (?,?,?,?,?,?,?,?,?)`).run(...args, indicadorId, periodo).lastInsertRowid);
    }
    audit('medicao', medId, existente ? 'atualizar' : 'criar', { indicadorId, periodo, valor, status });
    const med = db.prepare('SELECT * FROM ind_medicoes WHERE id=?').get(medId);
    if (status === 'desvio') core.eventos.emit('indicadores.desvio', { indicador: ind, medicao: med });
    if (indBase.codigo) recalcularDependentes(indBase.codigo, periodo);
    return { ...med, exige_analise: status === 'desvio' };
  }

  function excluirMedicao(medicaoId) {
    const m = db.prepare('SELECT id, indicador_id FROM ind_medicoes WHERE id=?').get(medicaoId);
    if (!m) throw new E.NaoEncontrado('Medição');
    core.garantirEditar(obter(m.indicador_id).departamento_id);
    db.prepare('DELETE FROM ind_medicoes WHERE id=?').run(medicaoId);
    audit('medicao', medicaoId, 'excluir');
  }

  // ---------------- Análises de desvio ----------------
  function validarConteudo(tecnica, c) {
    E.exigir(c && typeof c === 'object', 'Conteúdo da análise é obrigatório');
    if (tecnica === '5w2h') {
      for (const k of ['o_que', 'por_que']) E.exigir(String(c[k] || '').trim(), `5W2H: campo "${k}" é obrigatório`);
      const campos = ['o_que', 'por_que', 'onde', 'quando', 'quem', 'como', 'quanto'];
      return Object.fromEntries(campos.map((k) => [k, c[k] ? String(c[k]).trim() : '']));
    }
    if (tecnica === '5porques') {
      const porques = (Array.isArray(c.porques) ? c.porques : []).map((p) => String(p || '').trim()).filter(Boolean);
      E.exigir(String(c.problema || '').trim(), '5 Porquês: descreva o problema');
      E.exigir(porques.length >= 1 && porques.length <= 7, '5 Porquês: informe de 1 a 7 porquês');
      return { problema: String(c.problema).trim(), porques };
    }
    if (tecnica === 'pareto') {
      E.exigir(String(c.problema || '').trim(), 'Pareto: descreva o problema analisado');
      const itens = (Array.isArray(c.itens) ? c.itens : []).map((i) => ({ causa: String(i.causa || '').trim(), frequencia: Number(i.frequencia) }))
        .filter((i) => i.causa && Number.isFinite(i.frequencia) && i.frequencia > 0);
      E.exigir(itens.length >= 2, 'Pareto: informe ao menos 2 causas com frequência');
      return { problema: String(c.problema).trim(), itens: calc.pareto(itens) };
    }
    if (tecnica === 'a3') {
      const out = Object.fromEntries(CAMPOS_A3.map((k) => [k, String(c[k] || '').trim()]));
      for (const k of ['contexto', 'situacao_atual', 'analise_causa']) E.exigir(out[k], `A3: campo "${k}" é obrigatório`);
      return out;
    }
    if (tecnica === 'arvore') {
      E.exigir(String(c.evento_topo || '').trim(), 'Árvore de falhas: informe o evento topo');
      const norm = (nos, nivel) => (Array.isArray(nos) ? nos : []).slice(0, 20).map((n) => ({
        descricao: String(n.descricao || '').trim(), porta: n.porta === 'E' ? 'E' : 'OU',
        filhos: nivel < 4 ? norm(n.filhos, nivel + 1) : [] })).filter((n) => n.descricao);
      const causas = norm(c.causas, 1);
      E.exigir(causas.length, 'Árvore de falhas: informe ao menos uma causa');
      return { evento_topo: String(c.evento_topo).trim(), porta: c.porta === 'E' ? 'E' : 'OU', causas };
    }
    // ishikawa
    E.exigir(String(c.problema || '').trim(), 'Ishikawa: descreva o efeito/problema');
    const out = { problema: String(c.problema).trim() };
    let total = 0;
    for (const cat of CATEGORIAS_6M) {
      out[cat] = (Array.isArray(c[cat]) ? c[cat] : []).map((x) => String(x || '').trim()).filter(Boolean);
      total += out[cat].length;
    }
    E.exigir(total > 0, 'Ishikawa: informe ao menos uma causa em alguma das categorias 6M');
    return out;
  }

  function obterAnalise(id) {
    const a = db.prepare(`SELECT a.*, m.periodo, m.valor, m.indicador_id FROM ind_analises a
        JOIN ind_medicoes m ON m.id = a.medicao_id WHERE a.id=?`).get(id);
    if (!a) throw new E.NaoEncontrado('Análise');
    obter(a.indicador_id);
    return { ...a, conteudo: JSON.parse(a.conteudo) };
  }

  function listarAnalises(indicadorId) {
    return db.prepare(`SELECT a.id FROM ind_analises a JOIN ind_medicoes m ON m.id=a.medicao_id
        WHERE m.indicador_id=? ORDER BY m.periodo DESC, a.id DESC`).all(indicadorId).map((r) => obterAnalise(r.id));
  }

  function registrarAnalise(medicaoId, dados) {
    const med = db.prepare('SELECT * FROM ind_medicoes WHERE id=?').get(medicaoId);
    if (!med) throw new E.NaoEncontrado('Medição');
    core.garantirEditar(obter(med.indicador_id).departamento_id);
    const tecnica = E.umDe(dados.tecnica, 'tecnica', TECNICAS);
    const conteudo = validarConteudo(tecnica, dados.conteudo);
    const causa = E.texto(dados.causa_raiz, 'causa_raiz')
      || (tecnica === '5porques' ? conteudo.porques[conteudo.porques.length - 1] : null)
      || (tecnica === 'pareto' ? conteudo.itens.filter((i) => i.vital).map((i) => i.causa).join('; ') : null)
      || (tecnica === 'a3' ? conteudo.analise_causa : null);
    const r = db.prepare('INSERT INTO ind_analises (medicao_id, tecnica, conteudo, causa_raiz, responsavel) VALUES (?,?,?,?,?)')
      .run(medicaoId, tecnica, JSON.stringify(conteudo), causa, E.texto(dados.responsavel, 'responsavel'));
    const id = Number(r.lastInsertRowid);
    audit('analise', id, 'criar', { medicaoId, tecnica });
    return obterAnalise(id);
  }

  function excluirAnalise(id) {
    core.garantirEditar(obter(obterAnalise(id).indicador_id).departamento_id);
    db.prepare('DELETE FROM ind_analises WHERE id=?').run(id);
    audit('analise', id, 'excluir');
  }

  // ---------------- Planos de ação (5W2H) ----------------
  function gut(d, atual = {}) {
    const v = (k) => {
      const x = d[k] === undefined ? atual[k] : E.numero(d[k], k);
      E.exigir(x === null || x === undefined || (Number.isInteger(x) && x >= 1 && x <= 5), `GUT: "${k}" deve ser inteiro de 1 a 5`);
      return x ?? null;
    };
    return { gravidade: v('gravidade'), urgencia: v('urgencia'), tendencia_gut: v('tendencia_gut') };
  }

  function normalizarAcao(a) {
    return {
      o_que: E.texto(a.o_que, 'o_que (What)', { obrigatorio: true }),
      por_que: E.texto(a.por_que, 'por_que'),
      onde: E.texto(a.onde, 'onde'),
      quando: E.data(a.quando, 'quando (prazo)', { obrigatorio: true }),
      quem: E.texto(a.quem, 'quem (responsável)', { obrigatorio: true }),
      como: E.texto(a.como, 'como'),
      quanto: E.numero(a.quanto, 'quanto'),
      status: E.umDe(a.status, 'status', STATUS_ACAO, 'pendente'),
    };
  }

  function decorarAcao(a) {
    const atrasada = !['concluida', 'cancelada'].includes(a.status) && a.quando < hoje();
    return { ...a, atrasada };
  }

  function obterPlano(id) {
    const p = db.prepare(`SELECT p.*, i.nome AS indicador, i.departamento_id, d.nome AS departamento
        FROM ind_planos p JOIN ind_indicadores i ON i.id=p.indicador_id
        JOIN departamentos d ON d.id=i.departamento_id WHERE p.id=?`).get(id);
    if (!p) throw new E.NaoEncontrado('Plano de ação');
    core.garantirVer(p.departamento_id);
    const acoes = db.prepare('SELECT * FROM ind_acoes WHERE plano_id=? ORDER BY quando, id').all(id).map(decorarAcao);
    const validas = acoes.filter((a) => a.status !== 'cancelada');
    const concl = validas.filter((a) => a.status === 'concluida').length;
    return {
      ...p,
      acoes,
      prioridade: calc.prioridadeGut(p.gravidade, p.urgencia, p.tendencia_gut),
      fase_pdca: calc.fasePdca(p),
      progresso: validas.length ? Math.round((concl / validas.length) * 100) : 0,
      acoes_atrasadas: acoes.filter((a) => a.atrasada).length,
      custo_total: acoes.reduce((s, a) => s + (a.status !== 'cancelada' ? a.quanto || 0 : 0), 0),
      prazo_final: validas.reduce((m, a) => (a.quando > m ? a.quando : m), ''),
    };
  }

  function listarPlanos({ indicador_id, departamento_id, status, atrasados, ordem, responsavel } = {}) {
    const cond = []; const args = [];
    if (indicador_id) { cond.push('p.indicador_id=?'); args.push(Number(indicador_id)); }
    if (departamento_id) { cond.push('i.departamento_id=?'); args.push(Number(departamento_id)); }
    // "abertos" agrupa os planos ainda não encerrados (aberto + em andamento)
    if (status === 'abertos') cond.push("p.status IN ('aberto','em_andamento')");
    else if (status) { cond.push('p.status=?'); args.push(status); }
    // Responsável do plano ou de qualquer ação dele
    if (responsavel) {
      cond.push(`(LOWER(COALESCE(p.responsavel, '')) LIKE ? OR EXISTS (SELECT 1 FROM ind_acoes a WHERE a.plano_id=p.id AND LOWER(a.quem) LIKE ?))`);
      args.push(contem(responsavel), contem(responsavel));
    }
    const f = core.filtroEscopo('i.departamento_id');
    if (f.sql) { cond.push('1=1' + f.sql); args.push(...f.args); }
    let planos = db.prepare(`SELECT p.id FROM ind_planos p JOIN ind_indicadores i ON i.id=p.indicador_id
        ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY p.id DESC`).all(...args).map((r) => obterPlano(r.id));
    if (atrasados === '1' || atrasados === true) planos = planos.filter((p) => p.acoes_atrasadas > 0);
    if (ordem === 'gut') planos.sort((a, b) => (b.prioridade ?? -1) - (a.prioridade ?? -1));
    return planos;
  }

  function criarPlano(dados) {
    const indicadorId = E.numero(dados.indicador_id, 'indicador_id', { obrigatorio: true });
    core.garantirEditar(obter(indicadorId).departamento_id);
    const analiseId = E.numero(dados.analise_id, 'analise_id');
    if (analiseId) {
      const a = obterAnalise(analiseId);
      E.exigir(a.indicador_id === indicadorId, 'A análise informada não pertence a este indicador');
    }
    const acoes = (Array.isArray(dados.acoes) ? dados.acoes : []).map(normalizarAcao);
    return transacao(db, () => {
      const g = gut(dados);
      const r = db.prepare('INSERT INTO ind_planos (indicador_id, analise_id, titulo, objetivo, responsavel, eficacia, gravidade, urgencia, tendencia_gut) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(indicadorId, analiseId, E.texto(dados.titulo, 'titulo', { obrigatorio: true }),
          E.texto(dados.objetivo, 'objetivo'), E.texto(dados.responsavel, 'responsavel'), 'pendente', g.gravidade, g.urgencia, g.tendencia_gut);
      const id = Number(r.lastInsertRowid);
      for (const a of acoes) inserirAcao(id, a);
      if (acoes.some((a) => a.status !== 'pendente')) db.prepare(`UPDATE ind_planos SET status='em_andamento' WHERE id=?`).run(id);
      audit('plano', id, 'criar', { indicadorId, analiseId, acoes: acoes.length });
      return obterPlano(id);
    });
  }

  function atualizarPlano(id, dados) {
    const p = obterPlano(id);
    core.garantirEditar(p.departamento_id);
    const status = E.umDe(dados.status, 'status', STATUS_PLANO, p.status);
    const eficacia = E.umDe(dados.eficacia, 'eficacia', EFICACIA, p.eficacia || 'pendente');
    if (eficacia !== 'pendente') E.exigir(status === 'concluido', 'A verificação de eficácia só pode ser registrada em planos concluídos');
    if (status === 'concluido' && p.status !== 'concluido') {
      const abertas = p.acoes.filter((a) => !['concluida', 'cancelada'].includes(a.status)).length;
      E.exigir(!abertas, `Não é possível concluir o plano: há ${abertas} ação(ões) em aberto`);
    }
    db.prepare(`UPDATE ind_planos SET titulo=?, objetivo=?, responsavel=?, status=?, eficacia=?, verificacao_data=?, verificacao_obs=? WHERE id=?`)
      .run(E.texto(dados.titulo ?? p.titulo, 'titulo', { obrigatorio: true }), E.texto(dados.objetivo ?? p.objetivo, 'objetivo'),
        E.texto(dados.responsavel ?? p.responsavel, 'responsavel'), status, eficacia,
        eficacia !== 'pendente' ? (E.data(dados.verificacao_data, 'verificacao_data') || hoje()) : null,
        E.texto(dados.verificacao_obs ?? p.verificacao_obs, 'verificacao_obs'), id);
    const g = gut(dados, p);
    db.prepare('UPDATE ind_planos SET gravidade=?, urgencia=?, tendencia_gut=? WHERE id=?').run(g.gravidade, g.urgencia, g.tendencia_gut, id);
    audit('plano', id, 'atualizar', { status, eficacia, ...g });
    return obterPlano(id);
  }

  function excluirPlano(id) {
    core.garantirEditar(obterPlano(id).departamento_id);
    db.prepare('DELETE FROM ind_planos WHERE id=?').run(id);
    audit('plano', id, 'excluir');
  }

  function inserirAcao(planoId, a) {
    return Number(db.prepare(`INSERT INTO ind_acoes (plano_id, o_que, por_que, onde, quando, quem, como, quanto, status, concluida_em)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(planoId, a.o_que, a.por_que, a.onde, a.quando, a.quem, a.como, a.quanto, a.status,
      a.status === 'concluida' ? hoje() : null).lastInsertRowid);
  }

  function adicionarAcao(planoId, dados) {
    const p = obterPlano(planoId);
    core.garantirEditar(p.departamento_id);
    E.exigir(!['concluido', 'cancelado'].includes(p.status), 'Plano encerrado não aceita novas ações');
    const id = inserirAcao(planoId, normalizarAcao(dados));
    if (p.status === 'aberto') db.prepare(`UPDATE ind_planos SET status='em_andamento' WHERE id=?`).run(planoId);
    audit('acao', id, 'criar', dados);
    return obterPlano(planoId);
  }

  function atualizarAcao(acaoId, dados) {
    const atual = db.prepare('SELECT * FROM ind_acoes WHERE id=?').get(acaoId);
    if (!atual) throw new E.NaoEncontrado('Ação');
    const pl = obterPlano(atual.plano_id);
    // O responsável pela ação (campo "quem") pode atualizar o status dela mesmo sem ser gestor
    const u = usuarioAtual();
    const ehResponsavel = u && atual.quem && atual.quem.toLowerCase().includes(u.nome.toLowerCase());
    if (ehResponsavel) dados = { status: dados.status };
    else core.garantirEditar(pl.departamento_id);
    const a = normalizarAcao({ ...atual, ...dados });
    const concluidaEm = a.status === 'concluida' ? (atual.concluida_em || hoje()) : null;
    db.prepare(`UPDATE ind_acoes SET o_que=?, por_que=?, onde=?, quando=?, quem=?, como=?, quanto=?, status=?, concluida_em=? WHERE id=?`)
      .run(a.o_que, a.por_que, a.onde, a.quando, a.quem, a.como, a.quanto, a.status, concluidaEm, acaoId);
    const plano = db.prepare('SELECT status FROM ind_planos WHERE id=?').get(atual.plano_id);
    if (plano.status === 'aberto' && a.status !== 'pendente') db.prepare(`UPDATE ind_planos SET status='em_andamento' WHERE id=?`).run(atual.plano_id);
    audit('acao', acaoId, 'atualizar', dados);
    return obterPlano(atual.plano_id);
  }

  function excluirAcao(acaoId) {
    const atual = db.prepare('SELECT * FROM ind_acoes WHERE id=?').get(acaoId);
    if (!atual) throw new E.NaoEncontrado('Ação');
    core.garantirEditar(obterPlano(atual.plano_id).departamento_id);
    db.prepare('DELETE FROM ind_acoes WHERE id=?').run(acaoId);
    audit('acao', acaoId, 'excluir');
    return obterPlano(atual.plano_id);
  }

  // ---------------- Indicadores calculados ----------------
  const porCodigo = (codigo) => db.prepare('SELECT * FROM ind_indicadores WHERE codigo=?').get(codigo);
  function validarFormula(ind) {
    E.exigir(ind.formula_calculo, 'Indicador calculado exige fórmula (ex.: {COD-1} / {COD-2} * 100)');
    let refs;
    try { calc.analisarFormula(ind.formula_calculo); refs = calc.referencias(ind.formula_calculo); } catch (e) { throw new E.ErroValidacao(`Fórmula inválida: ${e.message}`); }
    E.exigir(refs.length, 'A fórmula deve referenciar ao menos um indicador pelo código, ex.: {COM-01}');
    for (const r of refs) {
      E.exigir(r !== ind.codigo, 'A fórmula não pode referenciar o próprio indicador');
      E.exigir(porCodigo(r), `Indicador "${r}" usado na fórmula não existe`);
    }
  }
  /** true se a fórmula depende (direta ou indiretamente) do código informado. */
  function dependeDe(formula, codigo, visitados = new Set()) {
    if (!codigo || !formula) return false;
    for (const r of calc.referencias(formula)) {
      if (r === codigo) return true;
      if (visitados.has(r)) continue;
      visitados.add(r);
      const dep = porCodigo(r);
      if (dep?.tipo === 'calculado' && dependeDe(dep.formula_calculo, codigo, visitados)) return true;
    }
    return false;
  }
  function calcularPeriodo(ind, periodo) {
    const valores = {};
    for (const r of calc.referencias(ind.formula_calculo)) {
      valores[r] = db.prepare('SELECT m.valor FROM ind_medicoes m JOIN ind_indicadores i ON i.id=m.indicador_id WHERE i.codigo=? AND m.periodo=?').get(r, periodo)?.valor ?? null;
    }
    return calc.avaliarFormula(ind.formula_calculo, valores);
  }
  function gravarCalculado(ind, periodo) {
    const v = calcularPeriodo(ind, periodo);
    if (v === null) return;
    registrarMedicao(ind.id, { periodo, valor: v, comentario: 'Calculado automaticamente', registrado_por: 'sistema' }, { interno: true });
  }
  /** Recalcula todos os períodos de um indicador calculado. */
  function recalcularIndicador(id) {
    const ind = db.prepare('SELECT * FROM ind_indicadores WHERE id=?').get(id);
    const refs = calc.referencias(ind.formula_calculo);
    const periodos = db.prepare(`SELECT DISTINCT m.periodo FROM ind_medicoes m JOIN ind_indicadores i ON i.id=m.indicador_id
        WHERE i.codigo IN (${refs.map(() => '?').join(',')}) ORDER BY m.periodo`).all(...refs).map((r) => r.periodo);
    for (const p of periodos) gravarCalculado(ind, p);
  }
  /** Ao lançar o valor de um indicador, recalcula os calculados que dependem dele naquele período. */
  function recalcularDependentes(codigo, periodo) {
    const deps = db.prepare(`SELECT * FROM ind_indicadores WHERE tipo='calculado' AND ativo=1 AND formula_calculo LIKE ?`).all(`%{${codigo}}%`)
      .filter((d) => calc.referencias(d.formula_calculo).includes(codigo));
    for (const d of deps) gravarCalculado(d, periodo);
  }

  // ---------------- Metas por período (sazonalidade) ----------------
  function listarMetasPeriodo(indicadorId) {
    obter(indicadorId);
    return db.prepare('SELECT * FROM ind_metas_periodo WHERE indicador_id=? ORDER BY periodo').all(indicadorId);
  }
  function salvarMetaPeriodo(indicadorId, d) {
    const ind = obter(indicadorId);
    core.garantirEditar(ind.departamento_id);
    const periodo = E.periodo(d.periodo);
    const mp = { polaridade: ind.polaridade, meta: E.numero(d.meta, 'meta', { obrigatorio: true }),
      limite_inferior: E.numero(d.limite_inferior, 'limite_inferior'), limite_superior: E.numero(d.limite_superior, 'limite_superior') };
    const erros = calc.validarFaixa(mp);
    if (erros.length) throw new E.ErroValidacao(erros.join('; '));
    db.prepare(`INSERT INTO ind_metas_periodo (indicador_id, periodo, meta, limite_inferior, limite_superior) VALUES (?,?,?,?,?)
        ON CONFLICT(indicador_id, periodo) DO UPDATE SET meta=excluded.meta, limite_inferior=excluded.limite_inferior, limite_superior=excluded.limite_superior`)
      .run(indicadorId, periodo, mp.meta, mp.limite_inferior, mp.limite_superior);
    audit('meta_periodo', indicadorId, 'definir', { periodo, ...mp });
    // Reclassifica a medição já existente do período com a nova meta
    const med = db.prepare('SELECT valor, comentario, registrado_por FROM ind_medicoes WHERE indicador_id=? AND periodo=?').get(indicadorId, periodo);
    if (med) registrarMedicao(indicadorId, { periodo, ...med }, { interno: true });
    return listarMetasPeriodo(indicadorId);
  }
  function excluirMetaPeriodo(indicadorId, periodo) {
    core.garantirEditar(obter(indicadorId).departamento_id);
    db.prepare('DELETE FROM ind_metas_periodo WHERE indicador_id=? AND periodo=?').run(indicadorId, periodo);
    return listarMetasPeriodo(indicadorId);
  }

  const listarVersoes = (indicadorId) => { obter(indicadorId); return db.prepare('SELECT * FROM ind_versoes WHERE indicador_id=? ORDER BY id DESC').all(indicadorId)
    .map((v) => ({ ...v, dados_anteriores: JSON.parse(v.dados_anteriores), dados_novos: JSON.parse(v.dados_novos) })); };

  // ---------------- CEP ----------------
  function cartaControle(indicadorId) {
    obter(indicadorId);
    const meds = db.prepare('SELECT periodo, valor FROM ind_medicoes WHERE indicador_id=? ORDER BY periodo').all(indicadorId);
    const c = calc.cep(meds.map((m) => m.valor));
    return { ...c, pontos: c.pontos.map((p, i) => ({ ...p, periodo: meds[i].periodo })) };
  }

  // ---------------- Perspectivas do BSC ----------------
  function listarPerspectivas() {
    let lista = null;
    try { lista = JSON.parse(core.obterConfig('bsc_perspectivas') || 'null'); } catch { lista = null; }
    const valida = Array.isArray(lista) && lista.length
      && lista.every((p) => p && typeof p.chave === 'string' && p.chave && typeof p.nome === 'string' && p.nome);
    return (valida ? lista : PERSPECTIVAS_PADRAO).map((p) => ({ chave: p.chave, nome: p.nome }));
  }
  const chavesPerspectivas = () => listarPerspectivas().map((p) => p.chave);
  const usoPerspectiva = (chave) => ({
    objetivos: db.prepare('SELECT COUNT(*) n FROM ind_objetivos WHERE perspectiva=?').get(chave).n,
    indicadores: db.prepare('SELECT COUNT(*) n FROM ind_indicadores WHERE perspectiva=?').get(chave).n,
  });
  const chavesEmUso = () => new Set(db.prepare(`SELECT perspectiva p FROM ind_objetivos
      UNION SELECT perspectiva FROM ind_indicadores WHERE perspectiva IS NOT NULL`).all().map((r) => r.p));

  /** Substitui a lista de perspectivas. Itens com "chave" mantêm a chave (renomear/reordenar); sem chave, são novos. */
  function salvarPerspectivas(d) {
    core.exigirPerfil();
    const entrada = Array.isArray(d) ? d : d?.perspectivas;
    E.exigir(Array.isArray(entrada) && entrada.length, 'Informe ao menos uma perspectiva');
    E.exigir(entrada.length <= MAX_PERSPECTIVAS, `Máximo de ${MAX_PERSPECTIVAS} perspectivas`);
    const atuais = listarPerspectivas();
    const emUso = chavesEmUso();
    const conhecidas = new Set([...atuais.map((p) => p.chave), ...emUso]);
    const nomes = new Set();
    const usadas = new Set();
    const nova = [];
    for (const p of entrada) {
      const nome = E.texto(p?.nome, 'nome', { obrigatorio: true });
      E.exigir(nome.length <= 60, `Nome muito longo (máx. 60 caracteres): ${nome}`);
      const k = nome.toLocaleLowerCase('pt-BR');
      E.exigir(!nomes.has(k), `Perspectiva repetida: ${nome}`);
      nomes.add(k);
      let chave = E.texto(p?.chave, 'chave');
      if (chave) {
        E.exigir(conhecidas.has(chave), `Perspectiva desconhecida: ${chave}`);
      } else {
        const baseChave = slug(nome);
        chave = baseChave;
        for (let n = 2; conhecidas.has(chave) || usadas.has(chave); n++) chave = `${baseChave}_${n}`;
      }
      E.exigir(!usadas.has(chave), `Perspectiva repetida: ${nome}`);
      usadas.add(chave);
      nova.push({ chave, nome });
    }
    for (const p of atuais) {
      if (usadas.has(p.chave)) continue;
      const u = usoPerspectiva(p.chave);
      E.exigir(!u.objetivos && !u.indicadores, `A perspectiva "${p.nome}" tem ${u.objetivos} objetivo(s) e `
        + `${u.indicadores} indicador(es) vinculados. Mova-os para outra perspectiva antes de excluí-la.`, 409);
    }
    core.salvarConfig({ bsc_perspectivas: JSON.stringify(nova) });
    audit('perspectivas', null, 'atualizar', nova);
    return nova;
  }

  // ---------------- Mapa estratégico (BSC) ----------------
  function salvarObjetivo(d, id) {
    core.exigirPerfil('diretoria');
    const o = { perspectiva: E.umDe(d.perspectiva, 'perspectiva', chavesPerspectivas()), nome: E.texto(d.nome, 'nome', { obrigatorio: true }),
      descricao: E.texto(d.descricao, 'descricao'), ordem: E.numero(d.ordem, 'ordem') ?? 0 };
    let oid = id;
    if (id) db.prepare('UPDATE ind_objetivos SET perspectiva=?, nome=?, descricao=?, ordem=? WHERE id=?').run(o.perspectiva, o.nome, o.descricao, o.ordem, id);
    else oid = Number(db.prepare('INSERT INTO ind_objetivos (perspectiva, nome, descricao, ordem) VALUES (?,?,?,?)').run(o.perspectiva, o.nome, o.descricao, o.ordem).lastInsertRowid);
    if (Array.isArray(d.contribui_para)) {
      db.prepare('DELETE FROM ind_objetivos_relacoes WHERE origem_id=?').run(oid);
      for (const dest of d.contribui_para.map(Number).filter((x) => x && x !== oid)) db.prepare('INSERT OR IGNORE INTO ind_objetivos_relacoes VALUES (?,?)').run(oid, dest);
    }
    audit('objetivo', oid, id ? 'atualizar' : 'criar', o);
    return mapaEstrategico();
  }
  function excluirObjetivo(id) { core.exigirPerfil('diretoria'); db.prepare('DELETE FROM ind_objetivos WHERE id=?').run(id); audit('objetivo', id, 'excluir'); }
  function mapaEstrategico() {
    const inds = listar();
    const objetivos = db.prepare('SELECT * FROM ind_objetivos ORDER BY ordem, id').all().map((o) => {
      const meus = inds.filter((i) => i.objetivo_id === o.id);
      const st = meus.map((i) => i.ultima_medicao?.status).filter(Boolean);
      const situacao = !st.length ? 'sem_medicao' : st.includes('desvio') ? 'desvio' : st.includes('atencao') ? 'atencao' : 'atingido';
      return { ...o, situacao, contribui_para: db.prepare('SELECT destino_id FROM ind_objetivos_relacoes WHERE origem_id=?').all(o.id).map((r) => r.destino_id),
        indicadores: meus.map((i) => ({ id: i.id, codigo: i.codigo, nome: i.nome, status: i.ultima_medicao?.status || 'sem_medicao', departamento: i.departamento })) };
    });
    const lista = listarPerspectivas();
    // Objetivos com perspectiva fora da lista (ex.: configuração editada à mão) continuam visíveis.
    for (const o of objetivos) if (!lista.some((p) => p.chave === o.perspectiva)) lista.push({ chave: o.perspectiva, nome: o.perspectiva });
    return { perspectivas: lista.map((p) => ({ perspectiva: p.chave, nome: p.nome, objetivos: objetivos.filter((o) => o.perspectiva === p.chave) })),
      sem_objetivo: inds.filter((i) => !i.objetivo_id).length };
  }

  /** Nomes de responsáveis (indicadores, planos e ações) visíveis ao usuário, para os filtros. */
  function listarResponsaveis() {
    const f = core.filtroEscopo('i.departamento_id');
    const nomes = db.prepare(`SELECT i.responsavel n FROM ind_indicadores i WHERE i.ativo=1 ${f.sql}
        UNION SELECT p.responsavel FROM ind_planos p JOIN ind_indicadores i ON i.id=p.indicador_id WHERE 1=1 ${f.sql}
        UNION SELECT a.quem FROM ind_acoes a JOIN ind_planos p ON p.id=a.plano_id JOIN ind_indicadores i ON i.id=p.indicador_id WHERE 1=1 ${f.sql}`)
      .all(...f.args, ...f.args, ...f.args).map((r) => (r.n || '').trim()).filter(Boolean);
    return [...new Set(nomes)].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }

  // ---------------- Painel / alertas ----------------
  function painel() {
    const inds = listar();
    const contagem = { atingido: 0, atencao: 0, desvio: 0, sem_medicao: 0 };
    inds.forEach((i) => { contagem[i.ultima_medicao?.status || 'sem_medicao'] += 1; });
    const planos = listarPlanos();
    const alertas = [];
    for (const i of inds) {
      const serie = db.prepare('SELECT valor FROM ind_medicoes WHERE indicador_id=? ORDER BY periodo').all(i.id).map((m) => m.valor);
      const c = calc.cep(serie.slice(-24));
      if (c.ultimo_instavel) alertas.push({ tipo: 'instabilidade', gravidade: 'media', indicador_id: i.id,
        mensagem: `${i.nome}: último valor indica processo fora de controle estatístico (${c.pontos.at(-1).sinais.join(', ')})` });
      if (i.analises_pendentes) alertas.push({ tipo: 'analise_pendente', gravidade: 'alta', indicador_id: i.id,
        mensagem: `${i.nome}: ${i.analises_pendentes} desvio(s) sem análise de causa` });
    }
    for (const p of planos) {
      if (p.acoes_atrasadas && !['concluido', 'cancelado'].includes(p.status)) alertas.push({ tipo: 'acao_atrasada', gravidade: 'media',
        plano_id: p.id, indicador_id: p.indicador_id, mensagem: `Plano "${p.titulo}": ${p.acoes_atrasadas} ação(ões) atrasada(s)` });
      if (p.status === 'concluido' && p.eficacia === 'pendente') alertas.push({ tipo: 'eficacia_pendente', gravidade: 'baixa',
        plano_id: p.id, indicador_id: p.indicador_id, mensagem: `Plano "${p.titulo}" concluído aguardando verificação de eficácia` });
    }
    const porDepartamento = {};
    for (const i of inds) {
      const d = (porDepartamento[i.departamento_id] ||= { departamento_id: i.departamento_id, departamento: i.departamento, total: 0, atingido: 0, atencao: 0, desvio: 0, sem_medicao: 0 });
      d.total += 1; d[i.ultima_medicao?.status || 'sem_medicao'] += 1;
    }
    return {
      total_indicadores: inds.length,
      status: contagem,
      planos: {
        abertos: planos.filter((p) => ['aberto', 'em_andamento'].includes(p.status)).length,
        concluidos: planos.filter((p) => p.status === 'concluido').length,
        eficazes: planos.filter((p) => p.eficacia === 'eficaz').length,
        com_atraso: planos.filter((p) => p.acoes_atrasadas > 0 && !['concluido', 'cancelado'].includes(p.status)).length,
      },
      por_departamento: Object.values(porDepartamento),
      alertas,
    };
  }

  // ---------------- API pública para outros módulos ----------------
  // Outros módulos (ex.: Metas) consomem SOMENTE estas funções, nunca as tabelas ind_*.
  const api = {
    listarResumo: () => db.prepare(`SELECT id, codigo, nome, unidade, polaridade, departamento_id FROM ind_indicadores WHERE ativo=1 ORDER BY nome`).all(),
    existe: (id) => !!db.prepare('SELECT 1 FROM ind_indicadores WHERE id=?').get(id),
    contarPeriodos: (id, inicio, fim) => db.prepare('SELECT COUNT(*) n FROM ind_medicoes WHERE indicador_id=? AND periodo BETWEEN ? AND ?').get(id, inicio, fim).n,
    /** Agrega os valores medidos entre dois períodos (AAAA-MM) usando soma | media | ultimo. */
    agregar(id, inicio, fim, agregacao = 'ultimo') {
      const vals = db.prepare(`SELECT valor FROM ind_medicoes WHERE indicador_id=? AND periodo BETWEEN ? AND ? ORDER BY periodo`)
        .all(id, inicio, fim).map((r) => r.valor);
      if (!vals.length) return null;
      if (agregacao === 'soma') return vals.reduce((a, b) => a + b, 0);
      if (agregacao === 'media') return vals.reduce((a, b) => a + b, 0) / vals.length;
      return vals[vals.length - 1];
    },
  };

  // Permite que comentários/anexos do núcleo saibam a qual departamento cada registro pertence
  const deptoInd = (id) => db.prepare('SELECT departamento_id d FROM ind_indicadores WHERE id=?').get(id)?.d;
  core.registrarEntidade('indicadores', 'indicador', deptoInd);
  core.registrarEntidade('indicadores', 'medicao', (id) => deptoInd(db.prepare('SELECT indicador_id i FROM ind_medicoes WHERE id=?').get(id)?.i));
  core.registrarEntidade('indicadores', 'analise', (id) => deptoInd(db.prepare('SELECT m.indicador_id i FROM ind_analises a JOIN ind_medicoes m ON m.id=a.medicao_id WHERE a.id=?').get(id)?.i));
  core.registrarEntidade('indicadores', 'plano', (id) => deptoInd(db.prepare('SELECT indicador_id i FROM ind_planos WHERE id=?').get(id)?.i));

  return {
    db, metaVigente, recalcularIndicador, porCodigo,
    listarMetasPeriodo, salvarMetaPeriodo, excluirMetaPeriodo, listarVersoes, cartaControle,
    salvarObjetivo, excluirObjetivo, mapaEstrategico, listarPerspectivas, salvarPerspectivas,
    listar, obter, salvar, excluir, listarResponsaveis,
    listarMedicoes, registrarMedicao, excluirMedicao,
    listarAnalises, obterAnalise, registrarAnalise, excluirAnalise,
    listarPlanos, obterPlano, criarPlano, atualizarPlano, excluirPlano,
    adicionarAcao, atualizarAcao, excluirAcao,
    painel, api,
  };
}

module.exports = { criarIndicadoresService, POLARIDADES, TECNICAS, CATEGORIAS_6M, PERSPECTIVAS, CAMPOS_A3 };
