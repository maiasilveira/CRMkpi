'use strict';
// Migrações versionadas por módulo. Cada módulo declara uma lista ordenada de passos
// (SQL ou função). Só os passos com versão maior que a registrada são aplicados.
const { transacao } = require('../db');

function aplicarMigracoes(db, modulo, passos) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migracoes (
    modulo TEXT NOT NULL, versao INTEGER NOT NULL, aplicada_em TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (modulo, versao))`);
  const atual = db.prepare('SELECT COALESCE(MAX(versao),0) v FROM schema_migracoes WHERE modulo=?').get(modulo).v;
  passos.forEach((passo, i) => {
    const versao = i + 1;
    if (versao <= atual) return;
    transacao(db, () => {
      if (typeof passo === 'function') passo(db); else db.exec(passo);
      db.prepare('INSERT INTO schema_migracoes (modulo, versao) VALUES (?,?)').run(modulo, versao);
    });
  });
}

/** Adiciona coluna se ainda não existir (idempotente). */
function addColuna(db, tabela, coluna, def) {
  const cols = db.prepare(`PRAGMA table_info(${tabela})`).all().map((c) => c.name);
  if (!cols.includes(coluna)) db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${def}`);
}

module.exports = { aplicarMigracoes, addColuna };
