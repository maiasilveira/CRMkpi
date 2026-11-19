'use strict';
// Popula o banco com dados de demonstração. Uso: npm run seed  (apaga o banco atual)
const fs = require('node:fs');
const path = require('node:path');
const { criarApp } = require('./app');

const arquivo = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'kpi.db');
for (const suf of ['', '-wal', '-shm']) fs.rmSync(arquivo + suf, { force: true });

const { core, modulos, colaboracao, encerrar } = criarApp({ dbFile: arquivo, semAgendador: true });
const ind = modulos.indicadores.service;
const met = modulos.metas.service;

const empresa = core.salvarDepartamento({ nome: 'Empresa Demo S.A.', sigla: 'EMP', tipo: 'empresa', gestor: 'Helena Prado' });
const dirCom = core.salvarDepartamento({ nome: 'Diretoria Comercial', sigla: 'DCOM', tipo: 'diretoria', pai_id: empresa.id, gestor: 'Ana Souza' });
const dirOps = core.salvarDepartamento({ nome: 'Diretoria de Operações', sigla: 'DOPS', tipo: 'diretoria', pai_id: empresa.id, gestor: 'Bruno Lima' });
const dirAdm = core.salvarDepartamento({ nome: 'Diretoria Administrativa', sigla: 'DADM', tipo: 'diretoria', pai_id: empresa.id, gestor: 'Carla Mendes' });
const deptos = Object.fromEntries([
  ['Comercial', 'COM', 'Ana Souza', dirCom.id],
  ['Operações', 'OPS', 'Bruno Lima', dirOps.id],
  ['Financeiro', 'FIN', 'Carla Mendes', dirAdm.id],
  ['Recursos Humanos', 'RH', 'Diego Rocha', dirAdm.id],
].map(([nome, sigla, gestor, pai]) => [sigla, core.salvarDepartamento({ nome, sigla, gestor, pai_id: pai }).id]));

// Usuários de demonstração (senha: demo1234)
const SENHA = 'demo1234';
const usuarios = [
  ['Administrador', 'admin@demo.com', 'admin', null],
  ['Helena Prado', 'diretoria@demo.com', 'diretoria', null],
  ['Ana Souza', 'ana@demo.com', 'gestor', deptos.COM],
  ['Bruno Lima', 'bruno@demo.com', 'gestor', deptos.OPS],
  ['Carla Mendes', 'carla@demo.com', 'gestor', deptos.FIN],
  ['Diego Rocha', 'diego@demo.com', 'gestor', deptos.RH],
  ['Eduardo Reis', 'eduardo@demo.com', 'colaborador', deptos.COM],
].map(([nome, email, perfil, departamento_id]) => core.salvarUsuario({ nome, email, perfil, departamento_id, senha: SENHA }, null, { bootstrap: true }));
void usuarios;

const ano = new Date().getFullYear();
const mesAtual = new Date().getMonth() + 1;
const meses = Array.from({ length: Math.max(mesAtual - 1, 3) }, (_, i) => `${ano}-${String(i + 1).padStart(2, '0')}`).slice(0, 12);

