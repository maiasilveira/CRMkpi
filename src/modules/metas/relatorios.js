'use strict';
// Relatórios PDF: acordo do programa de metas (regras) e apuração final.
const PDFDocument = require('pdfkit');

const moeda = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (v, c = 2) => (v === null || v === undefined ? '-' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: c }));
const pct = (v) => (v === null || v === undefined ? '-' : `${num(v, 1)}%`);
const mes = (p) => { const [a, m] = p.split('-'); return `${m}/${a}`; };
const COR = '#2f5bd3';

function novoDoc(titulo) {
  const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: titulo, Producer: 'KPI & Metas' }, bufferPages: true });
  return doc;
}
function cabecalho(doc, titulo, sub) {
  doc.fillColor(COR).fontSize(18).font('Helvetica-Bold').text(titulo);
  if (sub) doc.moveDown(0.2).fillColor('#555').fontSize(10).font('Helvetica').text(sub);
  doc.moveDown(0.6).strokeColor('#ccc').lineWidth(1).moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke();
  doc.moveDown(0.6).fillColor('#000');
}
function secao(doc, t) {
  if (doc.y > doc.page.height - 140) doc.addPage();
  doc.moveDown(0.5).fillColor(COR).fontSize(12).font('Helvetica-Bold').text(t).moveDown(0.3).fillColor('#000').font('Helvetica').fontSize(9.5);
}
/** Tabela simples com quebra de página. colunas: [{ titulo, largura, alinhar }] */
function tabela(doc, colunas, linhas) {
  const x0 = doc.page.margins.left;
  const desenharLinha = (vals, negrito, fundo) => {
    const alturas = vals.map((v, i) => doc.font(negrito ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).heightOfString(String(v ?? ''), { width: colunas[i].largura - 6 }));
    const h = Math.max(...alturas) + 6;
    if (doc.y + h > doc.page.height - doc.page.margins.bottom) { doc.addPage(); if (!negrito) desenharLinha(colunas.map((c) => c.titulo), true, '#eef1f8'); }
    const y = doc.y;
    if (fundo) doc.rect(x0, y, colunas.reduce((s, c) => s + c.largura, 0), h).fill(fundo).fillColor('#000');
    let x = x0;
    vals.forEach((v, i) => {
      doc.font(negrito ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor('#000')
        .text(String(v ?? ''), x + 3, y + 3, { width: colunas[i].largura - 6, align: colunas[i].alinhar || 'left' });
      x += colunas[i].largura;
    });
    doc.strokeColor('#e3e3e3').moveTo(x0, y + h).lineTo(x, y + h).stroke();
    doc.x = x0; doc.y = y + h;
  };
  desenharLinha(colunas.map((c) => c.titulo), true, '#eef1f8');
  linhas.forEach((l) => desenharLinha(l, false));
  doc.moveDown(0.5);
}
function rodapes(doc, texto) {
  const r = doc.bufferedPageRange();
  for (let i = r.start; i < r.start + r.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.fontSize(7.5).fillColor('#888').text(`${texto} — página ${i + 1} de ${r.count}`, doc.page.margins.left, doc.page.height - 30,
      { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: 'center' });
    doc.page.margins.bottom = bottom;
  }
}
const finalizar = (doc) => new Promise((ok, erro) => {
  const partes = [];
  doc.on('data', (c) => partes.push(c)); doc.on('end', () => ok(Buffer.concat(partes))); doc.on('error', erro);
  doc.end();
});

function regrasDoPrograma(doc, ciclo) {
  secao(doc, '1. Regras gerais');
  const regras = [
    `Período de apuração: ${mes(ciclo.inicio)} a ${mes(ciclo.fim)}.`,
    `Nota do departamento = soma de (peso da meta x % de atingimento). Os pesos de cada departamento somam 100%.`,
    `Curva de pagamento de cada meta: abaixo do gatilho = 0%; no gatilho = % definido na meta; no alvo = 100%; na superação = teto definido na meta; valores intermediários são interpolados linearmente.`,
    `Nota mínima do departamento para haver pagamento: ${pct(ciclo.nota_minima)}.`,
  ];
  if (ciclo.gatilho_corp_minimo !== null && ciclo.gatilho_corp_minimo !== undefined) {
    regras.push(`Gatilho corporativo: ${ciclo.gatilho_corp_descricao || 'indicador corporativo'} igual ou superior a ${num(ciclo.gatilho_corp_minimo)}. Se não for atingido, não há pagamento para nenhum participante.`);
  }
  regras.push(`Bônus individual = salário x múltiplo salarial x fator pró-rata x nota final x (1 - redutores).`);
  regras.push(`Nota final individual = ${num(ciclo.peso_departamento_padrao, 0)}% da nota do departamento + ${num(100 - ciclo.peso_departamento_padrao, 0)}% da nota das metas individuais (quando houver), salvo percentual específico definido para o participante.`);
  regras.push(`Pró-rata: conta-se cada mês do ciclo em que o participante trabalhou ao menos ${ciclo.dias_minimos_mes} dias.`);
  if (ciclo.redutor_falta_pct || ciclo.redutor_advertencia_pct) {
    regras.push(`Redutores: ${pct(ciclo.redutor_falta_pct)} por falta injustificada e ${pct(ciclo.redutor_advertencia_pct)} por advertência, limitados a ${pct(ciclo.redutor_maximo_pct)}.`);
  }
  regras.forEach((r, i) => doc.text(`${i + 1}.  ${r}`, { paragraphGap: 3 }));
}

async function pdfAcordo(ciclo, metasPorDepto) {
  const doc = novoDoc(`Acordo — ${ciclo.nome}`);
  cabecalho(doc, `Acordo do Programa de Metas — ${ciclo.nome}`, `Vigência ${mes(ciclo.inicio)} a ${mes(ciclo.fim)} · Situação do ciclo: ${ciclo.status}`);
  regrasDoPrograma(doc, ciclo);
  secao(doc, '2. Metas por departamento');
  for (const [depto, lista] of metasPorDepto) {
    doc.font('Helvetica-Bold').fontSize(10).text(depto).font('Helvetica').moveDown(0.2);
    tabela(doc, [
      { titulo: 'Meta', largura: 170 }, { titulo: 'Peso', largura: 40, alinhar: 'right' }, { titulo: 'Gatilho', largura: 55, alinhar: 'right' },
      { titulo: 'Alvo', largura: 55, alinhar: 'right' }, { titulo: 'Superação', largura: 60, alinhar: 'right' }, { titulo: 'Curva', largura: 60, alinhar: 'center' },
      { titulo: 'Fonte', largura: 59 },
    ], lista.map((m) => [`${m.nome}${m.unidade ? ` (${m.unidade})` : ''}${m.polaridade === 'menor_melhor' ? ' [menor é melhor]' : ''}`, `${num(m.peso)}%`, num(m.gatilho), num(m.alvo), num(m.superacao),
      `${num(m.pct_gatilho, 0)}-100-${num(m.pct_superacao, 0)}%`, m.fonte === 'indicador' ? 'Indicador' : 'Manual']));
  }
  secao(doc, '3. Assinaturas');
  doc.moveDown(2);
  const larg = (doc.page.width - doc.page.margins.left - doc.page.margins.right - 40) / 3;
  const y = doc.y;
  ['Empresa', 'Comissão de empregados', 'Sindicato'].forEach((t, i) => {
    const x = doc.page.margins.left + i * (larg + 20);
    doc.moveTo(x, y).lineTo(x + larg, y).strokeColor('#000').stroke();
    doc.fontSize(9).text(t, x, y + 4, { width: larg, align: 'center' });
  });
  rodapes(doc, `Acordo ${ciclo.nome} · gerado em ${new Date().toLocaleString('pt-BR')}`);
  return finalizar(doc);
}

async function pdfApuracao(ciclo, ap, individuais) {
  const doc = novoDoc(`Apuração — ${ciclo.nome}`);
  cabecalho(doc, `Apuração de Metas — ${ciclo.nome}`, `${mes(ciclo.inicio)} a ${mes(ciclo.fim)} · ${ap.congelado ? 'Resultado final (ciclo encerrado)' : 'Resultado parcial'}`);
  secao(doc, 'Resumo');
  const g = ap.gatilho_corporativo;
  doc.text(`Nota média dos departamentos: ${pct(ap.totais.nota_media)}`);
  doc.text(`Bônus por departamento: ${moeda(ap.totais.bonus)} de ${moeda(ap.totais.valor_base)} (${pct(ap.totais.pct_pago)})`);
  if (individuais.length) doc.text(`Bônus individual total: ${moeda(individuais.reduce((s, i) => s + i.bonus, 0))} para ${individuais.length} participante(s)`);
  if (g?.definido) doc.text(`Gatilho corporativo (${g.descricao || '-'}): mínimo ${num(g.minimo)}, resultado ${num(g.resultado)} — ${g.atingido ? 'ATINGIDO' : 'NÃO ATINGIDO'}`);
  secao(doc, 'Departamentos');
  tabela(doc, [{ titulo: 'Departamento', largura: 170 }, { titulo: 'Nota', largura: 60, alinhar: 'right' }, { titulo: 'Bônus-alvo', largura: 85, alinhar: 'right' },
    { titulo: 'Bônus apurado', largura: 85, alinhar: 'right' }, { titulo: 'Aprovação', largura: 99 }],
  ap.departamentos.map((d) => [d.departamento, pct(d.nota), moeda(d.valor_base), moeda(d.bonus), d.aprovado_por ? `${d.aprovado_por} ${String(d.aprovado_em || '').slice(0, 10)}` : d.status_apuracao]));
  for (const d of ap.departamentos) {
    doc.font('Helvetica-Bold').fontSize(9.5).text(`${d.departamento} — nota ${pct(d.nota)}`).font('Helvetica').moveDown(0.2);
    tabela(doc, [{ titulo: 'Meta', largura: 175 }, { titulo: 'Peso', largura: 40, alinhar: 'right' }, { titulo: 'Gatilho', largura: 50, alinhar: 'right' },
      { titulo: 'Alvo', largura: 50, alinhar: 'right' }, { titulo: 'Resultado', largura: 60, alinhar: 'right' }, { titulo: 'Atingim.', largura: 55, alinhar: 'right' },
      { titulo: 'Contrib.', largura: 69, alinhar: 'right' }],
    d.metas.map((m) => [m.nome, `${num(m.peso)}%`, num(m.gatilho), num(m.alvo), num(m.valor_apurado), pct(m.atingimento), num(m.contribuicao)]));
  }
  if (individuais.length) {
    secao(doc, 'Participantes');
    tabela(doc, [{ titulo: 'Matrícula', largura: 55 }, { titulo: 'Nome', largura: 120 }, { titulo: 'Depto', largura: 80 }, { titulo: 'Meses', largura: 40, alinhar: 'center' },
      { titulo: 'Nota final', largura: 50, alinhar: 'right' }, { titulo: 'Redutor', largura: 45, alinhar: 'right' }, { titulo: 'Bônus', largura: 75, alinhar: 'right' },
      { titulo: 'Obs.', largura: 34 }],
    individuais.map((i) => [i.matricula, i.nome, i.departamento, `${i.meses_elegiveis}/${i.meses_ciclo}`, pct(i.nota_final), pct(i.redutor_pct), moeda(i.bonus), i.motivos.length ? '*' : '']));
    if (individuais.some((i) => i.motivos.length)) doc.fontSize(8).text('* Sem pagamento: ' + [...new Set(individuais.flatMap((i) => i.motivos))].join('; '));
  }
  rodapes(doc, `Apuração ${ciclo.nome} · gerado em ${new Date().toLocaleString('pt-BR')}`);
  return finalizar(doc);
}

module.exports = { pdfAcordo, pdfApuracao };
