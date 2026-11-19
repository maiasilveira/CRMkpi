# KPI & Metas — Gestão de Indicadores de Desempenho e Metas Bonificáveis

Sistema web para gestão de **indicadores de desempenho (KPIs)** e **metas bonificáveis** dos departamentos de uma empresa.
Os dois domínios são **módulos independentes**: cada um tem suas próprias tabelas, regras, serviço, rotas e telas, e
pode ser ligado/desligado sem afetar o outro.

## Como executar

Requisitos: **Node.js ≥ 22.13** (usa o SQLite embutido do Node — nenhuma dependência nativa).

```bash
npm install
npm run seed      # (opcional) cria um banco de demonstração em data/kpi.db
npm start         # http://localhost:3000
npm test          # testes de regras e de API
```

Variáveis de ambiente:

| Variável  | Padrão          | Descrição                                                    |
|-----------|-----------------|--------------------------------------------------------------|
| `PORT`    | `3000`          | Porta HTTP                                                   |
| `DB_FILE` | `data/kpi.db`   | Arquivo do banco SQLite                                      |
| `MODULOS` | `indicadores,metas` | Módulos ativos. Ex.: `MODULOS=metas npm start`           |

## Arquitetura modular

```
src/
├── app.js                 # monta o app e registra os módulos ativos
├── db.js                  # conexão SQLite + transações
├── core/                  # núcleo compartilhado: departamentos, auditoria, validações
└── modules/
    ├── indicadores/       # MÓDULO 1 — tabelas ind_*
    │   ├── schema.js      #   indicadores, medições, análises, planos, ações
    │   ├── calculo.js     #   regras puras (status, range, desvio, tendência)
    │   ├── service.js     #   casos de uso + API pública (api.agregar, api.listarResumo…)
    │   └── routes.js      #   /api/indicadores, /api/planos
    └── metas/             # MÓDULO 2 — tabelas met_*
        ├── schema.js      #   ciclos, metas, resultados, bônus/aprovação
        ├── calculo.js     #   curva de atingimento, nota ponderada, bônus
        ├── service.js
        └── routes.js      #   /api/metas
public/                    # SPA sem build (HTML + CSS + JS puro)
```

**Regras de independência**

* Cada módulo só acessa suas próprias tabelas e o núcleo (departamentos/auditoria).
* Metas **não** tem chave estrangeira para tabelas de Indicadores. Uma meta pode ter `fonte = indicador`,
  e nesse caso o resultado é lido pela **API pública** do módulo Indicadores, injetada no momento do registro
  (`modulos.indicadores.api`). Se o módulo Indicadores estiver desligado, Metas continua funcionando com
  lançamento manual.
* Os testes cobrem os dois módulos rodando isoladamente.

## Módulo 1 — Indicadores de desempenho

**Cadastro do indicador**: código, nome, departamento, responsável, unidade, fórmula, fonte de dados,
frequência, perspectiva BSC, **polaridade**, **meta** e **range aceitável**.

| Polaridade      | Atingido          | Atenção (dentro do range)          | Desvio                |
|-----------------|-------------------|------------------------------------|-----------------------|
| Maior é melhor  | valor ≥ meta      | limite inferior ≤ valor < meta     | valor < limite inf.   |
| Menor é melhor  | valor ≤ meta      | meta < valor ≤ limite superior     | valor > limite sup.   |
| Faixa           | entre os limites  | —                                  | fora dos limites      |

* Cada medição grava um **snapshot** da meta/range vigente — mudar a meta depois não reescreve o histórico.
* **Desvio ⇒ análise obrigatória**: ao registrar um valor em desvio, o sistema abre a análise de causa e
  gera alerta até que ela seja registrada.
* **Técnicas de análise**:
  * **5W2H** — descrição estruturada do desvio (o quê, por quê, onde, quando, quem, como, quanto);
  * **5 Porquês** — aprofundamento até a causa raiz (o último porquê vira a causa raiz se não informada);
  * **Ishikawa (6M)** — método, máquina, material, mão de obra, medição, meio ambiente.
* **Plano de ação** vinculado à análise, com ações em **5W2H** (prazo, responsável, custo), status por ação,
  progresso, detecção de **atraso**, custo total e **verificação de eficácia** (eficaz / não eficaz) após a conclusão.
  Um plano só pode ser concluído quando todas as ações estiverem concluídas ou canceladas.
* Gráfico de evolução com linha de meta, faixa aceitável e pontos coloridos por status; desvio % e tendência.

## Módulo 2 — Metas bonificáveis

* **Ciclos** (ex.: PLR 2026) com início/fim e **nota mínima** para liberar bônus.
* **Metas por departamento** com **peso** (soma deve ser 100%), **gatilho**, **alvo** e **superação**, e curva de
  pagamento configurável:

  ```
  abaixo do gatilho → 0% | gatilho → % gatilho (ex. 50%) | alvo → 100% | superação → % teto (ex. 120%)
  ```
  Valores intermediários são interpolados. Para "menor é melhor" a curva é espelhada.
