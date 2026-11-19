'use strict';
const { aplicarMigracoes, addColuna } = require('./migracoes');

// Núcleo compartilhado: departamentos, usuários, sessões, auditoria, notificações, comentários, anexos.
module.exports = function migrarCore(db) {
  aplicarMigracoes(db, 'core', [
    // v1 — estrutura inicial
    `CREATE TABLE IF NOT EXISTS departamentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL UNIQUE,
      sigla TEXT,
      gestor TEXT,
      ativo INTEGER NOT NULL DEFAULT 1,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS auditoria (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      modulo TEXT NOT NULL,
      entidade TEXT NOT NULL,
      entidade_id INTEGER,
      acao TEXT NOT NULL,
      usuario TEXT,
      dados TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS ix_auditoria_ent ON auditoria(modulo, entidade, entidade_id);`,
    // v2 — hierarquia organizacional, usuários, sessões e tokens de API
    (d) => {
      addColuna(d, 'departamentos', 'pai_id', 'INTEGER REFERENCES departamentos(id)');
      addColuna(d, 'departamentos', 'tipo', "TEXT NOT NULL DEFAULT 'departamento'"); // empresa | diretoria | departamento
      d.exec(`
        CREATE TABLE usuarios (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nome TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE COLLATE NOCASE,
          login TEXT NOT NULL UNIQUE COLLATE NOCASE,   -- usado em @menções
          senha_hash TEXT,
          perfil TEXT NOT NULL,                        -- admin | diretoria | gestor | colaborador
          departamento_id INTEGER REFERENCES departamentos(id),
          sso_sub TEXT UNIQUE,
          ativo INTEGER NOT NULL DEFAULT 1,
          notificar_email INTEGER NOT NULL DEFAULT 1,
          ultimo_acesso TEXT,
          criado_em TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE sessoes (
          token_hash TEXT PRIMARY KEY,
          usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
          expira_em TEXT NOT NULL,
          criado_em TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE api_tokens (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nome TEXT NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          prefixo TEXT NOT NULL,
          usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
          ultimo_uso TEXT,
          revogado INTEGER NOT NULL DEFAULT 0,
          criado_em TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE configuracoes (chave TEXT PRIMARY KEY, valor TEXT);
      `);
    },
    // v3 — notificações, comentários e anexos
    `CREATE TABLE notificacoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      tipo TEXT NOT NULL,
      titulo TEXT NOT NULL,
      mensagem TEXT,
      link TEXT,
      chave TEXT,                -- evita duplicar alertas recorrentes
      lida INTEGER NOT NULL DEFAULT 0,
      entregas TEXT,             -- JSON: status de envio por canal
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX ux_notif_chave ON notificacoes(usuario_id, chave) WHERE chave IS NOT NULL;
    CREATE INDEX ix_notif_usuario ON notificacoes(usuario_id, lida);
    CREATE TABLE comentarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      modulo TEXT NOT NULL, entidade TEXT NOT NULL, entidade_id INTEGER NOT NULL,
      usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
      texto TEXT NOT NULL,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX ix_coment_ent ON comentarios(modulo, entidade, entidade_id);
    CREATE TABLE anexos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      modulo TEXT NOT NULL, entidade TEXT NOT NULL, entidade_id INTEGER NOT NULL,
      nome TEXT NOT NULL, tipo TEXT, tamanho INTEGER NOT NULL, arquivo TEXT NOT NULL,
      usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX ix_anexo_ent ON anexos(modulo, entidade, entidade_id);`,
  ]);
};
