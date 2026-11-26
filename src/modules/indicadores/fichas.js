'use strict';
// Importação em lote das FICHAS de indicadores (cadastro), a partir de planilha CSV/XLSX.
// Uma linha por indicador. Código existente → atualiza; sem código, nome + departamento existentes → atualiza;
// caso contrário cria. Células vazias numa atualização mantêm o valor atual.
const E = require('../../core/erros');
const { lerPlanilha, numeroDe } = require('../../core/planilha');

const sem = (s) => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
const vazio = (v) => v === null || v === undefined || String(v).trim() === '';

const POLARIDADES = { maior_melhor: 'Maior é melhor', menor_melhor: 'Menor é melhor', faixa: 'Dentro da faixa' };
const FREQUENCIAS = ['mensal', 'bimestral', 'trimestral', 'semestral', 'anual'];
/** Aceita a chave ou textos comuns em propostas ("maior é melhor", "aumentar", "reduzir", "entre"...). */
function polaridadeDe(v) {
  const s = sem(v).replace(/[_-]/g, ' ');
  if (!s) return null;
  if (['maior melhor', 'maior e melhor', 'maior', 'aumentar', 'crescer', 'quanto maior melhor', 'max', 'maximizar', '↑'].includes(s)) return 'maior_melhor';
  if (['menor melhor', 'menor e melhor', 'menor', 'reduzir', 'diminuir', 'quanto menor melhor', 'min', 'minimizar', '↓'].includes(s)) return 'menor_melhor';
  if (['faixa', 'dentro da faixa', 'entre', 'manter', 'manter entre', 'intervalo', 'range'].includes(s)) return 'faixa';
  throw new E.ErroValidacao(`Polaridade não reconhecida: "${v}" (use maior é melhor, menor é melhor ou faixa)`);
}

const COLUNAS = ['codigo', 'nome', 'departamento', 'responsavel', 'unidade', 'polaridade', 'meta', 'limite_inferior', 'limite_superior',
  'frequencia', 'perspectiva', 'objetivo', 'formula', 'fonte', 'descricao', 'ativo', 'justificativa'];
const OBRIGATORIAS = ['nome', 'departamento', 'polaridade', 'meta'];

