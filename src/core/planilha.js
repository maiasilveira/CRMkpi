'use strict';
// Leitura de planilhas CSV (; ou ,) e XLSX → lista de objetos com chaves normalizadas.
const E = require('./erros');

const normChave = (s) => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

function lerCsv(texto) {
  const t = texto.replace(/^﻿/, '');
  const primeira = t.split(/\r?\n/)[0] || '';
  const sep = (primeira.match(/;/g) || []).length >= (primeira.match(/,/g) || []).length ? ';' : ',';
  const linhas = []; let campo = ''; let linha = []; let aspas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (aspas) {
      if (c === '"' && t[i + 1] === '"') { campo += '"'; i++; } else if (c === '"') aspas = false; else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      linha.push(campo); linhas.push(linha); linha = []; campo = '';
    } else campo += c;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas.filter((l) => l.some((c) => String(c).trim() !== ''));
}

async function lerXlsx(buffer) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  E.exigir(ws, 'Planilha vazia');
  const linhas = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals = [];
    for (let c = 1; c <= ws.columnCount; c++) {
      let v = row.getCell(c).value;
      if (v && typeof v === 'object' && !(v instanceof Date)) v = v.result ?? v.text ?? (v.richText ? v.richText.map((r) => r.text).join('') : '');
      vals.push(v);
    }
    linhas.push(vals);
  });
  return linhas;
}

/** @returns {Promise<Array<{linha:number, dados:object}>>} */
async function lerPlanilha(nome, conteudo) {
  E.exigir(Buffer.isBuffer(conteudo) && conteudo.length, 'Arquivo vazio');
  E.exigir(conteudo.length <= 10 * 1024 * 1024, 'Planilha excede 10 MB');
  const ext = String(nome || '').split('.').pop().toLowerCase();
  let linhas;
  if (ext === 'xlsx') linhas = await lerXlsx(conteudo);
  else if (ext === 'csv' || ext === 'txt') linhas = lerCsv(conteudo.toString('utf8'));
  else throw new E.ErroValidacao('Formato não suportado: use .csv ou .xlsx');
  E.exigir(linhas.length >= 2, 'A planilha precisa de cabeçalho e ao menos uma linha de dados');
  E.exigir(linhas.length <= 5001, 'Máximo de 5000 linhas por importação');
  const cab = linhas[0].map(normChave);
  return linhas.slice(1).map((l, i) => ({ linha: i + 2, dados: Object.fromEntries(cab.map((c, j) => [c, l[j]])) }));
}

/** Aceita AAAA-MM, MM/AAAA, AAAA/MM, datas e números de série do Excel. */
function periodoDe(v) {
  if (v instanceof Date) return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}`;
  const s = String(v ?? '').trim();
  let m = /^(\d{4})[-/](\d{1,2})(?:[-/]\d{1,2})?$/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
  m = /^(?:\d{1,2}\/)?(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;
  return s;
}
/** Converte "1.234,56", "1234.56", "12%" em número. */
function numeroDe(v) {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').trim().replace(/[%\sR$]/g, '');
  if (!s) return null;
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

module.exports = { lerPlanilha, lerCsv, periodoDe, numeroDe, normChave };
