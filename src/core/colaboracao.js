'use strict';
// Comentários com @menções e anexos (evidências) em qualquer entidade registrada pelos módulos.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const E = require('./erros');
const { usuarioAtual } = require('./contexto');

const EXTENSOES = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'csv', 'xlsx', 'xls', 'docx', 'doc', 'pptx', 'txt', 'msg', 'eml', 'zip'];
const INLINE = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const LIMITE_BYTES = (Number(process.env.ANEXO_MAX_MB) || 10) * 1024 * 1024;

const linkDe = (modulo, entidade, id, db) => {
  if (modulo === 'indicadores' && entidade === 'indicador') return `#/indicadores/${id}`;
  if (modulo === 'indicadores' && entidade === 'plano') return `#/planos/${id}`;
  if (modulo === 'indicadores' && ['medicao', 'analise'].includes(entidade)) {
    const q = entidade === 'medicao' ? 'SELECT indicador_id i FROM ind_medicoes WHERE id=?' : 'SELECT m.indicador_id i FROM ind_analises a JOIN ind_medicoes m ON m.id=a.medicao_id WHERE a.id=?';
    return `#/indicadores/${db.prepare(q).get(id)?.i}`;
  }
  if (modulo === 'metas') return '#/metas';
  if (modulo === 'governanca' && entidade === 'reuniao') return `#/reunioes/${id}`;
  return '#/';
};

function criarColaboracaoService(core, { dirAnexos }) {
  const db = core.db;
  fs.mkdirSync(dirAnexos, { recursive: true });

  function verEntidade(modulo, entidade, id) {
    const depto = core.departamentoDaEntidade(modulo, entidade, id);
    core.garantirVer(depto);
    return depto;
  }

  // ---------- Comentários ----------
  function listarComentarios(modulo, entidade, id) {
    verEntidade(modulo, entidade, id);
    return db.prepare(`SELECT c.id, c.texto, c.criado_em, c.usuario_id, u.nome AS autor, u.login FROM comentarios c
        LEFT JOIN usuarios u ON u.id=c.usuario_id WHERE modulo=? AND entidade=? AND entidade_id=? ORDER BY c.id`).all(modulo, entidade, id);
  }
  function comentar(modulo, entidade, id, texto) {
    const depto = verEntidade(modulo, entidade, id);
    const t = E.texto(texto, 'texto', { obrigatorio: true });
    E.exigir(t.length <= 5000, 'Comentário muito longo (máx. 5000 caracteres)');
    const u = usuarioAtual();
    const r = db.prepare('INSERT INTO comentarios (modulo, entidade, entidade_id, usuario_id, texto) VALUES (?,?,?,?,?)').run(modulo, entidade, id, u?.id ?? null, t);
    // @menções: notifica apenas quem tem acesso ao departamento do registro
    const logins = [...new Set([...t.matchAll(/@([a-z0-9._-]+)/gi)].map((m) => m[1].toLowerCase()))];
    const mencionados = logins.map((l) => db.prepare('SELECT * FROM usuarios WHERE login=? AND ativo=1').get(l)).filter(Boolean)
      .filter((m) => m.id !== u?.id && core.podeVer(depto, m)).map((m) => m.id);
    if (mencionados.length) core.eventos.emit('core.mencao', { usuarios: mencionados, autor: u?.nome || 'Sistema', texto: t, link: linkDe(modulo, entidade, id, db) });
    core.auditar('core', 'comentario', Number(r.lastInsertRowid), 'criar', { modulo, entidade, id });
    return { id: Number(r.lastInsertRowid), mencionados: mencionados.length };
  }
  function excluirComentario(id) {
    const c = db.prepare('SELECT * FROM comentarios WHERE id=?').get(id);
    if (!c) throw new E.NaoEncontrado('Comentário');
    const u = usuarioAtual();
    E.exigir(!u || u.perfil === 'admin' || c.usuario_id === u.id, 'Só o autor pode excluir o comentário', 403);
    db.prepare('DELETE FROM comentarios WHERE id=?').run(id);
  }

  // ---------- Anexos ----------
  function listarAnexos(modulo, entidade, id) {
    verEntidade(modulo, entidade, id);
    return db.prepare(`SELECT a.id, a.nome, a.tipo, a.tamanho, a.criado_em, u.nome AS autor FROM anexos a LEFT JOIN usuarios u ON u.id=a.usuario_id
        WHERE modulo=? AND entidade=? AND entidade_id=? ORDER BY a.id`).all(modulo, entidade, id);
  }
  function anexar(modulo, entidade, id, nomeOriginal, conteudo) {
    const depto = verEntidade(modulo, entidade, id);
    core.garantirEditar(depto);
    E.exigir(Buffer.isBuffer(conteudo) && conteudo.length > 0, 'Arquivo vazio');
    E.exigir(conteudo.length <= LIMITE_BYTES, `Arquivo excede ${LIMITE_BYTES / 1024 / 1024} MB`);
    const nome = path.basename(String(nomeOriginal || 'arquivo')).replace(/[^\w.\- ()À-ú]/g, '_').slice(0, 150);
    const ext = nome.includes('.') ? nome.split('.').pop().toLowerCase() : '';
    E.exigir(EXTENSOES.includes(ext), `Tipo de arquivo não permitido. Permitidos: ${EXTENSOES.join(', ')}`);
    const arquivo = crypto.randomUUID() + '.' + ext;
    fs.writeFileSync(path.join(dirAnexos, arquivo), conteudo);
    const r = db.prepare('INSERT INTO anexos (modulo, entidade, entidade_id, nome, tipo, tamanho, arquivo, usuario_id) VALUES (?,?,?,?,?,?,?,?)')
      .run(modulo, entidade, id, nome, ext, conteudo.length, arquivo, usuarioAtual()?.id ?? null);
    core.auditar('core', 'anexo', Number(r.lastInsertRowid), 'criar', { modulo, entidade, id, nome });
    return { id: Number(r.lastInsertRowid), nome, tamanho: conteudo.length };
  }
  function obterAnexo(id) {
    const a = db.prepare('SELECT * FROM anexos WHERE id=?').get(id);
    if (!a) throw new E.NaoEncontrado('Anexo');
    const depto = verEntidade(a.modulo, a.entidade, a.entidade_id);
    return { ...a, depto, caminho: path.join(dirAnexos, a.arquivo), mime: INLINE[a.tipo] || 'application/octet-stream', inline: !!INLINE[a.tipo] };
  }
  function excluirAnexo(id) {
    const a = obterAnexo(id);
    const u = usuarioAtual();
    if (!(u && a.usuario_id === u.id)) core.garantirEditar(a.depto);
    db.prepare('DELETE FROM anexos WHERE id=?').run(id);
    fs.rmSync(a.caminho, { force: true });
    core.auditar('core', 'anexo', id, 'excluir', { nome: a.nome });
  }
  const contarAnexos = (modulo, entidade, ids) => {
    if (!ids.length) return {};
    return Object.fromEntries(db.prepare(`SELECT entidade_id, COUNT(*) n FROM anexos WHERE modulo=? AND entidade=? AND entidade_id IN (${ids.map(() => '?').join(',')}) GROUP BY entidade_id`)
      .all(modulo, entidade, ...ids).map((r) => [r.entidade_id, r.n]));
  };

  return { listarComentarios, comentar, excluirComentario, listarAnexos, anexar, obterAnexo, excluirAnexo, contarAnexos, EXTENSOES };
}

module.exports = { criarColaboracaoService };