const defs = [
  { codigo: 'COM-01', nome: 'Receita líquida mensal', departamento_id: deptos.COM, unidade: 'R$ mil', perspectiva: 'financeira', polaridade: 'maior_melhor', meta: 1200, limite_inferior: 1100, responsavel: 'Ana Souza', serie: [1150, 1210, 1240, 1080, 1190, 1260, 1300, 1050, 1220, 1280, 1310] },
  { codigo: 'COM-02', nome: 'Taxa de conversão de propostas', departamento_id: deptos.COM, unidade: '%', perspectiva: 'clientes', polaridade: 'maior_melhor', meta: 30, limite_inferior: 25, responsavel: 'Ana Souza', serie: [28, 31, 33, 26, 24, 29, 32, 30, 31, 34, 33] },
  { codigo: 'OPS-01', nome: 'Entregas no prazo (OTD)', departamento_id: deptos.OPS, unidade: '%', perspectiva: 'processos', polaridade: 'maior_melhor', meta: 95, limite_inferior: 92, responsavel: 'Bruno Lima', serie: [96, 94, 93, 89, 91, 95, 97, 96, 94, 95, 97] },
  { codigo: 'OPS-02', nome: 'Índice de refugo', departamento_id: deptos.OPS, unidade: '%', perspectiva: 'processos', polaridade: 'menor_melhor', meta: 2, limite_superior: 3, responsavel: 'Bruno Lima', serie: [2.4, 1.9, 1.8, 3.6, 2.7, 2.1, 1.7, 1.9, 1.6, 1.8, 1.5] },
  { codigo: 'OPS-03', nome: 'Temperatura da câmara fria', departamento_id: deptos.OPS, unidade: '°C', perspectiva: 'processos', polaridade: 'faixa', meta: 4, limite_inferior: 2, limite_superior: 6, responsavel: 'Bruno Lima', serie: [4, 3.5, 4.2, 5.1, 6.8, 4.4, 3.9, 4, 4.1, 3.8, 4.3] },
  { codigo: 'FIN-01', nome: 'Inadimplência', departamento_id: deptos.FIN, unidade: '%', perspectiva: 'financeira', polaridade: 'menor_melhor', meta: 3, limite_superior: 4, responsavel: 'Carla Mendes', serie: [3.2, 2.9, 2.8, 3.5, 4.6, 3.9, 3.1, 2.7, 2.9, 2.6, 2.8] },
  { codigo: 'FIN-02', nome: 'Prazo médio de fechamento contábil', departamento_id: deptos.FIN, unidade: 'dias', perspectiva: 'processos', polaridade: 'menor_melhor', meta: 5, limite_superior: 7, responsavel: 'Carla Mendes', serie: [8, 7, 6, 6, 5, 5, 4, 5, 4, 4, 4] },
  { codigo: 'RH-01', nome: 'Turnover mensal', departamento_id: deptos.RH, unidade: '%', perspectiva: 'aprendizado', polaridade: 'menor_melhor', meta: 1.5, limite_superior: 2, responsavel: 'Diego Rocha', serie: [1.4, 1.6, 1.3, 1.8, 2.4, 1.7, 1.2, 1.4, 1.5, 1.1, 1.3] },
  { codigo: 'RH-02', nome: 'Horas de treinamento por colaborador', departamento_id: deptos.RH, unidade: 'h', perspectiva: 'aprendizado', polaridade: 'maior_melhor', meta: 4, limite_inferior: 3, responsavel: 'Diego Rocha', serie: [3.2, 3.8, 4.1, 4.5, 2.6, 3.9, 4.2, 4.4, 4.0, 4.6, 4.8] },
];

const ind0 = modulos.indicadores.service;
const obj = {};
for (const [k, perspectiva, nome, contribui] of [
  ['lucro', 'financeira', 'Crescer com rentabilidade', []],
  ['caixa', 'financeira', 'Preservar o caixa', []],
  ['cliente', 'clientes', 'Conquistar e reter clientes', ['lucro']],
  ['entrega', 'processos', 'Entregar com qualidade e no prazo', ['cliente']],
  ['eficiencia', 'processos', 'Operar com eficiência', ['lucro', 'caixa']],
  ['pessoas', 'aprendizado', 'Desenvolver e reter talentos', ['entrega', 'eficiencia']],
]) {
  const mapa = ind0.salvarObjetivo({ perspectiva, nome, contribui_para: contribui.map((c) => obj[c]) });
  obj[k] = mapa.perspectivas.flatMap((p) => p.objetivos).find((o) => o.nome === nome).id;
}
const objetivoDe = { 'COM-01': 'lucro', 'COM-02': 'cliente', 'OPS-01': 'entrega', 'OPS-02': 'eficiencia', 'OPS-03': 'entrega', 'FIN-01': 'caixa', 'FIN-02': 'eficiencia', 'RH-01': 'pessoas', 'RH-02': 'pessoas' };

const criados = {};
for (const { serie, ...d } of defs) {
  const i = ind.salvar({ ...d, objetivo_id: obj[objetivoDe[d.codigo]] });
  criados[d.codigo] = i;
  meses.forEach((p, k) => ind.registrarMedicao(i.id, { periodo: p, valor: serie[k % serie.length], registrado_por: d.responsavel }));
}

