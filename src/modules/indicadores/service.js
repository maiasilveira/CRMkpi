'use strict';
const { transacao } = require('../../db');
const E = require('../../core/erros');
const calc = require('./calculo');

const POLARIDADES = ['maior_melhor', 'menor_melhor', 'faixa'];
const FREQUENCIAS = ['mensal', 'bimestral', 'trimestral', 'semestral', 'anual'];
const TECNICAS = ['5w2h', '5porques', 'ishikawa'];
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
    };
    core.obterDepartamento(ind.departamento_id);
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

  function listar({ departamento_id, status, todos } = {}) {
    const cond = []; const args = [];
    if (!todos) cond.push('i.ativo = 1');
    if (departamento_id) { cond.push('i.departamento_id = ?'); args.push(Number(departamento_id)); }
    const lista = db.prepare(`SELECT i.*, d.nome AS departamento FROM ind_indicadores i
        JOIN departamentos d ON d.id = i.departamento_id
        ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY d.nome, i.nome`).all(...args).map(enriquecer);
    return status ? lista.filter((i) => i.ultima_medicao?.status === status) : lista;
  }

  function obter(id) {
    const ind = db.prepare(`SELECT i.*, d.nome AS departamento FROM ind_indicadores i
        JOIN departamentos d ON d.id = i.departamento_id WHERE i.id = ?`).get(id);
    if (!ind) throw new E.NaoEncontrado('Indicador');
    return enriquecer(ind);
  }

  function salvar(dados, id) {
    const ind = normalizarIndicador(dados);
    if (ind.codigo) {
      const dup = db.prepare('SELECT id FROM ind_indicadores WHERE codigo=? AND id IS NOT ?').get(ind.codigo, id ?? null);
      E.exigir(!dup, 'Já existe um indicador com esse código');
    }
    const campos = Object.keys(ind);
    if (id) {
      obter(id);
      db.prepare(`UPDATE ind_indicadores SET ${campos.map((c) => c + '=?').join(',')} WHERE id=?`)
        .run(...campos.map((c) => ind[c]), id);
      audit('indicador', id, 'atualizar', ind);
      return obter(id);
    }
    const r = db.prepare(`INSERT INTO ind_indicadores (${campos.join(',')}) VALUES (${campos.map(() => '?').join(',')})`)
      .run(...campos.map((c) => ind[c]));
    audit('indicador', Number(r.lastInsertRowid), 'criar', ind);
    return obter(Number(r.lastInsertRowid));
  }

  function excluir(id) {
    obter(id);
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
  function registrarMedicao(indicadorId, dados) {
    const ind = obter(indicadorId);
    const periodo = E.periodo(dados.periodo);
    const valor = E.numero(dados.valor, 'valor', { obrigatorio: true });
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
    return { ...med, exige_analise: status === 'desvio' };
  }

  function excluirMedicao(medicaoId) {
    const m = db.prepare('SELECT id FROM ind_medicoes WHERE id=?').get(medicaoId);
    if (!m) throw new E.NaoEncontrado('Medição');
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
    return { ...a, conteudo: JSON.parse(a.conteudo) };
  }

  function listarAnalises(indicadorId) {
    return db.prepare(`SELECT a.id FROM ind_analises a JOIN ind_medicoes m ON m.id=a.medicao_id
        WHERE m.indicador_id=? ORDER BY m.periodo DESC, a.id DESC`).all(indicadorId).map((r) => obterAnalise(r.id));
  }

  function registrarAnalise(medicaoId, dados) {
    const med = db.prepare('SELECT * FROM ind_medicoes WHERE id=?').get(medicaoId);
    if (!med) throw new E.NaoEncontrado('Medição');
    const tecnica = E.umDe(dados.tecnica, 'tecnica', TECNICAS);
    const conteudo = validarConteudo(tecnica, dados.conteudo);
    const causa = E.texto(dados.causa_raiz, 'causa_raiz')
      || (tecnica === '5porques' ? conteudo.porques[conteudo.porques.length - 1] : null);
    const r = db.prepare('INSERT INTO ind_analises (medicao_id, tecnica, conteudo, causa_raiz, responsavel) VALUES (?,?,?,?,?)')
      .run(medicaoId, tecnica, JSON.stringify(conteudo), causa, E.texto(dados.responsavel, 'responsavel'));
    const id = Number(r.lastInsertRowid);
    audit('analise', id, 'criar', { medicaoId, tecnica });
    return obterAnalise(id);
  }

  function excluirAnalise(id) {
    obterAnalise(id);
    db.prepare('DELETE FROM ind_analises WHERE id=?').run(id);
    audit('analise', id, 'excluir');
  }

  // ---------------- Planos de ação (5W2H) ----------------
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
    const acoes = db.prepare('SELECT * FROM ind_acoes WHERE plano_id=? ORDER BY quando, id').all(id).map(decorarAcao);
    const validas = acoes.filter((a) => a.status !== 'cancelada');
    const concl = validas.filter((a) => a.status === 'concluida').length;
    return {
      ...p,
      acoes,
      progresso: validas.length ? Math.round((concl / validas.length) * 100) : 0,
      acoes_atrasadas: acoes.filter((a) => a.atrasada).length,
      custo_total: acoes.reduce((s, a) => s + (a.status !== 'cancelada' ? a.quanto || 0 : 0), 0),
      prazo_final: validas.reduce((m, a) => (a.quando > m ? a.quando : m), ''),
    };
  }

  function listarPlanos({ indicador_id, departamento_id, status, atrasados } = {}) {
    const cond = []; const args = [];
    if (indicador_id) { cond.push('p.indicador_id=?'); args.push(Number(indicador_id)); }
    if (departamento_id) { cond.push('i.departamento_id=?'); args.push(Number(departamento_id)); }
    if (status) { cond.push('p.status=?'); args.push(status); }
    let planos = db.prepare(`SELECT p.id FROM ind_planos p JOIN ind_indicadores i ON i.id=p.indicador_id
        ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY p.id DESC`).all(...args).map((r) => obterPlano(r.id));
    if (atrasados === '1' || atrasados === true) planos = planos.filter((p) => p.acoes_atrasadas > 0);
    return planos;
  }

  function criarPlano(dados) {
    const indicadorId = E.numero(dados.indicador_id, 'indicador_id', { obrigatorio: true });
    obter(indicadorId);
    const analiseId = E.numero(dados.analise_id, 'analise_id');
    if (analiseId) {
      const a = obterAnalise(analiseId);
      E.exigir(a.indicador_id === indicadorId, 'A análise informada não pertence a este indicador');
    }
    const acoes = (Array.isArray(dados.acoes) ? dados.acoes : []).map(normalizarAcao);
    return transacao(db, () => {
      const r = db.prepare('INSERT INTO ind_planos (indicador_id, analise_id, titulo, objetivo, responsavel, eficacia) VALUES (?,?,?,?,?,?)')
        .run(indicadorId, analiseId, E.texto(dados.titulo, 'titulo', { obrigatorio: true }),
          E.texto(dados.objetivo, 'objetivo'), E.texto(dados.responsavel, 'responsavel'), 'pendente');
      const id = Number(r.lastInsertRowid);
      for (const a of acoes) inserirAcao(id, a);
      if (acoes.some((a) => a.status !== 'pendente')) db.prepare(`UPDATE ind_planos SET status='em_andamento' WHERE id=?`).run(id);
      audit('plano', id, 'criar', { indicadorId, analiseId, acoes: acoes.length });
      return obterPlano(id);
    });
  }

  function atualizarPlano(id, dados) {
    const p = obterPlano(id);
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
    audit('plano', id, 'atualizar', { status, eficacia });
    return obterPlano(id);
  }

  function excluirPlano(id) {
    obterPlano(id);
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
    E.exigir(!['concluido', 'cancelado'].includes(p.status), 'Plano encerrado não aceita novas ações');
    const id = inserirAcao(planoId, normalizarAcao(dados));
    if (p.status === 'aberto') db.prepare(`UPDATE ind_planos SET status='em_andamento' WHERE id=?`).run(planoId);
    audit('acao', id, 'criar', dados);
    return obterPlano(planoId);
  }

  function atualizarAcao(acaoId, dados) {
    const atual = db.prepare('SELECT * FROM ind_acoes WHERE id=?').get(acaoId);
    if (!atual) throw new E.NaoEncontrado('Ação');
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
    db.prepare('DELETE FROM ind_acoes WHERE id=?').run(acaoId);
    audit('acao', acaoId, 'excluir');
    return obterPlano(atual.plano_id);
  }

  // ---------------- Painel / alertas ----------------
  function painel() {
    const inds = listar();
    const contagem = { atingido: 0, atencao: 0, desvio: 0, sem_medicao: 0 };
    inds.forEach((i) => { contagem[i.ultima_medicao?.status || 'sem_medicao'] += 1; });
    const planos = listarPlanos();
    const alertas = [];
    for (const i of inds) {
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

  return {
    listar, obter, salvar, excluir,
    listarMedicoes, registrarMedicao, excluirMedicao,
    listarAnalises, obterAnalise, registrarAnalise, excluirAnalise,
    listarPlanos, obterPlano, criarPlano, atualizarPlano, excluirPlano,
    adicionarAcao, atualizarAcao, excluirAcao,
    painel, api,
  };
}

module.exports = { criarIndicadoresService, POLARIDADES, TECNICAS, CATEGORIAS_6M };
