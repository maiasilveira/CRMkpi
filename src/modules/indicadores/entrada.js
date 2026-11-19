'use strict';
// Entrada automatizada de dados: importação de planilhas e integrações HTTP/JSON.
const E = require('../../core/erros');
const { lerPlanilha, periodoDe, numeroDe } = require('../../core/planilha');
const { transacao } = require('../../db');
const { periodoAnterior } = require('./alertas');

function criarEntradaService(db, core, ind) {
  // ---------- Importação ----------
  /**
   * Colunas: codigo, periodo, valor, comentario (opcional).
   * Com simular=true valida tudo e não grava. Linhas inválidas não impedem as válidas.
   */
  async function importarMedicoes(nomeArquivo, conteudo, { simular = false } = {}) {
    const linhas = await lerPlanilha(nomeArquivo, conteudo);
    E.exigir('codigo' in linhas[0].dados && 'periodo' in linhas[0].dados && 'valor' in linhas[0].dados,
      'Cabeçalho deve conter as colunas: codigo, periodo, valor (e opcionalmente comentario)');
    const resultado = [];
    const executar = () => {
      for (const { linha, dados } of linhas) {
        try {
          const i = ind.porCodigo(String(dados.codigo ?? '').trim());
          E.exigir(i, `Indicador "${dados.codigo}" não encontrado`);
          const valor = numeroDe(dados.valor);
          E.exigir(valor !== null && !Number.isNaN(valor), `Valor inválido: "${dados.valor}"`);
          const periodo = periodoDe(dados.periodo);
          if (simular) {
            core.garantirEditar(i.departamento_id);
            E.periodo(periodo);
            E.exigir(i.tipo !== 'calculado', 'Indicador calculado não aceita lançamento');
            resultado.push({ linha, ok: true, codigo: i.codigo, periodo, valor });
          } else {
            const m = ind.registrarMedicao(i.id, { periodo, valor, comentario: dados.comentario || 'Importado de planilha' });
            resultado.push({ linha, ok: true, codigo: i.codigo, periodo, valor, status: m.status });
          }
        } catch (e) {
          resultado.push({ linha, ok: false, erro: e.message });
        }
      }
    };
    if (simular) executar(); else transacao(db, executar);
    const ok = resultado.filter((r) => r.ok).length;
    if (!simular) core.auditar('indicadores', 'importacao', null, 'importar', { arquivo: nomeArquivo, ok, erros: resultado.length - ok });
    return { simulacao: simular, total: resultado.length, importadas: ok, erros: resultado.length - ok, linhas: resultado };
  }

  // ---------- Integrações ----------
  function valorPorCaminho(obj, caminho) {
    return String(caminho).split('.').reduce((o, k) => {
      if (o === null || o === undefined) return undefined;
      const m = /^(\w+)\[(\d+)\]$/.exec(k);
      return m ? o[m[1]]?.[Number(m[2])] : o[k];
    }, obj);
  }
  function validarUrl(u) {
    let url;
    try { url = new URL(u); } catch { throw new E.ErroValidacao('URL inválida'); }
    E.exigir(['http:', 'https:'].includes(url.protocol), 'A URL deve usar http ou https');
    return url.toString();
  }
  const publicar = (r) => r && ({ ...r, cabecalhos: r.cabecalhos ? Object.keys(JSON.parse(r.cabecalhos)) : [] });
  function listarIntegracoes() {
    core.exigirPerfil('diretoria');
    return db.prepare(`SELECT g.*, i.nome AS indicador, i.codigo FROM ind_integracoes g JOIN ind_indicadores i ON i.id=g.indicador_id ORDER BY i.nome`).all().map(publicar);
  }
  function salvarIntegracao(d) {
    // Configurar URLs chamadas pelo servidor é restrito (evita uso indevido para acessar a rede interna)
    core.exigirPerfil('diretoria');
    const indicadorId = E.numero(d.indicador_id, 'indicador_id', { obrigatorio: true });
    const i = ind.obter(indicadorId);
    E.exigir(i.tipo !== 'calculado', 'Indicadores calculados não usam integração');
    const url = validarUrl(E.texto(d.url, 'url', { obrigatorio: true }));
    let cab = null;
    if (d.cabecalhos && typeof d.cabecalhos === 'object' && Object.keys(d.cabecalhos).length) cab = JSON.stringify(d.cabecalhos);
    else if (d.manter_cabecalhos) cab = db.prepare('SELECT cabecalhos FROM ind_integracoes WHERE indicador_id=?').get(indicadorId)?.cabecalhos ?? null;
    db.prepare(`INSERT INTO ind_integracoes (indicador_id, url, cabecalhos, caminho, periodo_ref, ativo) VALUES (?,?,?,?,?,?)
        ON CONFLICT(indicador_id) DO UPDATE SET url=excluded.url, cabecalhos=excluded.cabecalhos, caminho=excluded.caminho, periodo_ref=excluded.periodo_ref, ativo=excluded.ativo`)
      .run(indicadorId, url, cab, E.texto(d.caminho, 'caminho', { obrigatorio: true }), E.umDe(d.periodo_ref, 'periodo_ref', ['anterior', 'atual'], 'anterior'), d.ativo === false ? 0 : 1);
    core.auditar('indicadores', 'integracao', indicadorId, 'salvar', { url, caminho: d.caminho });
    return publicar(db.prepare('SELECT * FROM ind_integracoes WHERE indicador_id=?').get(indicadorId));
  }
  function excluirIntegracao(id) { core.exigirPerfil('diretoria'); db.prepare('DELETE FROM ind_integracoes WHERE id=?').run(id); }

  async function executarIntegracao(id) {
    const g = db.prepare('SELECT * FROM ind_integracoes WHERE id=?').get(id);
    if (!g) throw new E.NaoEncontrado('Integração');
    const agora = new Date();
    const periodo = g.periodo_ref === 'atual' ? agora.toISOString().slice(0, 7) : periodoAnterior(agora);
    let status;
    try {
      const r = await fetch(g.url, { headers: { Accept: 'application/json', ...(g.cabecalhos ? JSON.parse(g.cabecalhos) : {}) }, signal: AbortSignal.timeout(15000), redirect: 'error' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const v = numeroDe(valorPorCaminho(await r.json(), g.caminho));
      if (v === null || Number.isNaN(v)) throw new Error(`Caminho "${g.caminho}" não retornou número`);
      const m = ind.registrarMedicao(g.indicador_id, { periodo, valor: v, comentario: 'Coletado por integração', registrado_por: 'integração' });
      status = `ok: ${periodo} = ${v} (${m.status})`;
    } catch (e) {
      status = `erro: ${e.message}`;
    }
    db.prepare(`UPDATE ind_integracoes SET ultima_execucao=datetime('now'), ultimo_status=? WHERE id=?`).run(status, id);
    return { id, status };
  }
  async function executarTodas() {
    const ids = db.prepare('SELECT id FROM ind_integracoes WHERE ativo=1').all().map((r) => r.id);
    const r = [];
    for (const id of ids) r.push(await executarIntegracao(id));
    return r;
  }

  return { importarMedicoes, listarIntegracoes, salvarIntegracao, excluirIntegracao, executarIntegracao, executarTodas, valorPorCaminho };
}

module.exports = { criarEntradaService };
