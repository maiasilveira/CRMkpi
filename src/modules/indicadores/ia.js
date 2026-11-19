'use strict';
// Assistente de análise de desvios: sugere causas prováveis e ações a partir do histórico.
// Modo "historico" (sempre disponível, local) + modo "claude" (opcional, via API da Anthropic).
const E = require('../../core/erros');

const MODELO_PADRAO = 'claude-opus-5-5';
const CATEGORIAS = ['metodo', 'maquina', 'material', 'mao_de_obra', 'medicao', 'meio_ambiente', 'outro'];

const ESQUEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['resumo', 'causas_provaveis', 'acoes_sugeridas', 'perguntas_para_investigar'],
  properties: {
    resumo: { type: 'string' },
    causas_provaveis: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['causa', 'categoria_6m', 'justificativa', 'confianca', 'baseada_no_historico'],
      properties: { causa: { type: 'string' }, categoria_6m: { type: 'string', enum: CATEGORIAS }, justificativa: { type: 'string' },
        confianca: { type: 'string', enum: ['alta', 'media', 'baixa'] }, baseada_no_historico: { type: 'boolean' } } } },
    acoes_sugeridas: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['o_que', 'por_que', 'como', 'tipo', 'prazo_dias'],
      properties: { o_que: { type: 'string' }, por_que: { type: 'string' }, como: { type: 'string' },
        tipo: { type: 'string', enum: ['contencao', 'corretiva', 'preventiva'] }, prazo_dias: { type: 'integer' } } } },
    perguntas_para_investigar: { type: 'array', items: { type: 'string' } },
  },
};

const SISTEMA = `Você é um especialista em gestão da qualidade e melhoria contínua (PDCA, MASP, Lean Seis Sigma) que apoia gestores
de uma empresa brasileira a analisar desvios de indicadores de desempenho.
Com base nos dados do indicador, na série histórica e nas análises e planos anteriores da empresa, proponha:
- causas prováveis, classificadas nas categorias do diagrama de Ishikawa (6M), indicando se cada uma se apoia no histórico fornecido;
- ações de contenção, corretivas e preventivas, concretas e verificáveis, no formato 5W2H resumido;
- perguntas que o gestor deve responder para confirmar a causa raiz.
Priorize causas e ações que já se mostraram eficazes no histórico, mas não as repita se o histórico indicar que não foram eficazes.
Seja específico para o contexto do indicador; evite recomendações genéricas. Responda em português do Brasil.
São hipóteses para orientar a investigação, não conclusões: a confirmação depende dos dados do gestor.`;

