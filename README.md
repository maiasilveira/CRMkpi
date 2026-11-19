# KPI & Metas — Gestão de Indicadores de Desempenho e Metas Bonificáveis

Sistema web para gestão de **indicadores de desempenho (KPIs)** e **metas bonificáveis** (PLR/PPR) dos
departamentos de uma empresa. Indicadores, Metas e Governança são **módulos independentes**: cada um tem
tabelas, regras, serviço, rotas e telas próprios e pode ser ligado ou desligado sem afetar os demais.

## Como executar

Requisitos: **Node.js ≥ 22.13** (usa o SQLite embutido no Node; não há dependências nativas).

```bash
npm install
npm run seed      # (opcional) banco de demonstração em data/kpi.db
npm start         # http://localhost:3000
npm test          # testes de regras, API e permissões (38 testes)
npm run test:e2e  # teste de ponta a ponta da interface (Playwright)
```

Sem o seed, o primeiro acesso abre a tela de **configuração inicial** para criar o administrador.

**Usuários de demonstração** (senha `demo1234`):

| E-mail | Perfil | Observação |
|---|---|---|
| `admin@demo.com` | Administrador | acesso total |
| `diretoria@demo.com` | Diretoria | todas as áreas, aprovações, encerramento de ciclo |
| `ana@demo.com`, `bruno@demo.com`, `carla@demo.com`, `diego@demo.com` | Gestor | edita a própria área |
| `eduardo@demo.com` | Colaborador | consulta a área e vê o próprio bônus |

### Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta HTTP |
| `DB_FILE` | `data/kpi.db` | Arquivo do banco SQLite |
| `ANEXOS_DIR` | `data/anexos` | Pasta dos anexos |
| `MODULOS` | `indicadores,metas,governanca` | Módulos ativos (ex.: `MODULOS=metas`) |
| `SESSAO_HORAS` | `12` | Duração da sessão |
| `COOKIE_SECURE` | — | `1` em produção com HTTPS |
| `ANEXO_MAX_MB` | `10` | Tamanho máximo de anexo |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI` | — | Login único (veja abaixo) |
| `OIDC_NOME`, `OIDC_AUTO_CRIAR`, `OIDC_DOMINIOS` | — | Rótulo do botão; `1` cria usuários no 1º acesso; domínios permitidos |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | —, `claude-opus-5-5` | Assistente de IA (opcional) |

E-mail (SMTP), webhooks do Teams/Slack, dia-limite de lançamento e ativação da IA são configurados pela tela
**Configurações** (admin).

**SSO (Microsoft Entra ID / Google):** registre o aplicativo no provedor com o redirecionamento
`https://SEU-DOMINIO/api/auth/sso/retorno`. Entra ID: `OIDC_ISSUER=https://login.microsoftonline.com/<tenant>/v2.0`.
Google: `OIDC_ISSUER=https://accounts.google.com`. O fluxo é Authorization Code com PKCE.

## Arquitetura

```
src/
├── app.js                  # monta o app e registra os módulos ativos
├── seed.js                 # dados de demonstração
├── core/                   # NÚCLEO compartilhado
│   ├── migracoes.js        #   migrações versionadas por módulo (schema_migracoes)
│   ├── service.js          #   departamentos (hierarquia), usuários, perfis, escopo, tokens, configurações, auditoria
│   ├── autenticacao.js     #   sessão por cookie HttpOnly, Bearer token, proteção CSRF
│   ├── sso.js              #   OpenID Connect (PKCE)
│   ├── notificacoes.js     #   caixa de entrada, e-mail, Teams/Slack, eventos e verificações
│   ├── agendador.js        #   tarefas periódicas
│   ├── colaboracao.js      #   comentários com @menção e anexos
│   └── planilha.js         #   leitura de CSV/XLSX
└── modules/
    ├── indicadores/        # MÓDULO 1 (tabelas ind_*)
    ├── metas/              # MÓDULO 2 (tabelas met_*)
    └── governanca/         # MÓDULO 3 (tabelas gov_*) — usa os outros dois se estiverem ativos
public/                     # SPA sem build: js/base.js, componentes, uma view por área, PWA
test/                       # node:test (regras, API, permissões) + e2e/ (Playwright)
```