function criarFichasService(db, core, ind) {
  const deptos = () => db.prepare('SELECT id, nome, sigla FROM departamentos').all();
  const objetivos = () => db.prepare('SELECT id, nome FROM ind_objetivos ORDER BY nome').all();

  /** Converte uma linha da planilha nos dados aceitos por ind.salvar, partindo do registro atual (se houver). */
  function montar(dados, atual, ctx) {
    const tem = (c) => c in dados && !vazio(dados[c]);
    const d = atual ? {
      codigo: atual.codigo, nome: atual.nome, descricao: atual.descricao, departamento_id: atual.departamento_id, responsavel: atual.responsavel,
      unidade: atual.unidade, formula: atual.formula, fonte_dados: atual.fonte_dados, perspectiva: atual.perspectiva, frequencia: atual.frequencia,
      polaridade: atual.polaridade, meta: atual.meta, limite_inferior: atual.limite_inferior, limite_superior: atual.limite_superior,
      ativo: atual.ativo, tipo: atual.tipo, formula_calculo: atual.formula_calculo, objetivo_id: atual.objetivo_id,
    } : { tipo: 'manual' };
    if (tem('codigo')) d.codigo = String(dados.codigo).trim();
    for (const [col, campo] of [['nome', 'nome'], ['responsavel', 'responsavel'], ['unidade', 'unidade'], ['descricao', 'descricao'], ['formula', 'formula'], ['fonte', 'fonte_dados']]) {
      if (tem(col)) d[campo] = String(dados[col]).trim();
    }
    if (tem('departamento')) {
      const ref = sem(dados.departamento);
      const dep = ctx.deptos.find((x) => sem(x.nome) === ref || (x.sigla && sem(x.sigla) === ref));
      E.exigir(dep, `Departamento "${dados.departamento}" não encontrado (cadastre-o em Estrutura organizacional)`);
      d.departamento_id = dep.id;
    }
    if (tem('polaridade')) d.polaridade = polaridadeDe(dados.polaridade);
    for (const c of ['meta', 'limite_inferior', 'limite_superior']) {
      if (!tem(c)) continue;
      const n = numeroDe(dados[c]);
      E.exigir(n !== null && !Number.isNaN(n), `Valor inválido em "${c}": "${dados[c]}"`);
      d[c] = n;
    }
    if (tem('frequencia')) {
      const f = sem(dados.frequencia);
      E.exigir(FREQUENCIAS.includes(f), `Frequência inválida: "${dados.frequencia}" (use ${FREQUENCIAS.join(', ')})`);
      d.frequencia = f;
    }
    if (tem('perspectiva')) {
      const ref = sem(dados.perspectiva);
      const p = ctx.perspectivas.find((x) => sem(x.chave) === ref || sem(x.nome) === ref);
      E.exigir(p, `Perspectiva não encontrada: "${dados.perspectiva}" (use: ${ctx.perspectivas.map((x) => x.nome).join(', ')})`);
      d.perspectiva = p.chave;
    }
    if (tem('objetivo')) {
      const o = ctx.objetivos.find((x) => sem(x.nome) === sem(dados.objetivo));
      E.exigir(o, `Objetivo estratégico não encontrado: "${dados.objetivo}"`);
      d.objetivo_id = o.id;
    }
    if (tem('ativo')) d.ativo = !['nao', 'n', '0', 'false', 'inativo'].includes(sem(dados.ativo));
    if (tem('justificativa')) d.justificativa = String(dados.justificativa).trim();
    return d;
  }

  const comparaveis = ['codigo', 'nome', 'descricao', 'departamento_id', 'responsavel', 'unidade', 'formula', 'fonte_dados', 'perspectiva', 'frequencia',
    'polaridade', 'meta', 'limite_inferior', 'limite_superior', 'ativo', 'objetivo_id'];
  const igual = (a, b) => (a ?? null) === (b ?? null) || (typeof b === 'boolean' && a === (b ? 1 : 0));

  /**
   * Importa as fichas. A simulação executa exatamente as mesmas gravações dentro de uma transação e
   * desfaz no final — a validação é idêntica à importação real. Cada linha usa um SAVEPOINT próprio:
   * linhas com erro não afetam as demais.
   */
  async function importar(nomeArquivo, conteudo, { simular = false } = {}) {
    core.exigirPerfil('diretoria', 'gestor');
    const linhas = await lerPlanilha(nomeArquivo, conteudo);
    const cab = Object.keys(linhas[0].dados);
    // Planilha só de atualização (com "codigo") pode trazer apenas as colunas a alterar.
    const faltando = OBRIGATORIAS.filter((c) => !cab.includes(c));
    E.exigir(!faltando.length || cab.includes('codigo'),
      `Colunas ausentes: ${faltando.join(', ')}. Para criar indicadores use o modelo; para só atualizar, inclua a coluna "codigo".`);
    const ctx = { deptos: deptos(), objetivos: objetivos(), perspectivas: ind.listarPerspectivas() };
    const resultado = [];
    const codigosNaPlanilha = new Set();
    db.exec('BEGIN');
    try {
      for (const { linha, dados } of linhas) {
        if (cab.every((c) => vazio(dados[c]))) continue;
        const ref = { linha, codigo: vazio(dados.codigo) ? '' : String(dados.codigo).trim(), nome: vazio(dados.nome) ? '' : String(dados.nome).trim() };
        db.exec('SAVEPOINT ficha');
        try {
          if (ref.codigo) {
            E.exigir(!codigosNaPlanilha.has(ref.codigo), `Código "${ref.codigo}" repetido na planilha`);
            codigosNaPlanilha.add(ref.codigo);
          }
          let atual = ref.codigo ? ind.porCodigo(ref.codigo) : null;
          if (!atual && !ref.codigo && ref.nome && !vazio(dados.departamento)) {
            const dep = ctx.deptos.find((x) => sem(x.nome) === sem(dados.departamento) || (x.sigla && sem(x.sigla) === sem(dados.departamento)));
            if (dep) atual = db.prepare('SELECT * FROM ind_indicadores WHERE departamento_id=? AND LOWER(nome)=LOWER(?)').get(dep.id, ref.nome);
          }
          if (!atual) for (const c of OBRIGATORIAS) E.exigir(!vazio(dados[c]), `Campo "${c}" é obrigatório para criar um indicador`);
          const d = montar(dados, atual, ctx);
          if (atual) {
            const mudou = comparaveis.filter((c) => !igual(atual[c], d[c]));
            if (!mudou.length) {
              resultado.push({ ...ref, codigo: atual.codigo || ref.codigo, ok: true, acao: 'sem_alteracao' });
            } else {
              const r = ind.salvar(d, atual.id);
              resultado.push({ ...ref, codigo: r.codigo || '', nome: r.nome, ok: true, acao: 'atualizar', campos: mudou });
            }
          } else {
            const r = ind.salvar(d);
            resultado.push({ ...ref, codigo: r.codigo || '', nome: r.nome, ok: true, acao: 'criar' });
          }
          db.exec('RELEASE ficha');
        } catch (e) {
          db.exec('ROLLBACK TO ficha'); db.exec('RELEASE ficha');
          resultado.push({ ...ref, ok: false, erro: e.message });
        }
      }
      db.exec(simular ? 'ROLLBACK' : 'COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch { /* já desfeita */ }
      throw e;
    }
    const conta = (a) => resultado.filter((r) => r.acao === a).length;
    const resumo = { simulacao: simular, total: resultado.length, criados: conta('criar'), atualizados: conta('atualizar'),
      sem_alteracao: conta('sem_alteracao'), erros: resultado.filter((r) => !r.ok).length };
    if (!simular) core.auditar('indicadores', 'importacao_fichas', null, 'importar', { arquivo: nomeArquivo, ...resumo });
    return { ...resumo, linhas: resultado };
  }

  /** Modelo XLSX: aba Indicadores (já com os indicadores que o usuário pode editar), listas de valores com validação e instruções. */
  async function modelo({ incluirAtuais = true } = {}) {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Indicadores', { views: [{ state: 'frozen', ySplit: 1, xSplit: 2 }] });
    const larguras = { codigo: 11, nome: 42, departamento: 24, responsavel: 20, unidade: 9, polaridade: 16, meta: 10, limite_inferior: 15, limite_superior: 15,
      frequencia: 12, perspectiva: 22, objetivo: 28, formula: 30, fonte: 22, descricao: 40, ativo: 7, justificativa: 30 };
    ws.columns = COLUNAS.map((c) => ({ header: c, key: c, width: larguras[c] }));
    const persp = ind.listarPerspectivas();
    const nomePersp = Object.fromEntries(persp.map((p) => [p.chave, p.nome]));
    const objs = objetivos();
    const nomeObj = Object.fromEntries(objs.map((o) => [o.id, o.nome]));
    const lista = incluirAtuais ? ind.listar({ todos: true }).filter((i) => i.tipo !== 'calculado' && core.podeEditar(i.departamento_id)) : [];
    for (const i of lista) {
      ws.addRow({ codigo: i.codigo || '', nome: i.nome, departamento: i.departamento, responsavel: i.responsavel || '', unidade: i.unidade || '',
        polaridade: POLARIDADES[i.polaridade], meta: i.meta, limite_inferior: i.limite_inferior ?? null, limite_superior: i.limite_superior ?? null,
        frequencia: i.frequencia, perspectiva: i.perspectiva ? nomePersp[i.perspectiva] || i.perspectiva : '', objetivo: i.objetivo_id ? nomeObj[i.objetivo_id] || '' : '',
        formula: i.formula || '', fonte: i.fonte_dados || '', descricao: i.descricao || '', ativo: i.ativo ? 'sim' : 'não', justificativa: '' });
    }
    const cab = ws.getRow(1);
    cab.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cab.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5BD3' } };
    for (const c of OBRIGATORIAS) ws.getCell(1, COLUNAS.indexOf(c) + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D3E9E' } };

    // Listas de valores (aba auxiliar) + validação por lista nas colunas correspondentes
    const listas = wb.addWorksheet('Listas');
    const deps = deptos().map((d) => d.nome).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const cols = { departamento: deps, polaridade: Object.values(POLARIDADES), frequencia: FREQUENCIAS, perspectiva: persp.map((p) => p.nome),
      objetivo: objs.map((o) => o.nome), ativo: ['sim', 'não'] };
    Object.entries(cols).forEach(([nome, valores], j) => {
      const col = listas.getColumn(j + 1);
      col.width = 30;
      listas.getCell(1, j + 1).value = nome; listas.getCell(1, j + 1).font = { bold: true };
      valores.forEach((v, k) => { listas.getCell(k + 2, j + 1).value = v; });
      if (!valores.length) return;
      const letra = col.letter;
      const alvo = COLUNAS.indexOf(nome) + 1;
      for (let r = 2; r <= 1000; r++) {
        ws.getCell(r, alvo).dataValidation = { type: 'list', allowBlank: true, formulae: [`Listas!$${letra}$2:$${letra}$${valores.length + 1}`],
          showErrorMessage: nome !== 'objetivo', errorTitle: 'Valor inválido', error: `Escolha um valor da lista (${nome}).` };
      }
    });

    const ajuda = wb.addWorksheet('Instruções');
    ajuda.getColumn(1).width = 120;
    [
      'Importação de indicadores (fichas) — como preencher',
      'Uma linha por indicador. Colunas obrigatórias para CRIAR: nome, departamento, polaridade e meta (cabeçalho em azul-escuro).',
      'codigo: identificador único (ex.: JUR-001). Recomendado — é a chave usada na importação de medições. Se o código já existir, o indicador é ATUALIZADO.',
      'Sem código, um indicador com o mesmo nome no mesmo departamento também é atualizado; senão, é criado.',
      'Numa atualização, células vazias mantêm o valor atual. Apague a linha inteira para não mexer em um indicador.',
      'departamento, polaridade, frequência, perspectiva, objetivo e ativo têm listas de valores (aba Listas).',
      'polaridade: "Maior é melhor" (informe limite_inferior), "Menor é melhor" (informe limite_superior) ou "Dentro da faixa" (informe os limites).',
      'meta e limites aceitam vírgula decimal e "%" (ex.: 95%, 1.234,5).',
      'justificativa: obrigatória para alterar meta, limites ou polaridade de um indicador que já tem medições.',
      'No sistema: Importar planilhas → Cadastro de indicadores → "Validar (simulação)" → corrija o que for apontado → "Importar".',
      `Modelo gerado em ${new Date().toLocaleString('pt-BR')}${lista.length ? ` com ${lista.length} indicador(es) atuais que você pode editar` : ''}.`,
    ].forEach((t, k) => { const c = ajuda.getCell(k + 1, 1); c.value = t; c.alignment = { wrapText: true }; if (!k) c.font = { bold: true, size: 13 }; });
    return { tipo: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', nome: 'modelo-indicadores.xlsx', conteudo: Buffer.from(await wb.xlsx.writeBuffer()) };
  }

  return { importar, modelo };
}

module.exports = { criarFichasService, polaridadeDe };