function criarIaService(db, core, ind, { cliente } = {}) {
  let clienteCache = cliente || null;
  function clienteClaude() {
    if (clienteCache) return clienteCache;
    const Anthropic = require('@anthropic-ai/sdk');
    clienteCache = new Anthropic.default ? new Anthropic.default() : new Anthropic();
    return clienteCache;
  }
  const iaHabilitada = () => core.obterConfig('ia_habilitada') === '1' && (!!cliente || !!process.env.ANTHROPIC_API_KEY || !!process.env.ANTHROPIC_AUTH_TOKEN);

  function contexto(medicaoId) {
    const med = db.prepare('SELECT * FROM ind_medicoes WHERE id=?').get(medicaoId);
    if (!med) throw new E.NaoEncontrado('Medição');
    const i = ind.obter(med.indicador_id);
    const serie = db.prepare('SELECT periodo, valor, status FROM ind_medicoes WHERE indicador_id=? ORDER BY periodo DESC LIMIT 18').all(i.id).reverse();
    // Histórico: análises do próprio indicador e de outros do mesmo departamento
    const analises = db.prepare(`SELECT a.id, a.tecnica, a.causa_raiz, a.conteudo, m.periodo, m.valor, i.id indicador_id, i.nome indicador
        FROM ind_analises a JOIN ind_medicoes m ON m.id=a.medicao_id JOIN ind_indicadores i ON i.id=m.indicador_id
        WHERE i.departamento_id=? ORDER BY a.id DESC LIMIT 40`).all(i.departamento_id);
    const planos = db.prepare(`SELECT p.id, p.titulo, p.analise_id, p.eficacia, p.status, p.verificacao_obs, i.id indicador_id FROM ind_planos p
        JOIN ind_indicadores i ON i.id=p.indicador_id WHERE i.departamento_id=? ORDER BY p.id DESC LIMIT 40`).all(i.departamento_id)
      .map((p) => ({ ...p, acoes: db.prepare('SELECT o_que, como, status FROM ind_acoes WHERE plano_id=?').all(p.id) }));
    return { med, i, serie, analises, planos };
  }

  /** Sugestões locais: reaproveita causas e ações do histórico, priorizando o mesmo indicador e planos eficazes. */
  function porHistorico({ i, analises, planos }) {
    const pontuar = (a) => (a.indicador_id === i.id ? 3 : 1) + (planos.some((p) => p.analise_id === a.id && p.eficacia === 'eficaz') ? 2 : 0)
      - (planos.some((p) => p.analise_id === a.id && p.eficacia === 'nao_eficaz') ? 2 : 0);
    const vistas = new Set();
    const causas = analises.filter((a) => a.causa_raiz).sort((a, b) => pontuar(b) - pontuar(a))
      .filter((a) => { const k = a.causa_raiz.toLowerCase(); if (vistas.has(k)) return false; vistas.add(k); return true; })
      .slice(0, 5).map((a) => ({ causa: a.causa_raiz, categoria_6m: 'outro', confianca: pontuar(a) >= 4 ? 'alta' : pontuar(a) >= 3 ? 'media' : 'baixa',
        baseada_no_historico: true, justificativa: `Causa raiz identificada em ${a.periodo} (${a.indicador}, técnica ${a.tecnica}).` }));
    const acoes = planos.filter((p) => p.eficacia === 'eficaz').sort((a, b) => (b.indicador_id === i.id) - (a.indicador_id === i.id))
      .flatMap((p) => p.acoes.map((a) => ({ o_que: a.o_que, por_que: `Ação de plano eficaz anterior: "${p.titulo}"`, como: a.como || '', tipo: 'corretiva', prazo_dias: 30 })))
      .slice(0, 6);
    return {
      fonte: 'historico',
      resumo: causas.length ? `Encontradas ${causas.length} causa(s) já registradas em desvios semelhantes do departamento.` : 'Não há histórico suficiente de análises neste departamento.',
      causas_provaveis: causas, acoes_sugeridas: acoes,
      perguntas_para_investigar: ['O que mudou no processo neste período (pessoas, insumos, equipamentos, método)?',
        'O desvio é pontual ou há tendência nos últimos períodos?', 'Os dados de medição são confiáveis neste período?'],
    };
  }

  async function porClaude(ctx) {
    const { med, i, serie, analises, planos } = ctx;
    const dados = {
      indicador: { nome: i.nome, descricao: i.descricao, unidade: i.unidade, formula: i.formula, polaridade: i.polaridade, departamento: i.departamento,
        meta: med.meta, limite_inferior: med.limite_inferior, limite_superior: med.limite_superior },
      desvio: { periodo: med.periodo, valor: med.valor, status: med.status, comentario: med.comentario },
      serie_historica: serie,
      analises_anteriores: analises.slice(0, 20).map((a) => ({ indicador: a.indicador, periodo: a.periodo, tecnica: a.tecnica, causa_raiz: a.causa_raiz,
        detalhes: JSON.parse(a.conteudo) })),
      planos_anteriores: planos.slice(0, 20).map((p) => ({ titulo: p.titulo, status: p.status, eficacia: p.eficacia, verificacao: p.verificacao_obs,
        acoes: p.acoes.map((a) => a.o_que) })),
    };
    const resp = await clienteClaude().beta.messages.create({
      model: process.env.ANTHROPIC_MODEL || MODELO_PADRAO,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default', // em caso de recusa, a própria API tenta novamente em um modelo alternativo
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: ESQUEMA } },
      system: SISTEMA,
      messages: [{ role: 'user', content: `Dados do desvio e histórico (JSON):\n${JSON.stringify(dados)}` }],
    });
    if (resp.stop_reason === 'refusal') throw new Error('o modelo recusou a solicitação');
    if (resp.stop_reason === 'max_tokens') throw new Error('resposta truncada');
    const texto = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    return { fonte: 'claude', modelo: resp.model, ...JSON.parse(texto) };
  }

  async function sugerir(medicaoId) {
    const ctx = contexto(medicaoId);
    core.garantirEditar(ctx.i.departamento_id);
    const base = porHistorico(ctx);
    if (!iaHabilitada()) return { ...base, aviso: 'Assistente de IA desativado: sugestões baseadas apenas no histórico da empresa.' };
    try {
      const r = await porClaude(ctx);
      core.auditar('indicadores', 'ia_sugestao', medicaoId, 'gerar', { modelo: r.modelo });
      return r;
    } catch (e) {
      console.error('[ia]', e.message);
      return { ...base, aviso: `Não foi possível consultar o assistente de IA (${e.message}). Exibindo sugestões do histórico.` };
    }
  }

  return { sugerir, iaHabilitada, ESQUEMA };
}

module.exports = { criarIaService, MODELO_PADRAO };