* **Fonte do resultado**: lançamento manual (por período, com observação/evidência) ou **vinculada a um indicador**,
  com agregação no ciclo por **soma**, **média** ou **último valor**.
* **Projeção** de fim de ciclo para metas acumuladas (soma).
* **Nota do departamento** = Σ(peso × atingimento) e **bônus** = bônus-alvo × nota (se nota ≥ nota mínima).
* **Fluxo de aprovação**: aberto → submetido → aprovado (com reabertura). Apuração submetida/aprovada fica bloqueada.
* **Encerramento do ciclo** exige todos os departamentos aprovados e **congela** a apuração (snapshot imutável).
* **Simulação "e se"** de resultados sem gravar, e **exportação CSV** para a folha de pagamento.

## Transversal

* **Painel** com status dos indicadores, saúde por departamento, alertas (desvio sem análise, ação atrasada,
  eficácia pendente) e resumo do ciclo de metas.
* **Trilha de auditoria** de todas as alterações (quem/quando/o quê).
* Interface responsiva, com tema claro/escuro.

## API (resumo)

| Método | Rota | Descrição |
|---|---|---|
| GET/POST/PUT | `/api/departamentos[/:id]` | Departamentos |
| GET | `/api/indicadores/painel` | Painel e alertas |
| GET/POST/PUT/DELETE | `/api/indicadores[/:id]` | Indicadores |
| GET/POST | `/api/indicadores/:id/medicoes` | Medições (POST faz upsert por período) |
| POST | `/api/indicadores/medicoes/:mid/analises` | Análise de desvio (`tecnica`: `5w2h`, `5porques`, `ishikawa`) |
| GET/POST/PUT/DELETE | `/api/planos[/:id]` | Planos de ação |
| POST/PUT/DELETE | `/api/planos/:id/acoes`, `/api/planos/acoes/:aid` | Ações 5W2H |
| GET/POST/PUT | `/api/metas/ciclos[/:id]` | Ciclos |
| GET | `/api/metas/ciclos/:id/apuracao` | Scorecard e bônus |
| PUT | `/api/metas/ciclos/:id/departamentos/:did/bonus` | Bônus-alvo |
| POST | `/api/metas/ciclos/:id/departamentos/:did/{submeter,aprovar,reabrir,simular}` | Workflow / simulação |
| POST | `/api/metas/ciclos/:id/encerrar` | Encerra e congela o ciclo |
| GET | `/api/metas/ciclos/:id/exportar.csv` | Exportação |
| GET/POST/PUT/DELETE | `/api/metas[/:id]`, `/api/metas/:id/resultados` | Metas e resultados |
| GET | `/api/auditoria` | Trilha de auditoria |

## Roadmap — funcionalidades sugeridas

**Prioridade alta**
1. **Autenticação e perfis** (admin, diretoria/aprovador, gestor de departamento, colaborador) com visibilidade
   restrita ao próprio departamento e SSO (Azure AD / Google).
2. **Notificações** por e-mail/Teams/Slack: medição não lançada até o dia X, desvio registrado, ação vencendo,
   apuração aguardando aprovação.
3. **Importação** de medições via planilha (CSV/XLSX) e **integrações** com ERP/CRM/BI (API + agendador).
4. **Metas individuais** desdobradas das metas do departamento, com bônus por colaborador (múltiplo de salário).
5. **Anexos/evidências** nas medições, análises e resultados de metas (exigência comum de auditoria de PLR).

**Gestão e análise**
6. **Desdobramento de metas** (empresa → diretoria → departamento) e mapa estratégico BSC.
7. **Indicadores calculados** (fórmula sobre outros indicadores) e metas variando por período (sazonalidade).
8. **Controle estatístico** (cartas de controle, limites ±3σ) para detectar instabilidade antes do desvio.
9. **Benchmark** entre departamentos/unidades e ranking.
10. **Ciclo PDCA completo** e reuniões de análise crítica com ata, pauta automática (indicadores em desvio) e
    registro de decisões.
11. **Matriz GUT** para priorizar desvios e planos; outras técnicas (Pareto, árvore de falhas, A3).

**Bônus e governança**
12. **Gatilho corporativo** (ex.: EBITDA mínimo da empresa libera o programa), redutores por
    absenteísmo/advertências, pró-rata por admissão/desligamento.
13. **Versão das regras** (histórico de alteração de meta com justificativa e aprovação).
14. **Relatórios PDF** do acordo de PLR e da apuração para sindicato/comissão.
15. **Comentários e @menções** em indicadores e planos; app mobile/PWA para lançamentos rápidos.
16. **Assistente de IA** para sugerir causas prováveis e ações a partir do histórico de análises.

## Próximos passos técnicos

* Migrar para PostgreSQL quando houver múltiplos usuários simultâneos (o acesso a dados já está isolado nos serviços).
* Versionamento de migrações de schema.
* Testes end-to-end da interface.
