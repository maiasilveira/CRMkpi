'use strict';
const { EventEmitter } = require('node:events');
const E = require('./erros');
const { usuarioAtual } = require('./contexto');
const { hashSenha, conferirSenha, tokenAleatorio, sha256 } = require('./senhas');

const PERFIS = ['admin', 'diretoria', 'gestor', 'colaborador'];
const TIPOS_DEPTO = ['empresa', 'diretoria', 'departamento'];
const SEGREDOS = ['smtp_senha'];
const SESSAO_HORAS = Number(process.env.SESSAO_HORAS) || 12;

function criarCoreService(db) {
  const eventos = new EventEmitter();
  eventos.setMaxListeners(50);

  // ================= Auditoria =================
  function auditar(modulo, entidade, entidadeId, acao, dados, usuario) {
    const u = usuario || usuarioAtual()?.email || 'sistema';
    db.prepare(`INSERT INTO auditoria (modulo, entidade, entidade_id, acao, usuario, dados) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(modulo, entidade, entidadeId ?? null, acao, u, dados ? JSON.stringify(dados) : null);
  }

  // ================= Controle de acesso =================
  const VE_TUDO = ['admin', 'diretoria'];
  function descendentes(id) {
    return db.prepare(`WITH RECURSIVE arv(id) AS (SELECT ? UNION ALL SELECT d.id FROM departamentos d JOIN arv ON d.pai_id = arv.id)
                       SELECT id FROM arv`).all(id).map((r) => r.id);
  }
  /** Departamentos visíveis ao usuário atual (null = todos). */
  function deptosVisiveis(usuario = usuarioAtual()) {
    if (!usuario || VE_TUDO.includes(usuario.perfil)) return null;
    return usuario.departamento_id ? descendentes(usuario.departamento_id) : [];
  }
  const podeVer = (deptoId, u = usuarioAtual()) => { const v = deptosVisiveis(u); return v === null || v.includes(Number(deptoId)); };
  function podeEditar(deptoId, u = usuarioAtual()) {
    if (!u || VE_TUDO.includes(u.perfil)) return true;
    return u.perfil === 'gestor' && podeVer(deptoId, u);
  }
  function garantirVer(deptoId) { if (!podeVer(deptoId)) throw new E.ErroValidacao('Sem permissão para acessar dados deste departamento', 403); }
  function garantirEditar(deptoId) { if (!podeEditar(deptoId)) throw new E.ErroValidacao('Sem permissão para alterar dados deste departamento', 403); }
  function exigirPerfil(...perfis) {
    const u = usuarioAtual();
    if (!u || u.perfil === 'admin' || perfis.includes(u.perfil)) return;
    throw new E.ErroValidacao(`Ação restrita ao(s) perfil(is): ${['admin', ...perfis].join(', ')}`, 403);
  }
  /** Filtro SQL de escopo: retorna { sql, args } para "coluna IN (...)" ou vazio se vê tudo. */
  function filtroEscopo(coluna) {
    const v = deptosVisiveis();
    if (v === null) return { sql: '', args: [] };
    if (!v.length) return { sql: ' AND 0', args: [] };
    return { sql: ` AND ${coluna} IN (${v.map(() => '?').join(',')})`, args: v };
  }

  // Registro de entidades: permite que comentários/anexos descubram o departamento de qualquer entidade
  const entidades = new Map();
  const registrarEntidade = (modulo, entidade, resolver) => entidades.set(`${modulo}.${entidade}`, resolver);
  function departamentoDaEntidade(modulo, entidade, id) {
    const r = entidades.get(`${modulo}.${entidade}`);
    E.exigir(r, `Entidade desconhecida: ${modulo}.${entidade}`);
    const depto = r(Number(id));
    if (depto === undefined || depto === null) throw new E.NaoEncontrado('Registro');
    return depto;
  }

  // ================= Departamentos =================
  function listarDepartamentos({ incluirInativos = false } = {}) {
    const f = filtroEscopo('d.id');
    return db.prepare(`SELECT d.*, p.nome AS pai FROM departamentos d LEFT JOIN departamentos p ON p.id = d.pai_id
        WHERE 1=1 ${incluirInativos ? '' : 'AND d.ativo = 1'} ${f.sql} ORDER BY d.nome`).all(...f.args);
  }
  function obterDepartamento(id) {
    const d = db.prepare('SELECT * FROM departamentos WHERE id = ?').get(id);
    if (!d) throw new E.NaoEncontrado('Departamento');
    return d;
  }
  function salvarDepartamento(dados, id) {
    exigirPerfil();
    const nome = E.texto(dados.nome, 'nome', { obrigatorio: true });
    const sigla = E.texto(dados.sigla, 'sigla');
    const gestor = E.texto(dados.gestor, 'gestor');
    const tipo = E.umDe(dados.tipo, 'tipo', TIPOS_DEPTO, 'departamento');
    const paiId = E.numero(dados.pai_id, 'pai_id');
    const ativo = dados.ativo === undefined ? 1 : (dados.ativo ? 1 : 0);
    const dup = db.prepare('SELECT id FROM departamentos WHERE nome = ? AND id IS NOT ?').get(nome, id ?? null);
    E.exigir(!dup, 'Já existe um departamento com esse nome');
    if (paiId) {
      obterDepartamento(paiId);
      if (id) E.exigir(!descendentes(id).includes(paiId), 'Hierarquia inválida: um departamento não pode ficar abaixo de si mesmo');
    }
    if (id) {
      obterDepartamento(id);
      db.prepare('UPDATE departamentos SET nome=?, sigla=?, gestor=?, ativo=?, tipo=?, pai_id=? WHERE id=?').run(nome, sigla, gestor, ativo, tipo, paiId, id);
      auditar('core', 'departamento', id, 'atualizar', dados);
      return obterDepartamento(id);
    }
    const r = db.prepare('INSERT INTO departamentos (nome, sigla, gestor, ativo, tipo, pai_id) VALUES (?,?,?,?,?,?)').run(nome, sigla, gestor, ativo, tipo, paiId);
    auditar('core', 'departamento', Number(r.lastInsertRowid), 'criar', dados);
    return obterDepartamento(Number(r.lastInsertRowid));
  }

  // ================= Usuários =================
  const publico = (u) => u && ({ id: u.id, nome: u.nome, email: u.email, login: u.login, perfil: u.perfil, departamento_id: u.departamento_id,
    ativo: u.ativo, notificar_email: u.notificar_email, sso: !!u.sso_sub, ultimo_acesso: u.ultimo_acesso, criado_em: u.criado_em });
  const totalUsuarios = () => db.prepare('SELECT COUNT(*) n FROM usuarios').get().n;
  function obterUsuario(id) {
    const u = db.prepare('SELECT * FROM usuarios WHERE id=?').get(id);
    if (!u) throw new E.NaoEncontrado('Usuário');
    return u;
  }
  function listarUsuarios() {
    return db.prepare(`SELECT u.*, d.nome AS departamento FROM usuarios u LEFT JOIN departamentos d ON d.id=u.departamento_id ORDER BY u.nome`).all()
      .map((u) => ({ ...publico(u), departamento: u.departamento }));
  }
  /** Lista resumida (id, nome, login) para @menções — qualquer usuário autenticado. */
  const diretorio = () => db.prepare('SELECT id, nome, login FROM usuarios WHERE ativo=1 ORDER BY nome').all();

  function loginLivre(base) {
    const limpo = base.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9._-]/g, '') || 'usuario';
    let l = limpo; let i = 2;
    while (db.prepare('SELECT 1 FROM usuarios WHERE login=?').get(l)) l = `${limpo}${i++}`;
    return l;
  }
  function validarSenha(s) {
    E.exigir(typeof s === 'string' && s.length >= 8, 'A senha deve ter pelo menos 8 caracteres');
    return s;
  }
  function salvarUsuario(d, id, { bootstrap = false } = {}) {
    if (!bootstrap) exigirPerfil();
    const u = {
      nome: E.texto(d.nome, 'nome', { obrigatorio: true }),
      email: E.texto(d.email, 'email', { obrigatorio: true }),
      perfil: E.umDe(d.perfil, 'perfil', PERFIS, 'colaborador'),
      departamento_id: E.numero(d.departamento_id, 'departamento_id'),
      ativo: d.ativo === undefined ? 1 : (d.ativo ? 1 : 0),
      notificar_email: d.notificar_email === undefined ? 1 : (d.notificar_email ? 1 : 0),
    };
    E.exigir(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(u.email), 'E-mail inválido');
    if (u.departamento_id) obterDepartamento(u.departamento_id);
    // Usuários criados automaticamente via SSO ficam sem departamento (sem acesso a dados) até o admin definir
    E.exigir(bootstrap || ['admin', 'diretoria'].includes(u.perfil) || u.departamento_id, 'Gestores e colaboradores precisam de um departamento');
    const dup = db.prepare('SELECT id FROM usuarios WHERE email=? AND id IS NOT ?').get(u.email, id ?? null);
    E.exigir(!dup, 'Já existe um usuário com esse e-mail');
    if (id) {
      const atual = obterUsuario(id);
      if (atual.perfil === 'admin' && (u.perfil !== 'admin' || !u.ativo)) {
        const admins = db.prepare(`SELECT COUNT(*) n FROM usuarios WHERE perfil='admin' AND ativo=1 AND id<>?`).get(id).n;
        E.exigir(admins > 0, 'É necessário manter pelo menos um administrador ativo');
      }
      db.prepare('UPDATE usuarios SET nome=?, email=?, perfil=?, departamento_id=?, ativo=?, notificar_email=? WHERE id=?')
        .run(u.nome, u.email, u.perfil, u.departamento_id, u.ativo, u.notificar_email, id);
      if (d.senha) db.prepare('UPDATE usuarios SET senha_hash=? WHERE id=?').run(hashSenha(validarSenha(d.senha)), id);
      if (!u.ativo) db.prepare('DELETE FROM sessoes WHERE usuario_id=?').run(id);
      auditar('core', 'usuario', id, 'atualizar', { ...u, senha: d.senha ? '***' : undefined });
      return publico(obterUsuario(id));
    }
    const senha = d.senha ? hashSenha(validarSenha(d.senha)) : null;
    const login = d.login ? loginLivre(d.login) : loginLivre(u.email.split('@')[0]);
    const r = db.prepare(`INSERT INTO usuarios (nome, email, login, senha_hash, perfil, departamento_id, ativo, notificar_email, sso_sub)
                          VALUES (?,?,?,?,?,?,?,?,?)`).run(u.nome, u.email, login, senha, u.perfil, u.departamento_id, u.ativo, u.notificar_email, d.sso_sub || null);
    auditar('core', 'usuario', Number(r.lastInsertRowid), 'criar', { ...u, login });
    return publico(obterUsuario(Number(r.lastInsertRowid)));
  }
  function alterarPropriaSenha(atual, nova) {
    const u = usuarioAtual();
    E.exigir(u, 'Não autenticado');
    const reg = obterUsuario(u.id);
    E.exigir(!reg.senha_hash || conferirSenha(atual || '', reg.senha_hash), 'Senha atual incorreta');
    db.prepare('UPDATE usuarios SET senha_hash=? WHERE id=?').run(hashSenha(validarSenha(nova)), u.id);
    auditar('core', 'usuario', u.id, 'alterar_senha');
  }
  function preferencias(d) {
    const u = usuarioAtual();
    db.prepare('UPDATE usuarios SET notificar_email=? WHERE id=?').run(d.notificar_email ? 1 : 0, u.id);
    return publico(obterUsuario(u.id));
  }

  // ================= Autenticação =================
  const falhas = new Map(); // limita tentativas de login por e-mail
  function autenticar(email, senha) {
    const chave = String(email || '').toLowerCase();
    const f = falhas.get(chave);
    if (f && f.n >= 5 && Date.now() - f.t < 15 * 60e3) throw new E.ErroValidacao('Muitas tentativas. Aguarde 15 minutos.', 429);
    const u = db.prepare('SELECT * FROM usuarios WHERE email=? AND ativo=1').get(chave);
    const ok = u && u.senha_hash && conferirSenha(senha || '', u.senha_hash);
    if (!ok) {
      falhas.set(chave, { n: (f && Date.now() - f.t < 15 * 60e3 ? f.n : 0) + 1, t: Date.now() });
      auditar('core', 'sessao', u?.id, 'login_falhou', { email: chave }, chave);
      throw new E.ErroValidacao('E-mail ou senha inválidos', 401);
    }
    falhas.delete(chave);
    return u;
  }
  function criarSessao(usuarioId) {
    const token = tokenAleatorio();
    const expira = new Date(Date.now() + SESSAO_HORAS * 3600e3).toISOString();
    db.prepare('INSERT INTO sessoes (token_hash, usuario_id, expira_em) VALUES (?,?,?)').run(sha256(token), usuarioId, expira);
    db.prepare(`UPDATE usuarios SET ultimo_acesso=datetime('now') WHERE id=?`).run(usuarioId);
    db.prepare(`DELETE FROM sessoes WHERE expira_em < ?`).run(new Date().toISOString());
    const u = obterUsuario(usuarioId);
    auditar('core', 'sessao', usuarioId, 'login', null, u.email);
    return { token, expira };
  }
  function usuarioPorSessao(token) {
    if (!token) return null;
    return db.prepare(`SELECT u.* FROM sessoes s JOIN usuarios u ON u.id=s.usuario_id
        WHERE s.token_hash=? AND s.expira_em > ? AND u.ativo=1`).get(sha256(token), new Date().toISOString()) || null;
  }
  const encerrarSessao = (token) => db.prepare('DELETE FROM sessoes WHERE token_hash=?').run(sha256(token));

  // Tokens de API (integrações): agem com as permissões do usuário dono
  function criarTokenApi(nome, usuarioId) {
    exigirPerfil();
    const n = E.texto(nome, 'nome', { obrigatorio: true });
    const dono = obterUsuario(E.numero(usuarioId, 'usuario_id') || usuarioAtual()?.id);
    const token = `kpi_${tokenAleatorio(24)}`;
    const r = db.prepare('INSERT INTO api_tokens (nome, token_hash, prefixo, usuario_id) VALUES (?,?,?,?)').run(n, sha256(token), token.slice(0, 10), dono.id);
    auditar('core', 'api_token', Number(r.lastInsertRowid), 'criar', { nome: n, usuario: dono.email });
    return { id: Number(r.lastInsertRowid), nome: n, token, aviso: 'Guarde este token: ele não será exibido novamente.' };
  }
  const listarTokensApi = () => { exigirPerfil(); return db.prepare(`SELECT t.id, t.nome, t.prefixo, t.ultimo_uso, t.revogado, t.criado_em, u.email AS usuario
    FROM api_tokens t JOIN usuarios u ON u.id=t.usuario_id ORDER BY t.id DESC`).all(); };
  function revogarTokenApi(id) { exigirPerfil(); db.prepare('UPDATE api_tokens SET revogado=1 WHERE id=?').run(id); auditar('core', 'api_token', id, 'revogar'); }
  function usuarioPorTokenApi(token) {
    const t = db.prepare(`SELECT t.id tid, u.* FROM api_tokens t JOIN usuarios u ON u.id=t.usuario_id WHERE t.token_hash=? AND t.revogado=0 AND u.ativo=1`).get(sha256(token));
    if (!t) return null;
    db.prepare(`UPDATE api_tokens SET ultimo_uso=datetime('now') WHERE id=?`).run(t.tid);
    return t;
  }

  // ================= Configurações =================
  function obterConfig(chave, padrao = null) {
    const r = db.prepare('SELECT valor FROM configuracoes WHERE chave=?').get(chave);
    return r ? r.valor : (process.env[chave.toUpperCase()] ?? padrao);
  }
  function listarConfig() {
    exigirPerfil();
    const o = Object.fromEntries(db.prepare('SELECT chave, valor FROM configuracoes').all().map((r) => [r.chave, r.valor]));
    for (const s of SEGREDOS) if (o[s]) o[s] = '********';
    return o;
  }
  function salvarConfig(dados) {
    exigirPerfil();
    const st = db.prepare('INSERT INTO configuracoes (chave, valor) VALUES (?,?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor');
    for (const [k, v] of Object.entries(dados || {})) {
      E.exigir(/^[a-z0-9_]+$/.test(k), `Chave inválida: ${k}`);
      if (SEGREDOS.includes(k) && v === '********') continue;
      st.run(k, v === null || v === undefined ? null : String(v));
    }
    auditar('core', 'configuracao', null, 'atualizar', Object.keys(dados || {}));
    return listarConfig();
  }

  function listarAuditoria({ modulo, entidade, entidadeId, limite = 100 } = {}) {
    exigirPerfil('diretoria');
    const cond = []; const args = [];
    if (modulo) { cond.push('modulo = ?'); args.push(modulo); }
    if (entidade) { cond.push('entidade = ?'); args.push(entidade); }
    if (entidadeId) { cond.push('entidade_id = ?'); args.push(Number(entidadeId)); }
    args.push(Math.min(Number(limite) || 100, 500));
    return db.prepare(`SELECT * FROM auditoria ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`).all(...args)
      .map((a) => ({ ...a, dados: a.dados ? JSON.parse(a.dados) : null }));
  }

  return {
    db, eventos, auditar,
    descendentes, deptosVisiveis, podeVer, podeEditar, garantirVer, garantirEditar, exigirPerfil, filtroEscopo,
    registrarEntidade, departamentoDaEntidade,
    listarDepartamentos, obterDepartamento, salvarDepartamento,
    publico, totalUsuarios, obterUsuario, listarUsuarios, diretorio, salvarUsuario, alterarPropriaSenha, preferencias,
    autenticar, criarSessao, usuarioPorSessao, encerrarSessao,
    criarTokenApi, listarTokensApi, revogarTokenApi, usuarioPorTokenApi,
    obterConfig, listarConfig, salvarConfig, listarAuditoria,
  };
}
module.exports = { criarCoreService, PERFIS };
