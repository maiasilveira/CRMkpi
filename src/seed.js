'use strict';
// Popula o banco com dados de demonstração. Uso: npm run seed  (apaga o banco atual)
const fs = require('node:fs');
const path = require('node:path');
const { criarApp } = require('./app');

const arquivo = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'kpi.db');
for (const suf of ['', '-wal', '-shm']) fs.rmSync(arquivo + suf, { force: true });

const { core, modulos } = criarApp({ dbFile: arquivo });
const ind = modulos.indicadores.service;
const met = modulos.metas.service;

const deptos = Object.fromEntries([
  ['Comercial', 'COM', 'Ana Souza'],
  ['Operações', 'OPS', 'Bruno Lima'],
  ['Financeiro', 'FIN', 'Carla Mendes'],
  ['Recursos Humanos', 'RH', 'Diego Rocha'],
].map(([nome, sigla, gestor]) => [sigla, core.salvarDepartamento({ nome, sigla, gestor }).id]));

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

const criados = {};
for (const { serie, ...d } of defs) {
  const i = ind.salvar(d);
  criados[d.codigo] = i;
  meses.forEach((p, k) => ind.registrarMedicao(i.id, { periodo: p, valor: serie[k % serie.length], registrado_por: d.responsavel }));
}

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
  const plano = ind.criarPlano({ indicador_id: criados['OPS-02'].id, analise_id: a.id, titulo: 'Redução do refugo na linha 2',
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
  ind.criarPlano({ indicador_id: criados['FIN-01'].id, analise_id: a.id, titulo: 'Revisão da política de crédito',
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
const ciclo = met.salvarCiclo({ nome: `PLR ${ano}`, inicio: `${ano}-01`, fim: `${ano}-12`, status: 'ativo', nota_minima: 60 });
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
const metas = metasDef.map((m) => met.salvarMeta({ ...m, ciclo_id: ciclo.id, responsavel: core.obterDepartamento(m.departamento_id).gestor }));
const ultimo = meses[meses.length - 1];
met.registrarResultado(metas[2].id, { periodo: ultimo, valor: 68, observacao: 'Pesquisa semestral' });
met.registrarResultado(metas[5].id, { periodo: ultimo, valor: 4.2 });
met.registrarResultado(metas[8].id, { periodo: ultimo, valor: 77, observacao: 'Pesquisa de clima' });
for (const [s, v] of [['COM', 120000], ['OPS', 90000], ['FIN', 60000], ['RH', 45000]]) met.definirBonus(ciclo.id, deptos[s], { valor_base: v });
met.transicionar(ciclo.id, deptos.OPS, 'submeter', 'Bruno Lima');

console.log(`Banco de demonstração criado em ${arquivo}`);
console.log(`${defs.length} indicadores, ${meses.length} meses de medições, ciclo "${ciclo.nome}" com ${metas.length} metas.`);
