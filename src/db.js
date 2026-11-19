'use strict';
// Conexão SQLite usando o módulo nativo do Node (sem dependências nativas).
process.removeAllListeners('warning');
process.on('warning', (w) => { if (w.name !== 'ExperimentalWarning') console.warn(w); });

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

function abrirBanco(arquivo) {
  const destino = arquivo || process.env.DB_FILE || path.join(__dirname, '..', 'data', 'kpi.db');
  if (destino !== ':memory:') fs.mkdirSync(path.dirname(destino), { recursive: true });
  const db = new DatabaseSync(destino);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  return db;
}

/** Executa uma função dentro de uma transação. */
function transacao(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { abrirBanco, transacao };
