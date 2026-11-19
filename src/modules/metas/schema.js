'use strict';
const { aplicarMigracoes, addColuna } = require('../../core/migracoes');
// Tabelas exclusivas do módulo Metas (prefixo met_). Nenhuma FK para tabelas de outros módulos
// além do núcleo (departamentos): o vínculo com indicadores é apenas um id lógico.
const V1 = `
    CREATE TABLE IF NOT EXISTS met_ciclos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL UNIQUE,
      inicio TEXT NOT NULL,                     -- AAAA-MM
      fim TEXT NOT NULL,                        -- AAAA-MM
      status TEXT NOT NULL DEFAULT 'planejamento', -- planejamento | ativo | encerrado
      nota_minima REAL NOT NULL DEFAULT 0,      -- nota mínima do departamento p/ liberar bônus (%)
      encerrado_em TEXT,
      snapshot TEXT,                            -- JSON congelado da apuração final
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS met_metas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ciclo_id INTEGER NOT NULL REFERENCES met_ciclos(id) ON DELETE CASCADE,
      departamento_id INTEGER NOT NULL REFERENCES departamentos(id),
      nome TEXT NOT NULL,
      descricao TEXT,
      unidade TEXT,
      polaridade TEXT NOT NULL,                 -- maior_melhor | menor_melhor
      peso REAL NOT NULL,                       -- % na nota do departamento
      gatilho REAL NOT NULL,                    -- resultado mínimo para pontuar
      alvo REAL NOT NULL,                       -- resultado esperado (100%)
      superacao REAL,                           -- resultado de superação (teto)
      pct_gatilho REAL NOT NULL DEFAULT 50,     -- % de atingimento pago no gatilho
      pct_superacao REAL NOT NULL DEFAULT 120,  -- % de atingimento pago na superação
      fonte TEXT NOT NULL DEFAULT 'manual',     -- manual | indicador
      indicador_id INTEGER,                     -- id lógico no módulo Indicadores (sem FK)
      agregacao TEXT NOT NULL DEFAULT 'ultimo', -- soma | media | ultimo
      responsavel TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS met_resultados (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meta_id INTEGER NOT NULL REFERENCES met_metas(id) ON DELETE CASCADE,
      periodo TEXT NOT NULL,
      valor REAL NOT NULL,
      observacao TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (meta_id, periodo)
    );
    CREATE TABLE IF NOT EXISTS met_bonus (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ciclo_id INTEGER NOT NULL REFERENCES met_ciclos(id) ON DELETE CASCADE,
      departamento_id INTEGER NOT NULL REFERENCES departamentos(id),
      valor_base REAL NOT NULL DEFAULT 0,       -- valor-alvo do bônus (100% de nota)
      status TEXT NOT NULL DEFAULT 'aberto',    -- aberto | submetido | aprovado
      aprovado_por TEXT,
      aprovado_em TEXT,
      UNIQUE (ciclo_id, departamento_id)
    );
  `;

const PASSOS = [
  V1,
];

module.exports = function migrarMetas(db) {
  aplicarMigracoes(db, 'metas', PASSOS);
};
module.exports.PASSOS = PASSOS;
void addColuna;
