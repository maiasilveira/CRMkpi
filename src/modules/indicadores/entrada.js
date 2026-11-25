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
        // Linha do modelo deixada sem valor: ignorada (não é erro).
        if (dados.valor === null || dados.valor === undefined || String(dados.valor).trim() === '') {
          resultado.push({ linha, ok: true, ignorada: true, codigo: String(dados.codigo ?? '').trim(), periodo: dados.periodo ? periodoDe(dados.periodo) : '' });
          continue;
        }
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
    const ignoradas = resultado.filter((r) => r.ignorada).length;
    const ok = resultado.filter((r) => r.ok && !r.ignorada).length;
    const erros = resultado.filter((r) => !r.ok).length;
    if (!simular) core.auditar('indicadores', 'importacao', null, 'importar', { arquivo: nomeArquivo, ok, erros, ignoradas });
    return { simulacao: simular, total: resultado.length - ignoradas, importadas: ok, erros, ignoradas, linhas: resultado };
  }

  /**
   * Modelo de importação já preenchido com os indicadores que o usuário pode lançar
   * (ativos, com código, não calculados, de departamentos que ele edita). As colunas
   * indicador/departamento/unidade/meta são só para orientação e são ignoradas na importação.
   */
  async function modeloImportacao({ formato = 'xlsx', periodo } = {}) {
    const per = periodo ? E.periodo(periodoDe(periodo)) : periodoAnterior();
    const inds = ind.listar().filter((i) => i.codigo && i.tipo !== 'calculado' && core.podeEditar(i.departamento_id))
      .sort((a, b) => a.departamento.localeCompare(b.departamento, 'pt-BR') || a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }));
    const colunas = ['codigo', 'indicador', 'departamento', 'unidade', 'meta', 'periodo', 'valor', 'comentario'];
    const linhas = inds.map((i) => [i.codigo, i.nome, i.departamento, i.unidade || '', i.meta, per, null, '']);
    if (formato === 'csv') {
      const esc = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const num = (v) => (typeof v === 'number' ? String(v).replace('.', ',') : v);
      return { tipo: 'text/csv; charset=utf-8', nome: `modelo-medicoes-${per}.csv`,
        conteudo: '﻿' + [colunas, ...linhas].map((l) => l.map((v) => esc(num(v))).join(';')).join('\r\n') + '\r\n' };
    }
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Medições', { views: [{ state: 'frozen', ySplit: 1, xSplit: 2 }] });
    ws.columns = [
      { header: 'codigo', key: 'codigo', width: 12 }, { header: 'indicador', key: 'indicador', width: 46 },
      { header: 'departamento', key: 'departamento', width: 26 }, { header: 'unidade', key: 'unidade', width: 10 },
      { header: 'meta', key: 'meta', width: 10 }, { header: 'periodo', key: 'periodo', width: 10, style: { numFmt: '@' } },
      { header: 'valor', key: 'valor', width: 12 }, { header: 'comentario', key: 'comentario', width: 40 },
    ];
    for (const l of linhas) ws.addRow(l);
    const cab = ws.getRow(1);
    cab.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cab.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5BD3' } };
    // Colunas de orientação em cinza; colunas a preencher em amarelo claro.
    for (let r = 2; r <= linhas.length + 1; r++) {
      for (const c of [2, 3, 4, 5]) ws.getCell(r, c).font = { color: { argb: 'FF666666' } };
      for (const c of [7, 8]) ws.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF8DC' } };
      ws.getCell(r, 6).numFmt = '@';
    }
    const ajuda = wb.addWorksheet('Instruções');
    ajuda.getColumn(1).width = 110;
    [
      'Como preencher',
      '1. Preencha a coluna "valor" de cada indicador (pode usar vírgula decimal). Linhas sem valor são ignoradas.',
      '2. Confira a coluna "periodo" (formato AAAA-MM). Para lançar outro mês, altere o período na linha.',
      '3. "comentario" é opcional.',
      '4. As colunas indicador, departamento, unidade e meta são apenas para identificação: não altere a coluna "codigo".',
      '5. No sistema: Importar medições → escolha este arquivo → "Validar (simulação)" → "Importar".',
      `Gerado em ${new Date().toLocaleString('pt-BR')} com ${linhas.length} indicador(es) que você pode lançar.`,
    ].forEach((t, i) => { const c = ajuda.getCell(i + 1, 1); c.value = t; if (!i) c.font = { bold: true, size: 13 }; });
    return { tipo: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', nome: `modelo-medicoes-${per}.xlsx`,
      conteudo: Buffer.from(await wb.xlsx.writeBuffer()) };
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

  return { importarMedicoes, modeloImportacao, listarIntegracoes, salvarIntegracao, excluirIntegracao, executarIntegracao, executarTodas, valorPorCaminho };
}

module.exports = { criarEntradaService };