**Independência entre módulos**

* Cada módulo acessa só as próprias tabelas e o núcleo. Metas não tem chave estrangeira para Indicadores:
  uma meta com `fonte = indicador` lê o resultado pela **API pública** do módulo Indicadores.
* Comunicação por **eventos** (`indicadores.desvio`, `metas.apuracao`…) que o núcleo transforma em notificações.
* Os testes executam Metas sem Indicadores e Indicadores sem Metas.

## Módulo 1 — Indicadores de desempenho

* **Ficha**: código, departamento, responsável, unidade, fórmula, fonte, frequência, perspectiva BSC, objetivo estratégico.
* **Meta e range aceitável** por polaridade: *maior é melhor* (limite inferior), *menor é melhor* (limite superior), *faixa*.
  Cada medição recebe o status **atingido / atenção / desvio** e guarda um snapshot da meta vigente.
* **Metas por período (sazonalidade)**: meta e range diferentes em meses específicos, com reclassificação automática.
* **Indicadores calculados**: fórmula com outros indicadores (`{COM-01} / {COM-02} * 100`), interpretada por um parser
  próprio (sem `eval`), com recálculo em cadeia e bloqueio de referência circular.
* **Análise de desvio obrigatória** com 6 técnicas: **5W2H, 5 Porquês, Ishikawa (6M), Pareto, Relatório A3 e Árvore de falhas**.
* **Assistente de análise**: sugere causas prováveis, ações e perguntas a partir do histórico da empresa (planos eficazes têm
  prioridade). Se a IA for ativada pelo administrador, usa o Claude com saída estruturada. Os dados do desvio e o histórico
  do departamento são enviados à API da Anthropic, por isso a IA fica desligada até alguém ativá-la.
* **Planos de ação 5W2H** com prazo, responsável, custo, progresso, atraso, **priorização GUT**, **fase PDCA** e
  **verificação de eficácia**. Quem consta como responsável por uma ação pode atualizar o status dela.
* **CEP — carta de controle I-MR** (±3σ, 8 pontos do mesmo lado, tendência de 6) com alerta de instabilidade.
* **Mapa estratégico (BSC)** com objetivos, relações de causa e efeito e situação dos indicadores.
* **Histórico de versões da ficha**: alterar meta, range, polaridade ou fórmula de um indicador com histórico exige justificativa.
* **Entrada de dados**: lançamento manual, **lançamento rápido** (celular), **importação CSV/XLSX** com simulação e relatório
  por linha, **integrações HTTP/JSON** agendadas e **tokens de API** para sistemas externos.

## Módulo 2 — Metas bonificáveis

* **Ciclos** com nota mínima, **gatilho corporativo** (ex.: EBITDA mínimo libera o programa), redutores e regra de pró-rata.
* **Metas por departamento** com peso (soma = 100%), gatilho, alvo, superação e curva de pagamento configurável;
  resultado manual ou vinculado a indicador (soma, média ou último valor) e **projeção** de fim de ciclo.
* **Desdobramento**: empresa → diretorias → departamentos → pessoas (meta-mãe), exibido em árvore.
* **Colaboradores** (cadastro e importação), **participação por ciclo** e **metas individuais**.
* **Bônus individual** = salário × múltiplo × pró-rata × nota final × (1 − redutores), com
  nota final = peso do depto × nota do depto + restante × nota individual. Zera se o gatilho corporativo ou a nota mínima não forem atingidos.
* **Pró-rata** por meses com pelo menos *N* dias trabalhados (admissão/desligamento); **redutores** por faltas e advertências, com teto.
* **Versionamento de regras**: em ciclo ativo, alterar uma meta gera uma solicitação com justificativa, que precisa ser aprovada
  pela diretoria — **e não por quem solicitou**. Todo o histórico fica registrado.
* **Fluxo de apuração**: aberto → submetido → aprovado; **encerramento congela** as apurações de departamentos e individuais.
* **Simulação "e se"**, exportação **CSV**, **PDF do acordo do programa** (com campos de assinatura) e **PDF da apuração**.
* Salários visíveis apenas para diretoria/admin; o colaborador vê **o próprio bônus** no painel.

## Módulo 3 — Governança

