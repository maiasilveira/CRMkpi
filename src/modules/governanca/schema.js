'use strict';
const { aplicarMigracoes } = require('../../core/migracoes');

const PASSOS = [
  `CREATE TABLE gov_reunioes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    titulo TEXT NOT NULL,
    data TEXT NOT NULL,
    departamento_id INTEGER REFERENCES departamentos(id),   -- NULL = reunião corporativa
    participantes TEXT,
    pauta TEXT,                                              -- JSON gerado automaticamente
    ata TEXT,
    status TEXT NOT NULL DEFAULT 'agendada',                 -- agendada | realizada | cancelada
    criado_por TEXT,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE gov_decisoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reuniao_id INTEGER NOT NULL REFERENCES gov_reunioes(id) ON DELETE CASCADE,
    descricao TEXT NOT NULL,
    responsavel TEXT,
    prazo TEXT,
    status TEXT NOT NULL DEFAULT 'pendente',                 -- pendente | concluida | cancelada
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
  );`,
];
module.exports = (db) => aplicarMigracoes(db, 'governanca', PASSOS);