// Meta sazonal: dezembro tem meta de receita maior
ind.salvarMetaPeriodo(criados['COM-01'].id, { periodo: `${ano}-12`, meta: 1500, limite_inferior: 1400 });
// Indicador calculado a partir de outros (custo da má qualidade estimado)
ind.salvar({ codigo: 'OPS-04', nome: 'Receita por ponto de refugo', departamento_id: deptos.OPS, unidade: 'R$ mil', perspectiva: 'processos',
  polaridade: 'maior_melhor', meta: 500, limite_inferior: 400, tipo: 'calculado', formula_calculo: '{COM-01} / {OPS-02}', responsavel: 'Bruno Lima', objetivo_id: obj.eficiencia });

// Análises e planos de exemplo
const medOps = ind.listarMedicoes(criados['OPS-02'].id).find((m) => m.status === 'desvio');
if (medOps) {
  const a = ind.registrarAnalise(medOps.id, {
    tecnica: 'ishikawa', responsavel: 'Bruno Lima',
    causa_raiz: 'Ferramental de corte desgastado sem plano de troca preventiva',
    conteudo: { problema: 'Refugo acima do limite aceitável na linha 2',
      metodo: ['Instrução de setup desatualizada'], maquina: ['Ferramental de corte desgastado'],
      material: ['Lote de matéria-prima fora de especificação'], mao_de_obra: ['Operador novo sem treinamento'],
      medicao: ['Calibração do paquímetro vencida'], meio_ambiente: [] },
  });
  const plano = ind.criarPlano({ indicador_id: criados['OPS-02'].id, analise_id: a.id, titulo: 'Redução do refugo na linha 2', gravidade: 4, urgencia: 4, tendencia_gut: 3,
    objetivo: 'Retornar o refugo para ≤ 2%', responsavel: 'Bruno Lima',
    acoes: [
      { o_que: 'Implantar troca preventiva do ferramental', por_que: 'Eliminar causa raiz do desgaste', onde: 'Linha 2', quando: `${ano}-03-15`, quem: 'Equipe de manutenção', como: 'Plano de manutenção a cada 20 mil ciclos', quanto: 8500, status: 'concluida' },
      { o_que: 'Treinar operadores no novo setup', por_que: 'Padronizar o método', onde: 'Sala de treinamento', quando: `${ano}-03-30`, quem: 'Diego Rocha', como: 'Treinamento prático de 4h', quanto: 1200, status: 'concluida' },
    ] });
  ind.atualizarPlano(plano.id, { status: 'concluido', eficacia: 'eficaz', verificacao_obs: 'Refugo abaixo de 2% por 3 meses consecutivos' });
}
const medFin = ind.listarMedicoes(criados['FIN-01'].id).find((m) => m.status === 'desvio');
if (medFin) {
  const a = ind.registrarAnalise(medFin.id, {
    tecnica: '5porques', responsavel: 'Carla Mendes',
    conteudo: { problema: 'Inadimplência acima de 4%', porques: [
      'Clientes do segmento varejo atrasaram pagamentos',
      'Limite de crédito concedido acima da capacidade',
      'Política de crédito não considera score atualizado',
      'Consulta de crédito é manual e feita apenas no cadastro',
      'Ausência de processo de revisão periódica de limites'] },
  });
  ind.criarPlano({ indicador_id: criados['FIN-01'].id, analise_id: a.id, titulo: 'Revisão da política de crédito', gravidade: 5, urgencia: 4, tendencia_gut: 4,
    responsavel: 'Carla Mendes', objetivo: 'Inadimplência ≤ 3%',
    acoes: [
      { o_que: 'Automatizar consulta de score trimestral', por_que: 'Revisar limites com dados atualizados', onde: 'ERP', quando: `${ano}-08-30`, quem: 'TI + Financeiro', como: 'Integração com bureau de crédito', quanto: 15000, status: 'em_andamento' },
      { o_que: 'Revisar limites da carteira varejo', por_que: 'Reduzir exposição', onde: 'Financeiro', quando: `${ano}-07-15`, quem: 'Carla Mendes', como: 'Comitê de crédito semanal', quanto: 0, status: 'pendente' },
    ] });
}
const medTemp = ind.listarMedicoes(criados['OPS-03'].id).find((m) => m.status === 'desvio');
if (medTemp) {
  ind.registrarAnalise(medTemp.id, { tecnica: '5w2h', responsavel: 'Bruno Lima', causa_raiz: 'Falha no compressor durante pico de calor',
    conteudo: { o_que: 'Temperatura chegou a 6,8 °C', por_que: 'Compressor desarmou por sobrecarga', onde: 'Câmara fria 1',
      quando: 'Tarde do dia 12', quem: 'Turno B', como: 'Detectado pelo registrador de temperatura', quanto: 'R$ 4.000 em perdas de produto' } });
}

