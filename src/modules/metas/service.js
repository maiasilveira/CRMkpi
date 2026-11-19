'use strict';
const { transacao } = require('../../db');
const E = require('../../core/erros');
const calc = require('./calculo');

const STATUS_CICLO = ['planejamento', 'ativo', 'encerrado'];
const AGREGACOES = ['soma', 'media', 'ultimo'];

/**
 * @param fonteIndicadores  API pública opcional do módulo Indicadores
 *                          ({ existe, agregar, listarResumo }). Se ausente, só metas manuais.
 */
function criarMetasService(db, core, fonteIndicadores = null) {
  const audit = (ent, id, acao, dados) => core.auditar('metas', ent, id, acao, dados);

  // ---------------- Ciclos ----------------
  function obterCiclo(id) {
    const c = db.prepare('SELECT * FROM met_ciclos WHERE id=?').get(id);
    if (!c) throw new E.NaoEncontrado('Ciclo');
    return { ...c, snapshot: c.snapshot ? JSON.parse(c.snapshot) : null };
  }
  const listarCiclos = () => db.prepare('SELECT id, nome, inicio, fim, status, nota_minima, encerrado_em FROM met_ciclos ORDER BY inicio DESC').all();

  function salvarCiclo(d, id) {
    const atual = id ? obterCiclo(id) : null;
    if (atual) E.exigir(atual.status !== 'encerrado', 'Ciclo encerrado não pode ser alterado');
    const c = {
      nome: E.texto(d.nome, 'nome', { obrigatorio: true }),
      inicio: E.periodo(d.inicio, 'inicio'),
      fim: E.periodo(d.fim, 'fim'),
      status: E.umDe(d.status, 'status', ['planejamento', 'ativo'], atual?.status || 'planejamento'),
      nota_minima: E.numero(d.nota_minima, 'nota_minima') ?? 0,
    };
    E.exigir(c.inicio <= c.fim, 'Início do ciclo deve ser anterior ao fim');
    E.exigir(c.nota_minima >= 0 && c.nota_minima <= 100, 'Nota mínima deve estar entre 0 e 100');
    const dup = db.prepare('SELECT id FROM met_ciclos WHERE nome=? AND id IS NOT ?').get(c.nome, id ?? null);
    E.exigir(!dup, 'Já existe um ciclo com esse nome');
    if (id) {
      db.prepare('UPDATE met_ciclos SET nome=?, inicio=?, fim=?, status=?, nota_minima=? WHERE id=?')
        .run(c.nome, c.inicio, c.fim, c.status, c.nota_minima, id);
      audit('ciclo', id, 'atualizar', c);
      return obterCiclo(id);
    }
    const r = db.prepare('INSERT INTO met_ciclos (nome, inicio, fim, status, nota_minima) VALUES (?,?,?,?,?)')
      .run(c.nome, c.inicio, c.fim, c.status, c.nota_minima);
    audit('ciclo', Number(r.lastInsertRowid), 'criar', c);
    return obterCiclo(Number(r.lastInsertRowid));
  }

  // ---------------- Bloqueios ----------------
  function statusBonus(cicloId, deptoId) {
    return db.prepare('SELECT * FROM met_bonus WHERE ciclo_id=? AND departamento_id=?').get(cicloId, deptoId);
  }
  function garantirEditavel(cicloId, deptoId) {
    const c = obterCiclo(cicloId);
    E.exigir(c.status !== 'encerrado', 'Ciclo encerrado: metas e resultados estão congelados');
    const b = statusBonus(cicloId, deptoId);
    E.exigir(!b || b.status === 'aberto', 'Apuração do departamento já foi submetida/aprovada. Reabra para editar.');
    return c;
  }

  // ---------------- Metas ----------------
  function normalizarMeta(d) {
    const m = {
      ciclo_id: E.numero(d.ciclo_id, 'ciclo_id', { obrigatorio: true }),
      departamento_id: E.numero(d.departamento_id, 'departamento_id', { obrigatorio: true }),
      nome: E.texto(d.nome, 'nome', { obrigatorio: true }),
      descricao: E.texto(d.descricao, 'descricao'),
      unidade: E.texto(d.unidade, 'unidade'),
      polaridade: E.umDe(d.polaridade, 'polaridade', ['maior_melhor', 'menor_melhor']),
      peso: E.numero(d.peso, 'peso', { obrigatorio: true }),
      gatilho: E.numero(d.gatilho, 'gatilho', { obrigatorio: true }),
      alvo: E.numero(d.alvo, 'alvo', { obrigatorio: true }),
      superacao: E.numero(d.superacao, 'superacao'),
      pct_gatilho: E.numero(d.pct_gatilho, 'pct_gatilho') ?? 50,
      pct_superacao: E.numero(d.pct_superacao, 'pct_superacao') ?? 120,
      fonte: E.umDe(d.fonte, 'fonte', ['manual', 'indicador'], 'manual'),
      indicador_id: E.numero(d.indicador_id, 'indicador_id'),
      agregacao: E.umDe(d.agregacao, 'agregacao', AGREGACOES, 'ultimo'),
      responsavel: E.texto(d.responsavel, 'responsavel'),
    };
    core.obterDepartamento(m.departamento_id);
    if (m.fonte === 'indicador') {
      E.exigir(fonteIndicadores, 'Módulo Indicadores não está ativo: use fonte "manual"');
      E.exigir(m.indicador_id && fonteIndicadores.existe(m.indicador_id), 'Indicador vinculado não encontrado');
    } else {
      m.indicador_id = null;
    }
    const erros = calc.validarMeta(m);
    if (erros.length) throw new E.ErroValidacao(erros.join('; '));
    return m;
  }

  function verificarPesos(cicloId, deptoId, metaId, novoPeso) {
    const soma = db.prepare('SELECT COALESCE(SUM(peso),0) s FROM met_metas WHERE ciclo_id=? AND departamento_id=? AND id IS NOT ?')
      .get(cicloId, deptoId, metaId ?? null).s;
    E.exigir(soma + novoPeso <= 100.0001, `A soma dos pesos do departamento ficaria em ${soma + novoPeso}% (máximo 100%)`);
  }

  function obterMeta(id) {
    const m = db.prepare(`SELECT m.*, d.nome AS departamento FROM met_metas m JOIN departamentos d ON d.id=m.departamento_id WHERE m.id=?`).get(id);
    if (!m) throw new E.NaoEncontrado('Meta');
    return m;
  }

  function salvarMeta(dados, id) {
    const m = normalizarMeta(dados);
    if (id) {
      const atual = obterMeta(id);
      garantirEditavel(atual.ciclo_id, atual.departamento_id);
    }
    garantirEditavel(m.ciclo_id, m.departamento_id);
    verificarPesos(m.ciclo_id, m.departamento_id, id, m.peso);
    const campos = Object.keys(m);
    if (id) {
      db.prepare(`UPDATE met_metas SET ${campos.map((c) => c + '=?').join(',')} WHERE id=?`).run(...campos.map((c) => m[c]), id);
      audit('meta', id, 'atualizar', m);
      return apurarMeta(obterMeta(id));
    }
    const r = db.prepare(`INSERT INTO met_metas (${campos.join(',')}) VALUES (${campos.map(() => '?').join(',')})`).run(...campos.map((c) => m[c]));
    audit('meta', Number(r.lastInsertRowid), 'criar', m);
    return apurarMeta(obterMeta(Number(r.lastInsertRowid)));
  }

  function excluirMeta(id) {
    const m = obterMeta(id);
    garantirEditavel(m.ciclo_id, m.departamento_id);
    db.prepare('DELETE FROM met_metas WHERE id=?').run(id);
    audit('meta', id, 'excluir');
  }

  // ---------------- Resultados ----------------
  function registrarResultado(metaId, d) {
    const m = obterMeta(metaId);
    const c = garantirEditavel(m.ciclo_id, m.departamento_id);
    E.exigir(m.fonte === 'manual', 'Meta vinculada a indicador: o resultado vem automaticamente do módulo Indicadores');
    const periodo = E.periodo(d.periodo);
    E.exigir(periodo >= c.inicio && periodo <= c.fim, `Período fora do ciclo (${c.inicio} a ${c.fim})`);
    const valor = E.numero(d.valor, 'valor', { obrigatorio: true });
    db.prepare(`INSERT INTO met_resultados (meta_id, periodo, valor, observacao) VALUES (?,?,?,?)
                ON CONFLICT(meta_id, periodo) DO UPDATE SET valor=excluded.valor, observacao=excluded.observacao`)
      .run(metaId, periodo, valor, E.texto(d.observacao, 'observacao'));
    audit('resultado', metaId, 'registrar', { periodo, valor });
    return apurarMeta(obterMeta(metaId));
  }

  function excluirResultado(metaId, periodo) {
    const m = obterMeta(metaId);
    garantirEditavel(m.ciclo_id, m.departamento_id);
    db.prepare('DELETE FROM met_resultados WHERE meta_id=? AND periodo=?').run(metaId, periodo);
    audit('resultado', metaId, 'excluir', { periodo });
    return apurarMeta(obterMeta(metaId));
  }

  // ---------------- Apuração ----------------
  function apurarMeta(m, ciclo = obterCiclo(m.ciclo_id)) {
    let valor = null; let resultados = [];
    if (m.fonte === 'indicador') {
      valor = fonteIndicadores ? fonteIndicadores.agregar(m.indicador_id, ciclo.inicio, ciclo.fim, m.agregacao) : null;
    } else {
      resultados = db.prepare('SELECT periodo, valor, observacao FROM met_resultados WHERE meta_id=? ORDER BY periodo').all(m.id);
      valor = calc.agregar(resultados.map((r) => r.valor), m.agregacao);
    }
    if (valor !== null) valor = Math.round(valor * 10000) / 10000;
    const ating = calc.atingimento(m, valor);
    return {
      ...m,
      resultados,
      valor_apurado: valor,
      projecao: m.agregacao === 'soma' ? projetar(m, ciclo, valor) : null,
      atingimento: ating === null ? null : Math.round(ating * 100) / 100,
      contribuicao: ating === null ? 0 : Math.round(m.peso * ating) / 100,
      faixa: ating === null ? 'sem_resultado' : ating === 0 ? 'abaixo_gatilho' : ating < 100 ? 'parcial' : ating === 100 ? 'atingida' : 'superada',
    };
  }

  /** Projeção linear do acumulado até o fim do ciclo, com base nos meses já apurados. */
  function projetar(m, ciclo, valor) {
    if (valor === null) return null;
    const periodos = m.fonte === 'manual'
      ? db.prepare('SELECT COUNT(*) n FROM met_resultados WHERE meta_id=?').get(m.id).n
      : (fonteIndicadores?.contarPeriodos?.(m.indicador_id, ciclo.inicio, ciclo.fim) ?? 0);
    const total = mesesEntre(ciclo.inicio, ciclo.fim);
    if (!periodos || periodos >= total) return null;
    const v = (valor / periodos) * total;
    const a = calc.atingimento(m, v);
    return { valor: Math.round(v * 100) / 100, atingimento: Math.round(a * 100) / 100, meses_apurados: periodos, meses_ciclo: total };
  }
  function mesesEntre(ini, fim) {
    const [a1, m1] = ini.split('-').map(Number); const [a2, m2] = fim.split('-').map(Number);
    return (a2 - a1) * 12 + (m2 - m1) + 1;
  }

  function listarMetas({ ciclo_id, departamento_id } = {}) {
    const cond = []; const args = [];
    if (ciclo_id) { cond.push('m.ciclo_id=?'); args.push(Number(ciclo_id)); }
    if (departamento_id) { cond.push('m.departamento_id=?'); args.push(Number(departamento_id)); }
    return db.prepare(`SELECT m.*, d.nome AS departamento FROM met_metas m JOIN departamentos d ON d.id=m.departamento_id
        ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY d.nome, m.peso DESC`).all(...args).map((m) => apurarMeta(m));
  }

  /** Scorecard do ciclo: nota de cada departamento e bônus. */
  function apurarCiclo(cicloId) {
    const ciclo = obterCiclo(cicloId);
    if (ciclo.status === 'encerrado' && ciclo.snapshot) return { ...ciclo.snapshot, congelado: true };
    const metas = listarMetas({ ciclo_id: cicloId });
    const deptos = new Map();
    for (const m of metas) {
      if (!deptos.has(m.departamento_id)) deptos.set(m.departamento_id, { departamento_id: m.departamento_id, departamento: m.departamento, metas: [] });
      deptos.get(m.departamento_id).metas.push(m);
    }
    // Inclui departamentos com bônus configurado mas ainda sem metas
    for (const b of db.prepare(`SELECT b.departamento_id, d.nome FROM met_bonus b JOIN departamentos d ON d.id=b.departamento_id WHERE ciclo_id=?`).all(cicloId)) {
      if (!deptos.has(b.departamento_id)) deptos.set(b.departamento_id, { departamento_id: b.departamento_id, departamento: b.nome, metas: [] });
    }
    const departamentos = [...deptos.values()].map((d) => {
      const b = statusBonus(cicloId, d.departamento_id) || { valor_base: 0, status: 'aberto' };
      return { ...d, ...calc.notaDepartamento(d.metas, { valor_base: b.valor_base, nota_minima: ciclo.nota_minima }),
        valor_base: b.valor_base, status_apuracao: b.status, aprovado_por: b.aprovado_por || null, aprovado_em: b.aprovado_em || null };
    }).sort((a, b) => a.departamento.localeCompare(b.departamento));
    const totalBase = departamentos.reduce((s, d) => s + d.valor_base, 0);
    const totalBonus = departamentos.reduce((s, d) => s + d.bonus, 0);
    return {
      ciclo: { id: ciclo.id, nome: ciclo.nome, inicio: ciclo.inicio, fim: ciclo.fim, status: ciclo.status, nota_minima: ciclo.nota_minima },
      departamentos,
      totais: {
        valor_base: totalBase,
        bonus: Math.round(totalBonus * 100) / 100,
        pct_pago: totalBase ? Math.round((totalBonus / totalBase) * 10000) / 100 : 0,
        nota_media: departamentos.length ? Math.round((departamentos.reduce((s, d) => s + d.nota, 0) / departamentos.length) * 100) / 100 : 0,
      },
      congelado: false,
    };
  }

  // ---------------- Bônus e aprovação ----------------
  function definirBonus(cicloId, deptoId, d) {
    garantirEditavel(cicloId, deptoId);
    core.obterDepartamento(deptoId);
    const valor = E.numero(d.valor_base, 'valor_base', { obrigatorio: true });
    E.exigir(valor >= 0, 'Valor base deve ser ≥ 0');
    db.prepare(`INSERT INTO met_bonus (ciclo_id, departamento_id, valor_base) VALUES (?,?,?)
                ON CONFLICT(ciclo_id, departamento_id) DO UPDATE SET valor_base=excluded.valor_base`).run(cicloId, deptoId, valor);
    audit('bonus', deptoId, 'definir', { cicloId, valor });
    return apurarCiclo(cicloId);
  }

  function transicionar(cicloId, deptoId, acao, usuario) {
    const ciclo = obterCiclo(cicloId);
    E.exigir(ciclo.status !== 'encerrado', 'Ciclo encerrado');
    db.prepare(`INSERT OR IGNORE INTO met_bonus (ciclo_id, departamento_id) VALUES (?,?)`).run(cicloId, deptoId);
    const b = statusBonus(cicloId, deptoId);
    const fluxo = { submeter: ['aberto', 'submetido'], aprovar: ['submetido', 'aprovado'], reabrir: [null, 'aberto'] };
    E.exigir(fluxo[acao], 'Ação inválida (use submeter, aprovar ou reabrir)');
    const [de, para] = fluxo[acao];
    if (de) E.exigir(b.status === de, `Só é possível ${acao} uma apuração com status "${de}" (atual: "${b.status}")`);
    if (acao === 'submeter') {
      const pesos = db.prepare('SELECT COALESCE(SUM(peso),0) s FROM met_metas WHERE ciclo_id=? AND departamento_id=?').get(cicloId, deptoId).s;
      E.exigir(Math.abs(pesos - 100) < 0.001, `A soma dos pesos das metas deve ser 100% (atual: ${pesos}%)`);
    }
    db.prepare('UPDATE met_bonus SET status=?, aprovado_por=?, aprovado_em=? WHERE id=?')
      .run(para, acao === 'aprovar' ? (usuario || 'aprovador') : null, acao === 'aprovar' ? new Date().toISOString() : null, b.id);
    audit('apuracao', deptoId, acao, { cicloId, usuario });
    return apurarCiclo(cicloId);
  }

  function encerrarCiclo(cicloId) {
    const ciclo = obterCiclo(cicloId);
    E.exigir(ciclo.status !== 'encerrado', 'Ciclo já encerrado');
    const ap = apurarCiclo(cicloId);
    const pendentes = ap.departamentos.filter((d) => d.status_apuracao !== 'aprovado').map((d) => d.departamento);
    E.exigir(!pendentes.length, `Há apurações não aprovadas: ${pendentes.join(', ')}`);
    return transacao(db, () => {
      const snap = { ...ap, ciclo: { ...ap.ciclo, status: 'encerrado' } };
      db.prepare(`UPDATE met_ciclos SET status='encerrado', encerrado_em=datetime('now'), snapshot=? WHERE id=?`).run(JSON.stringify(snap), cicloId);
      audit('ciclo', cicloId, 'encerrar', ap.totais);
      return apurarCiclo(cicloId);
    });
  }

  /** Simulação "e se": calcula atingimento/bônus para valores hipotéticos sem gravar nada. */
  function simular(cicloId, deptoId, valores = {}) {
    const ciclo = obterCiclo(cicloId);
    const metas = listarMetas({ ciclo_id: cicloId, departamento_id: deptoId }).map((m) => {
      const v = valores[m.id] !== undefined && valores[m.id] !== '' ? Number(valores[m.id]) : m.valor_apurado;
      const a = calc.atingimento(m, v);
      return { id: m.id, nome: m.nome, peso: m.peso, valor: v, atingimento: a === null ? null : Math.round(a * 100) / 100 };
    });
    const b = statusBonus(cicloId, deptoId) || { valor_base: 0 };
    return { metas, ...calc.notaDepartamento(metas, { valor_base: b.valor_base, nota_minima: ciclo.nota_minima }) };
  }

  function exportarCsv(cicloId) {
    const ap = apurarCiclo(cicloId);
    const esc = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const linhas = [['Departamento', 'Meta', 'Peso', 'Gatilho', 'Alvo', 'Superação', 'Resultado', 'Atingimento %', 'Contribuição', 'Nota Depto', 'Bônus Base', 'Bônus Calculado', 'Status Apuração']];
    for (const d of ap.departamentos) {
      for (const m of d.metas) {
        linhas.push([d.departamento, m.nome, m.peso, m.gatilho, m.alvo, m.superacao, m.valor_apurado, m.atingimento, m.contribuicao, d.nota, d.valor_base, d.bonus, d.status_apuracao]);
      }
    }
    return '﻿' + linhas.map((l) => l.map(esc).join(';')).join('\n');
  }

  return {
    listarCiclos, obterCiclo, salvarCiclo, encerrarCiclo,
    listarMetas, obterMeta: (id) => apurarMeta(obterMeta(id)), salvarMeta, excluirMeta,
    registrarResultado, excluirResultado,
    apurarCiclo, definirBonus, transicionar, simular, exportarCsv,
    indicadoresDisponiveis: () => (fonteIndicadores ? fonteIndicadores.listarResumo() : []),
  };
}

module.exports = { criarMetasService, STATUS_CICLO };
