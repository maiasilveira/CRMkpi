'use strict';
const { NaoEncontrado, texto, exigir } = require('./erros');

function criarCoreService(db) {
  function auditar(modulo, entidade, entidadeId, acao, dados, usuario) {
    db.prepare(`INSERT INTO auditoria (modulo, entidade, entidade_id, acao, usuario, dados)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(modulo, entidade, entidadeId ?? null, acao, usuario || null, dados ? JSON.stringify(dados) : null);
  }

  function listarDepartamentos({ incluirInativos = false } = {}) {
    return db.prepare(`SELECT * FROM departamentos ${incluirInativos ? '' : 'WHERE ativo = 1'} ORDER BY nome`).all();
  }
  function obterDepartamento(id) {
    const d = db.prepare('SELECT * FROM departamentos WHERE id = ?').get(id);
    if (!d) throw new NaoEncontrado('Departamento');
    return d;
  }
  function salvarDepartamento(dados, id) {
    const nome = texto(dados.nome, 'nome', { obrigatorio: true });
    const sigla = texto(dados.sigla, 'sigla');
    const gestor = texto(dados.gestor, 'gestor');
    const ativo = dados.ativo === undefined ? 1 : (dados.ativo ? 1 : 0);
    const dup = db.prepare('SELECT id FROM departamentos WHERE nome = ? AND id IS NOT ?').get(nome, id ?? null);
    exigir(!dup, 'Já existe um departamento com esse nome');
    if (id) {
      obterDepartamento(id);
      db.prepare('UPDATE departamentos SET nome=?, sigla=?, gestor=?, ativo=? WHERE id=?').run(nome, sigla, gestor, ativo, id);
      auditar('core', 'departamento', id, 'atualizar', dados);
      return obterDepartamento(id);
    }
    const r = db.prepare('INSERT INTO departamentos (nome, sigla, gestor, ativo) VALUES (?,?,?,?)').run(nome, sigla, gestor, ativo);
    auditar('core', 'departamento', Number(r.lastInsertRowid), 'criar', dados);
    return obterDepartamento(Number(r.lastInsertRowid));
  }
  function listarAuditoria({ modulo, entidade, entidadeId, limite = 100 } = {}) {
    const cond = []; const args = [];
    if (modulo) { cond.push('modulo = ?'); args.push(modulo); }
    if (entidade) { cond.push('entidade = ?'); args.push(entidade); }
    if (entidadeId) { cond.push('entidade_id = ?'); args.push(Number(entidadeId)); }
    args.push(Math.min(Number(limite) || 100, 500));
    return db.prepare(`SELECT * FROM auditoria ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
                       ORDER BY id DESC LIMIT ?`).all(...args)
      .map((a) => ({ ...a, dados: a.dados ? JSON.parse(a.dados) : null }));
  }
  return { auditar, listarDepartamentos, obterDepartamento, salvarDepartamento, listarAuditoria };
}
module.exports = { criarCoreService };