// Metas bonificáveis
const regras = { nome: `PLR ${ano}`, inicio: `${ano}-01`, fim: `${ano}-12`, nota_minima: 60, gatilho_corp_descricao: 'EBITDA anual (R$ milhões)', gatilho_corp_minimo: 12,
  peso_departamento_padrao: 70, dias_minimos_mes: 15, redutor_falta_pct: 5, redutor_advertencia_pct: 10, redutor_maximo_pct: 50 };
const ciclo = met.salvarCiclo({ ...regras, status: 'planejamento' });
const metaEmpresa = met.salvarMeta({ ciclo_id: ciclo.id, departamento_id: empresa.id, nome: 'EBITDA da empresa', unidade: 'R$ mi', polaridade: 'maior_melhor', peso: 100, gatilho: 12, alvo: 15, superacao: 18 });
const metasDef = [
  { departamento_id: deptos.COM, nome: 'Receita acumulada', unidade: 'R$ mil', polaridade: 'maior_melhor', peso: 50, gatilho: 12000, alvo: 13500, superacao: 15000, fonte: 'indicador', indicador_id: criados['COM-01'].id, agregacao: 'soma' },
  { departamento_id: deptos.COM, nome: 'Conversão média de propostas', unidade: '%', polaridade: 'maior_melhor', peso: 30, gatilho: 26, alvo: 30, superacao: 34, fonte: 'indicador', indicador_id: criados['COM-02'].id, agregacao: 'media' },
  { departamento_id: deptos.COM, nome: 'NPS de clientes', unidade: 'pts', polaridade: 'maior_melhor', peso: 20, gatilho: 50, alvo: 65, superacao: 75, fonte: 'manual' },
  { departamento_id: deptos.OPS, nome: 'OTD médio', unidade: '%', polaridade: 'maior_melhor', peso: 60, gatilho: 92, alvo: 95, superacao: 97, fonte: 'indicador', indicador_id: criados['OPS-01'].id, agregacao: 'media' },
  { departamento_id: deptos.OPS, nome: 'Refugo médio', unidade: '%', polaridade: 'menor_melhor', peso: 40, gatilho: 3, alvo: 2, superacao: 1.5, fonte: 'indicador', indicador_id: criados['OPS-02'].id, agregacao: 'media' },
  { departamento_id: deptos.FIN, nome: 'Redução de despesas administrativas', unidade: '%', polaridade: 'maior_melhor', peso: 50, gatilho: 3, alvo: 5, superacao: 8, fonte: 'manual' },
  { departamento_id: deptos.FIN, nome: 'Inadimplência média', unidade: '%', polaridade: 'menor_melhor', peso: 50, gatilho: 4, alvo: 3, superacao: 2.5, fonte: 'indicador', indicador_id: criados['FIN-01'].id, agregacao: 'media' },
  { departamento_id: deptos.RH, nome: 'Turnover médio', unidade: '%', polaridade: 'menor_melhor', peso: 60, gatilho: 2, alvo: 1.5, superacao: 1.2, fonte: 'indicador', indicador_id: criados['RH-01'].id, agregacao: 'media' },
  { departamento_id: deptos.RH, nome: 'Clima organizacional', unidade: '%', polaridade: 'maior_melhor', peso: 40, gatilho: 70, alvo: 80, superacao: 90, fonte: 'manual' },
];
const metas = metasDef.map((m) => met.salvarMeta({ ...m, ciclo_id: ciclo.id, meta_pai_id: metaEmpresa.id, responsavel: core.obterDepartamento(m.departamento_id).gestor }));
met.registrarResultado(metaEmpresa.id, { periodo: `${ano}-09`, valor: 13.8, observacao: 'Projeção do controller' });
const ultimo = meses[meses.length - 1];
met.registrarResultado(metas[2].id, { periodo: ultimo, valor: 68, observacao: 'Pesquisa semestral' });
met.registrarResultado(metas[5].id, { periodo: ultimo, valor: 4.2 });
met.registrarResultado(metas[8].id, { periodo: ultimo, valor: 77, observacao: 'Pesquisa de clima' });
for (const [s, v] of [['COM', 120000], ['OPS', 90000], ['FIN', 60000], ['RH', 45000]]) met.definirBonus(ciclo.id, deptos[s], { valor_base: v });
met.transicionar(ciclo.id, deptos.OPS, 'submeter', 'Bruno Lima');

