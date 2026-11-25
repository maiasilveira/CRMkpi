'use strict';
// Colaboradores, participação no programa, metas individuais e bônus por colaborador.
const E = require('../../core/erros');
const { usuarioAtual } = require('../../core/contexto');
const { lerPlanilha, numeroDe } = require('../../core/planilha');
const { transacao } = require('../../db');
const calc = require('./calculo');

function criarPessoasService(db, core, metas) {
  const audit = (ent, id, acao, dados) => core.auditar('metas', ent, id, acao, dados);
  // Remuneração é dado sensível: salário, bônus-alvo e bônus individual só para admin e quem tem a permissão
  // "ver_remuneracao" (bônus-alvo = salário × múltiplo × pró-rata, então também revela o salário).
  const veSalario = () => core.podeVerRemuneracao();
  const ocultar = (c) => (veSalario() ? c : { ...c, salario: undefined, bonus_alvo: undefined, bonus: undefined, remuneracao_restrita: true });

  // ---------- Colaboradores ----------
  function listarColaboradores({ departamento_id, todos } = {}) {
    const f = core.filtroEscopo('c.departamento_id');
    const cond = [];
    const args = [];
    if (departamento_id) { cond.push('c.departamento_id=?'); args.push(Number(departamento_id)); }
    if (!todos) cond.push('c.ativo=1');
    return db.prepare(`SELECT c.*, d.nome AS departamento FROM met_colaboradores c JOIN departamentos d ON d.id=c.departamento_id
        WHERE 1=1 ${cond.length ? 'AND ' + cond.join(' AND ') : ''} ${f.sql} ORDER BY c.nome`).all(...args, ...f.args).map(ocultar);
  }
  function obterColaborador(id) {
    const c = db.prepare('SELECT c.*, d.nome AS departamento FROM met_colaboradores c JOIN departamentos d ON d.id=c.departamento_id WHERE c.id=?').get(id);
    if (!c) throw new E.NaoEncontrado('Colaborador');
    core.garantirVer(c.departamento_id);
    return ocultar(c);
  }
  function normalizar(d) {
    const c = {
      matricula: E.texto(d.matricula, 'matricula', { obrigatorio: true }),
      nome: E.texto(d.nome, 'nome', { obrigatorio: true }),
      email: E.texto(d.email, 'email'),
      departamento_id: E.numero(d.departamento_id, 'departamento_id', { obrigatorio: true }),
      cargo: E.texto(d.cargo, 'cargo'),
      salario: E.numero(d.salario, 'salario') ?? 0,
      admissao: E.data(d.admissao, 'admissao', { obrigatorio: true }),
      desligamento: E.data(d.desligamento, 'desligamento'),
      ativo: d.ativo === undefined ? 1 : (d.ativo ? 1 : 0),
    };
    E.exigir(c.salario >= 0, 'Salário deve ser ≥ 0');
    E.exigir(!c.desligamento || c.desligamento >= c.admissao, 'Desligamento anterior à admissão');
    core.obterDepartamento(c.departamento_id);
    return c;
  }
  function salvarColaborador(d, id) {
    core.exigirPerfil('diretoria');
    const temSalario = d.salario !== undefined && d.salario !== null && d.salario !== '';
    if (!veSalario()) {
      // Sem acesso à remuneração: não informa salário; numa alteração, o salário atual é mantido.
      E.exigir(!temSalario, 'Informar salário exige acesso à remuneração. Remova o salário ou peça a quem tem esse acesso.', 403);
      d = { ...d, salario: id ? db.prepare('SELECT salario FROM met_colaboradores WHERE id=?').get(id)?.salario : 0 };
    }
    const c = normalizar(d);
    const dup = db.prepare('SELECT id FROM met_colaboradores WHERE matricula=? AND id IS NOT ?').get(c.matricula, id ?? null);
    E.exigir(!dup, 'Matrícula já cadastrada');
    const cols = Object.keys(c);
    if (id) {
      obterColaborador(id);
      db.prepare(`UPDATE met_colaboradores SET ${cols.map((k) => k + '=?').join(',')} WHERE id=?`).run(...cols.map((k) => c[k]), id);
      db.prepare('UPDATE met_metas SET departamento_id=? WHERE colaborador_id=?').run(c.departamento_id, id);
      audit('colaborador', id, 'atualizar', { ...c, salario: '***' });
      return obterColaborador(id);
    }
    const r = db.prepare(`INSERT INTO met_colaboradores (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((k) => c[k]));
    audit('colaborador', Number(r.lastInsertRowid), 'criar', { ...c, salario: '***' });
    return obterColaborador(Number(r.lastInsertRowid));
  }

  /** Planilha: matricula, nome, email, departamento (nome ou sigla), cargo, salario, admissao, desligamento */
  async function importarColaboradores(nome, conteudo, { simular = false } = {}) {
    core.exigirPerfil('diretoria');
    const linhas = await lerPlanilha(nome, conteudo);
    const deptos = db.prepare('SELECT id, nome, sigla FROM departamentos').all();
    const dataDe = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : (/^(\d{2})\/(\d{2})\/(\d{4})$/.test(String(v ?? '').trim())
      ? String(v).trim().replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, '$3-$2-$1') : (v ? String(v).trim() : null)));
    const resultado = [];
    const executar = () => {
      for (const { linha, dados } of linhas) {
        try {
          const ref = String(dados.departamento ?? '').trim().toLowerCase();
          const dep = deptos.find((d) => d.nome.toLowerCase() === ref || (d.sigla || '').toLowerCase() === ref);
          E.exigir(dep, `Departamento "${dados.departamento}" não encontrado`);
          const reg = { matricula: dados.matricula != null ? String(dados.matricula) : '', nome: dados.nome, email: dados.email, departamento_id: dep.id, cargo: dados.cargo,
            salario: numeroDe(dados.salario), admissao: dataDe(dados.admissao), desligamento: dataDe(dados.desligamento) };
          const existente = db.prepare('SELECT id FROM met_colaboradores WHERE matricula=?').get(reg.matricula);
          if (!veSalario() && reg.salario !== null && reg.salario !== undefined) {
            throw new E.ErroValidacao('Coluna "salario" exige acesso à remuneração — remova a coluna da planilha', 403);
          }
          if (simular) { normalizar(reg); resultado.push({ linha, ok: true, matricula: reg.matricula, acao: existente ? 'atualizar' : 'criar' }); } else {
            salvarColaborador(reg, existente?.id);
            resultado.push({ linha, ok: true, matricula: reg.matricula, acao: existente ? 'atualizado' : 'criado' });
          }
        } catch (e) { resultado.push({ linha, ok: false, erro: e.message }); }
      }
    };
    if (simular) executar(); else transacao(db, executar);
    const ok = resultado.filter((r) => r.ok).length;
    return { simulacao: simular, total: resultado.length, importadas: ok, erros: resultado.length - ok, linhas: resultado };
  }

  // ---------- Participação no ciclo ----------
  function listarParticipacoes(cicloId) {
    const ciclo = metas.obterCiclo(cicloId);
    const f = core.filtroEscopo('c.departamento_id');
    return db.prepare(`SELECT p.*, c.nome, c.matricula, c.departamento_id, c.salario, c.admissao, c.desligamento, d.nome AS departamento
        FROM met_participacoes p JOIN met_colaboradores c ON c.id=p.colaborador_id JOIN departamentos d ON d.id=c.departamento_id
        WHERE p.ciclo_id=? ${f.sql} ORDER BY d.nome, c.nome`).all(cicloId, ...f.args)
      .map((p) => ocultar({ ...p, peso_departamento: p.peso_departamento ?? ciclo.peso_departamento_padrao }));
  }
  function salvarParticipacao(cicloId, colaboradorId, d) {
    core.exigirPerfil('diretoria');
    const ciclo = metas.obterCiclo(cicloId);
    E.exigir(ciclo.status !== 'encerrado', 'Ciclo encerrado');
    obterColaborador(colaboradorId);
    const p = { multiplo: E.numero(d.multiplo_salarios, 'multiplo_salarios') ?? 1, peso: E.numero(d.peso_departamento, 'peso_departamento'),
      faltas: E.numero(d.faltas, 'faltas') ?? 0, adv: E.numero(d.advertencias, 'advertencias') ?? 0 };
    E.exigir(p.multiplo >= 0, 'Múltiplo deve ser ≥ 0');
    E.exigir(p.peso === null || (p.peso >= 0 && p.peso <= 100), 'Peso do departamento deve estar entre 0 e 100');
    E.exigir(p.faltas >= 0 && p.adv >= 0, 'Faltas e advertências devem ser ≥ 0');
    db.prepare(`INSERT INTO met_participacoes (ciclo_id, colaborador_id, multiplo_salarios, peso_departamento, faltas, advertencias) VALUES (?,?,?,?,?,?)
        ON CONFLICT(ciclo_id, colaborador_id) DO UPDATE SET multiplo_salarios=excluded.multiplo_salarios, peso_departamento=excluded.peso_departamento,
        faltas=excluded.faltas, advertencias=excluded.advertencias`).run(cicloId, colaboradorId, p.multiplo, p.peso, p.faltas, p.adv);
    audit('participacao', colaboradorId, 'salvar', { cicloId, ...p });
    return listarParticipacoes(cicloId).find((x) => x.colaborador_id === colaboradorId);
  }
  /** Inclui no ciclo todos os colaboradores ativos ainda não participantes. */
  function incluirTodos(cicloId, multiplo = 1) {
    core.exigirPerfil('diretoria');
    const ciclo = metas.obterCiclo(cicloId);
    const r = db.prepare(`INSERT OR IGNORE INTO met_participacoes (ciclo_id, colaborador_id, multiplo_salarios)
        SELECT ?, id, ? FROM met_colaboradores WHERE ativo=1 AND admissao <= ? AND (desligamento IS NULL OR desligamento >= ?)`)
      .run(cicloId, Number(multiplo) || 1, ciclo.fim + '-31', ciclo.inicio + '-01');
    audit('participacao', null, 'incluir_todos', { cicloId, incluidos: r.changes });
    return { incluidos: r.changes };
  }
  function removerParticipacao(cicloId, colaboradorId) {
    core.exigirPerfil('diretoria');
    db.prepare('DELETE FROM met_participacoes WHERE ciclo_id=? AND colaborador_id=?').run(cicloId, colaboradorId);
  }

  // ---------- Apuração individual ----------
  function apurarIndividuais(cicloId, apuracaoDepto) {
    const ciclo = metas.obterCiclo(cicloId);
    if (ciclo.status === 'encerrado' && ciclo.snapshot?.individuais) {
      return ciclo.snapshot.individuais.filter((i) => core.podeVer(i.departamento_id)).map(ocultar);
    }
    const ap = apuracaoDepto || metas.apurarCiclo(cicloId);
    const notas = Object.fromEntries(ap.departamentos.map((d) => [d.departamento_id, d.nota]));
    const gatilho = calc.gatilhoCorporativo(ciclo);
    return listarParticipacoes(cicloId).map((p) => {
      const col = db.prepare('SELECT * FROM met_colaboradores WHERE id=?').get(p.colaborador_id);
      const metasInd = metas.listarMetas({ ciclo_id: cicloId, colaborador_id: p.colaborador_id });
      const pesoInd = metasInd.reduce((s, m) => s + m.peso, 0);
      const notaInd = metasInd.length ? Math.round(metasInd.reduce((s, m) => s + (m.peso * (m.atingimento ?? 0)) / 100, 0) * 100) / 100 : null;
      const pr = calc.mesesElegiveis(col, ciclo.inicio, ciclo.fim, ciclo.dias_minimos_mes);
      const r = calc.bonusIndividual({ salario: col.salario, multiplo: p.multiplo_salarios, notaDepto: notas[col.departamento_id] ?? 0,
        notaIndividual: notaInd, pesoDepto: p.peso_departamento, prorata: pr.fator, faltas: p.faltas, advertencias: p.advertencias, ciclo, gatilhoOk: gatilho.atingido });
      return ocultar({ colaborador_id: col.id, matricula: col.matricula, nome: col.nome, email: col.email, departamento_id: col.departamento_id, departamento: p.departamento,
        salario: col.salario, multiplo_salarios: p.multiplo_salarios, meses_elegiveis: pr.elegiveis, meses_ciclo: pr.total,
        nota_departamento: notas[col.departamento_id] ?? 0, nota_individual: notaInd, pesos_individuais_validos: !metasInd.length || Math.abs(pesoInd - 100) < 0.001,
        peso_departamento: p.peso_departamento, faltas: p.faltas, advertencias: p.advertencias, metas: metasInd.map((m) => ({ id: m.id, nome: m.nome, peso: m.peso, atingimento: m.atingimento })),
        ...r });
    });
  }
  metas.extras.apurarIndividuais = apurarIndividuais;

  /** Bônus do próprio usuário (vinculado pelo e-mail). */
  function meuBonus(cicloId) {
    const u = usuarioAtual();
    E.exigir(u, 'Não autenticado');
    const col = db.prepare('SELECT * FROM met_colaboradores WHERE email=?').get(u.email);
    if (!col) return { vinculado: false };
    const ciclo = metas.obterCiclo(cicloId);
    // cálculo como "sistema" restrito ao próprio colaborador
    const item = require('../../core/contexto').executarComo(null, () => apurarIndividuais(cicloId).find((i) => i.colaborador_id === col.id));
    if (!item) return { vinculado: true, participa: false };
    return { vinculado: true, participa: true, ciclo: { id: ciclo.id, nome: ciclo.nome, status: ciclo.status }, ...item };
  }

  // ---------- Desdobramento ----------
  function arvoreMetas(cicloId) {
    const todas = metas.listarMetas({ ciclo_id: cicloId, individuais: 'todas' });
    const ids = new Set(todas.map((m) => m.id));
    const mapa = new Map(todas.map((m) => [m.id, { id: m.id, nome: m.nome, departamento: m.departamento, colaborador: m.colaborador || null,
      peso: m.peso, atingimento: m.atingimento, faixa: m.faixa, meta_pai_id: m.meta_pai_id, filhas: [] }]));
    const raizes = [];
    for (const n of mapa.values()) {
      if (n.meta_pai_id && ids.has(n.meta_pai_id)) mapa.get(n.meta_pai_id).filhas.push(n); else raizes.push(n);
    }
    return raizes;
  }

  function exportarIndividuaisCsv(cicloId) {
    core.exigirPerfil('diretoria');
    core.exigirRemuneracao();
    const lista = apurarIndividuais(cicloId);
    const esc = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const cab = ['Matrícula', 'Nome', 'Departamento', 'Salário', 'Múltiplo', 'Meses elegíveis', 'Nota depto', 'Nota individual', 'Nota final', 'Redutor %', 'Bônus-alvo', 'Bônus', 'Observações'];
    return '﻿' + [cab, ...lista.map((i) => [i.matricula, i.nome, i.departamento, i.salario, i.multiplo_salarios, `${i.meses_elegiveis}/${i.meses_ciclo}`,
      i.nota_departamento, i.nota_individual, i.nota_final, i.redutor_pct, i.bonus_alvo, i.bonus, i.motivos.join(', ')])].map((l) => l.map(esc).join(';')).join('\n');
  }

  core.registrarEntidade('metas', 'colaborador', (id) => db.prepare('SELECT departamento_id d FROM met_colaboradores WHERE id=?').get(id)?.d);

  return { listarColaboradores, obterColaborador, salvarColaborador, importarColaboradores, listarParticipacoes, salvarParticipacao,
    incluirTodos, removerParticipacao, apurarIndividuais, meuBonus, arvoreMetas, exportarIndividuaisCsv };
}

module.exports = { criarPessoasService };
