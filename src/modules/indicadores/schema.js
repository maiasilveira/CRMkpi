'use strict';
// Tabelas exclusivas do módulo Indicadores (prefixo ind_).
module.exports = function migrarIndicadores(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ind_indicadores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT UNIQUE,
      nome TEXT NOT NULL,
      descricao TEXT,
      departamento_id INTEGER NOT NULL REFERENCES departamentos(id),
      responsavel TEXT,
      unidade TEXT,
      formula TEXT,
      fonte_dados TEXT,
      perspectiva TEXT,                       -- BSC: financeira, clientes, processos, aprendizado
      frequencia TEXT NOT NULL DEFAULT 'mensal',
      polaridade TEXT NOT NULL,               -- maior_melhor | menor_melhor | faixa
      meta REAL NOT NULL,
      limite_inferior REAL,
      limite_superior REAL,
      ativo INTEGER NOT NULL DEFAULT 1,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS ind_medicoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      indicador_id INTEGER NOT NULL REFERENCES ind_indicadores(id) ON DELETE CASCADE,
      periodo TEXT NOT NULL,                  -- AAAA-MM
      valor REAL NOT NULL,
      meta REAL NOT NULL,                     -- snapshot da meta vigente
      limite_inferior REAL,
      limite_superior REAL,
      status TEXT NOT NULL,                   -- atingido | atencao | desvio
      comentario TEXT,
      registrado_por TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (indicador_id, periodo)
    );
    CREATE TABLE IF NOT EXISTS ind_analises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      medicao_id INTEGER NOT NULL REFERENCES ind_medicoes(id) ON DELETE CASCADE,
      tecnica TEXT NOT NULL,                  -- 5w2h | 5porques | ishikawa
      conteudo TEXT NOT NULL,                 -- JSON com os campos da técnica
      causa_raiz TEXT,
      responsavel TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS ind_planos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      indicador_id INTEGER NOT NULL REFERENCES ind_indicadores(id) ON DELETE CASCADE,
      analise_id INTEGER REFERENCES ind_analises(id) ON DELETE SET NULL,
      titulo TEXT NOT NULL,
      objetivo TEXT,
      responsavel TEXT,
      status TEXT NOT NULL DEFAULT 'aberto',  -- aberto | em_andamento | concluido | cancelado
      eficacia TEXT,                          -- pendente | eficaz | nao_eficaz
      verificacao_data TEXT,
      verificacao_obs TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS ind_acoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plano_id INTEGER NOT NULL REFERENCES ind_planos(id) ON DELETE CASCADE,
      o_que TEXT NOT NULL,      -- What
      por_que TEXT,             -- Why
      onde TEXT,                -- Where
      quando TEXT NOT NULL,     -- When (prazo AAAA-MM-DD)
      quem TEXT NOT NULL,       -- Who
      como TEXT,                -- How
      quanto REAL,              -- How much
      status TEXT NOT NULL DEFAULT 'pendente', -- pendente | em_andamento | concluida | cancelada
      concluida_em TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS ix_ind_med ON ind_medicoes(indicador_id, periodo);
    CREATE INDEX IF NOT EXISTS ix_ind_acao_plano ON ind_acoes(plano_id);
  `);
};