// Colaboradores, participação e metas individuais
const pessoas = modulos.metas.pessoas;
const colabs = [
  ['1001', 'Ana Souza', 'ana@demo.com', 'COM', 'Gerente comercial', 18000, '2019-03-01'],
  ['1002', 'Eduardo Reis', 'eduardo@demo.com', 'COM', 'Executivo de contas', 9000, `${ano}-04-10`],
  ['1003', 'Fernanda Luz', null, 'COM', 'Executiva de contas', 9500, '2021-06-01'],
  ['2001', 'Bruno Lima', 'bruno@demo.com', 'OPS', 'Gerente industrial', 17000, '2018-01-15'],
  ['2002', 'Gustavo Alves', null, 'OPS', 'Supervisor de produção', 8000, '2020-02-01'],
  ['3001', 'Carla Mendes', 'carla@demo.com', 'FIN', 'Gerente financeira', 16000, '2017-05-01'],
  ['4001', 'Diego Rocha', 'diego@demo.com', 'RH', 'Gerente de RH', 15000, '2016-09-01'],
].map(([matricula, nome, email, dep, cargo, salario, admissao]) => pessoas.salvarColaborador({ matricula, nome, email, departamento_id: deptos[dep], cargo, salario, admissao }));
pessoas.incluirTodos(ciclo.id, 2);
pessoas.salvarParticipacao(ciclo.id, colabs[0].id, { multiplo_salarios: 3, peso_departamento: 60 });
pessoas.salvarParticipacao(ciclo.id, colabs[4].id, { multiplo_salarios: 2, faltas: 2, advertencias: 1 });
const mInd = met.salvarMeta({ ciclo_id: ciclo.id, colaborador_id: colabs[1].id, nome: 'Novos clientes conquistados', unidade: 'clientes', polaridade: 'maior_melhor',
  peso: 100, gatilho: 8, alvo: 12, superacao: 16, agregacao: 'soma', meta_pai_id: metas[0].id });
for (const [m, v] of [[`${ano}-05`, 2], [`${ano}-06`, 3], [`${ano}-07`, 2], [`${ano}-08`, 3]]) met.registrarResultado(mInd.id, { periodo: m, valor: v });

// Ciclo entra em vigor: a partir daqui, alterações de metas exigem aprovação
met.salvarCiclo({ ...regras, status: 'ativo', gatilho_corp_resultado: 13.8 }, ciclo.id);
met.salvarMeta({ ...metas[5], justificativa: 'Corte de orçamento aprovado em comitê: meta de redução de despesas ampliada', alvo: 6 }, metas[5].id);

// Reunião de análise crítica e comentário
const gov = modulos.governanca.service;
const reuniao = gov.salvarReuniao({ titulo: 'Análise crítica mensal — Operações', data: `${ano}-${String(mesAtual).padStart(2, '0')}-05`, departamento_id: deptos.OPS, participantes: 'Bruno Lima, Gustavo Alves, Diego Rocha' });
gov.salvarDecisao(reuniao.id, { descricao: 'Avaliar a compra de um segundo compressor para a câmara fria', responsavel: 'Bruno Lima', prazo: `${ano}-12-15` });
colaboracao.comentar('indicadores', 'indicador', criados['OPS-03'].id, 'Precisamos de redundância no compressor. @bruno vamos levar para a reunião de análise crítica?');
encerrar();

console.log(`Banco de demonstração criado em ${arquivo}`);
console.log(`${defs.length + 1} indicadores, ${meses.length} meses de medições, ciclo "${ciclo.nome}" com ${metas.length + 2} metas e ${colabs.length} colaboradores.`);
console.log(`Usuários (senha ${SENHA}): admin@demo.com, diretoria@demo.com, ana@demo.com (gestora Comercial), bruno@demo.com, carla@demo.com, diego@demo.com, eduardo@demo.com (colaborador).`);