* **Benchmark/ranking** entre áreas: índice composto (indicadores atingidos, nota de metas, eficácia dos planos) e
  **comparativo do mesmo indicador entre unidades**.
* **Reuniões de análise crítica** com **pauta automática** (desvios sem análise, planos atrasados ou ineficazes, apurações e
  alterações pendentes, encaminhamentos anteriores), ata, decisões com prazo e alerta de atraso. Reuniões corporativas são restritas à diretoria.

## Recursos transversais

* **Perfis de acesso** (admin, diretoria, gestor, colaborador) com visibilidade restrita à própria área e às áreas abaixo dela.
* **Notificações** no sistema, por **e-mail** e em canais do **Teams/Slack**: desvio registrado, lançamento pendente após o
  dia-limite, ação vencendo ou atrasada, eficácia pendente, apuração aguardando aprovação, alteração de meta, @menções.
  Alertas recorrentes não se repetem.
* **Comentários com @menção** e **anexos/evidências** em indicadores, planos e reuniões.
* **Trilha de auditoria** com o usuário responsável por cada alteração.
* **PWA**: instalável no celular, atalho para lançamento rápido; a API nunca é armazenada em cache.
* Interface responsiva, tema claro/escuro, navegação por teclado.

## Segurança

* Senhas com scrypt; sessão em cookie `HttpOnly`/`SameSite=Lax` (use `COOKIE_SECURE=1` com HTTPS); limite de tentativas de login.
* Proteção CSRF por cabeçalho obrigatório nas requisições de escrita autenticadas por cookie.
* Escopo por departamento aplicado no servidor, inclusive em comentários, anexos, pautas e relatórios.
* Anexos com lista de extensões permitidas, nome sanitizado, download com `Content-Security-Policy: sandbox`.
* Integrações (URLs chamadas pelo servidor) só podem ser configuradas por diretoria/admin; segredos de cabeçalho não são exibidos.
* Segregação de funções na aprovação de alterações de metas.

## API (principais rotas)

Autenticação por cookie (navegador) ou `Authorization: Bearer <token>` (integrações).

| Área | Rotas |
|---|---|
| Autenticação | `GET /api/auth/estado`, `POST /api/auth/configurar`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/sso/iniciar` |
| Núcleo | `/api/eu`, `/api/departamentos`, `/api/usuarios`, `/api/tokens`, `/api/configuracoes`, `/api/auditoria` |
| Colaboração | `/api/notificacoes`, `/api/comentarios/:modulo/:entidade/:id`, `/api/anexos/:modulo/:entidade/:id` |
| Indicadores | `/api/indicadores[/:id]`, `…/:id/medicoes`, `…/:id/metas-periodo`, `…/:id/versoes`, `…/:id/cep`, `…/medicoes/:mid/analises`, `…/medicoes/:mid/sugestoes`, `…/importar`, `…/integracoes`, `…/mapa`, `…/objetivos`, `…/painel` |
| Planos | `/api/planos[/:id]`, `/api/planos/:id/acoes`, `/api/planos/acoes/:aid` |
| Metas | `/api/metas/ciclos[/:id]` (+ `/apuracao`, `/gatilho`, `/encerrar`, `/acordo.pdf`, `/apuracao.pdf`, `/exportar.csv`, `/individuais(.csv)`, `/participantes`, `/meu-bonus`, `/desdobramento`), `/api/metas[/:id]`, `/api/metas/:id/resultados`, `/api/metas/colaboradores`, `/api/metas/alteracoes` |
| Governança | `/api/governanca/benchmark`, `/api/governanca/reunioes[/:id]` (+ `/pauta`, `/decisoes`) |

## Limitações e próximos passos

* **Banco de dados**: o SQLite atende bem uma empresa com dezenas de usuários simultâneos. Para uso maior, o caminho é
  migrar para PostgreSQL; como o acesso a dados já está isolado nos serviços, a troca fica concentrada neles (que hoje usam a API
  síncrona do SQLite e precisariam passar a ser assíncronos).
* O agendador roda dentro do processo; com várias instâncias, mantenha só uma com as tarefas ativas.
* Antivírus em anexos e backup automático devem ser providos pela infraestrutura.
