'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { servidor, esperar } = require('./helpers');
const calc = require('../src/modules/metas/calculo');

test('pró-rata e bônus individual (regras puras)', () => {
  assert.deepEqual(calc.mesesElegiveis({ admissao: '2025-01-01' }, '2026-01', '2026-12', 15), { elegiveis: 12, total: 12, fator: 1 });
  assert.equal(calc.mesesElegiveis({ admissao: '2026-07-16' }, '2026-01', '2026-12', 15).elegiveis, 6, 'julho com 16 dias conta');
  assert.equal(calc.mesesElegiveis({ admissao: '2026-07-18' }, '2026-01', '2026-12', 15).elegiveis, 5);
  assert.equal(calc.mesesElegiveis({ admissao: '2025-01-01', desligamento: '2026-02-10' }, '2026-01', '2026-12', 15).elegiveis, 1);
  const ciclo = { nota_minima: 60, redutor_falta_pct: 5, redutor_advertencia_pct: 10, redutor_maximo_pct: 30 };
  const b = calc.bonusIndividual({ salario: 5000, multiplo: 2, notaDepto: 80, notaIndividual: 100, pesoDepto: 50, prorata: 1, faltas: 10, advertencias: 0, ciclo, gatilhoOk: true });
  assert.equal(b.nota_final, 90);
  assert.equal(b.redutor_pct, 30, 'limitado ao máximo');
  assert.equal(b.bonus, 6300);
  assert.equal(calc.bonusIndividual({ salario: 5000, multiplo: 2, notaDepto: 50, notaIndividual: null, pesoDepto: 70, prorata: 1, ciclo, gatilhoOk: true }).bonus, 0);
  assert.deepEqual(calc.bonusIndividual({ salario: 5000, multiplo: 2, notaDepto: 90, pesoDepto: 70, prorata: 1, ciclo, gatilhoOk: false }).motivos, ['gatilho corporativo não atingido']);
});

async function cenario(t) {
  const s = await servidor();
  t.after(s.fechar);
  const { req } = s;
  const emp = (await req('POST', '/departamentos', { nome: 'Empresa', tipo: 'empresa' })).body;
  const com = (await req('POST', '/departamentos', { nome: 'Comercial', sigla: 'COM', pai_id: emp.id })).body;
  await req('POST', '/usuarios', { nome: 'Diretora', email: 'dir@x.com', senha: 'senha-diret', perfil: 'diretoria' });
  await req('POST', '/usuarios', { nome: 'Gestor', email: 'ges@x.com', senha: 'senha-gestor', perfil: 'gestor', departamento_id: com.id });
  await req('POST', '/usuarios', { nome: 'Ana Vendas', email: 'ana@x.com', senha: 'senha-ana-1', perfil: 'colaborador', departamento_id: com.id });
  const ciclo = (await req('POST', '/metas/ciclos', { nome: 'PLR', inicio: '2026-01', fim: '2026-12', nota_minima: 50,
    gatilho_corp_descricao: 'EBITDA (R$ mi)', gatilho_corp_minimo: 10, redutor_falta_pct: 5, redutor_advertencia_pct: 10, peso_departamento_padrao: 60 })).body;
  return { ...s, emp, com, ciclo };
}

test('metas individuais, desdobramento, gatilho corporativo, redutores e meu bônus', async (t) => {
  const { req, com, emp, ciclo, entrarComo } = await cenario(t);
  const corp = (await req('POST', '/metas', { ciclo_id: ciclo.id, departamento_id: emp.id, nome: 'Receita empresa', polaridade: 'maior_melhor', peso: 100, gatilho: 90, alvo: 100 })).body;
  const mDep = (await req('POST', '/metas', { ciclo_id: ciclo.id, departamento_id: com.id, nome: 'Receita comercial', polaridade: 'maior_melhor', peso: 100,
    gatilho: 80, alvo: 100, superacao: 120, meta_pai_id: corp.id })).body;
  const ana = (await req('POST', '/metas/colaboradores', { matricula: '001', nome: 'Ana Vendas', email: 'ana@x.com', departamento_id: com.id, salario: 5000, admissao: '2026-04-10' })).body;
  const bob = (await req('POST', '/metas/colaboradores', { matricula: '002', nome: 'Bob', departamento_id: com.id, salario: 4000, admissao: '2020-01-01' })).body;
  assert.equal((await req('POST', '/metas/colaboradores', { matricula: '001', nome: 'X', departamento_id: com.id, admissao: '2020-01-01' })).status, 400);

  // Gestor cria meta individual; não vê salário
  const gestor = await entrarComo('ges@x.com', 'senha-gestor');
  const mInd = await gestor('POST', '/metas', { ciclo_id: ciclo.id, colaborador_id: ana.id, nome: 'Carteira da Ana', polaridade: 'maior_melhor', peso: 100,
    gatilho: 50, alvo: 100, meta_pai_id: mDep.id });
  assert.equal(mInd.status, 201);
  assert.equal(mInd.body.departamento_id, com.id);
  assert.equal((await gestor('GET', '/metas/colaboradores')).body[0].salario, undefined);
  assert.equal((await gestor('POST', '/metas', { ciclo_id: ciclo.id, departamento_id: com.id, nome: 'Z', polaridade: 'maior_melhor', peso: 1, gatilho: 1, alvo: 2 })).status, 403);

  // Metas individuais não entram no scorecard do departamento
  const ap = (await req('GET', `/metas/ciclos/${ciclo.id}/apuracao`)).body;
  assert.deepEqual(ap.departamentos.find((d) => d.departamento_id === com.id).metas.map((m) => m.nome), ['Receita comercial']);

  await req('POST', `/metas/${mDep.id}/resultados`, { periodo: '2026-06', valor: 100 });
  await req('POST', `/metas/${mInd.body.id}/resultados`, { periodo: '2026-06', valor: 75 });
  assert.deepEqual((await req('POST', `/metas/ciclos/${ciclo.id}/participantes/incluir-todos`, { multiplo_salarios: 2 })).body, { incluidos: 2 });
  await req('PUT', `/metas/ciclos/${ciclo.id}/participantes/${bob.id}`, { multiplo_salarios: 2, faltas: 2, advertencias: 1 });

  let ind = (await req('GET', `/metas/ciclos/${ciclo.id}/individuais`)).body;
  const iAna = ind.find((i) => i.matricula === '001');
  assert.equal(iAna.bonus, 0, 'gatilho corporativo ainda não apurado');
  assert.deepEqual(iAna.motivos, ['gatilho corporativo não atingido']);

  await req('PUT', `/metas/ciclos/${ciclo.id}/gatilho`, { resultado: 12 });
  ind = (await req('GET', `/metas/ciclos/${ciclo.id}/individuais`)).body;
  const a = ind.find((i) => i.matricula === '001');
  const b = ind.find((i) => i.matricula === '002');
  // Ana: admitida 10/04 → abril tem 21 dias → 9 meses; nota = 60%×100 + 40%×75 = 90
  assert.equal(a.meses_elegiveis, 9);
  assert.equal(a.nota_final, 90);
  assert.equal(a.bonus, Math.round(5000 * 2 * 0.75 * 0.9 * 100) / 100);
  // Bob: sem metas individuais → nota do depto (100); redutor 2×5 + 1×10 = 20%
  assert.equal(b.redutor_pct, 20);
  assert.equal(b.bonus, 4000 * 2 * 1 * 1 * 0.8);

  // Desdobramento
  const arv = (await req('GET', `/metas/ciclos/${ciclo.id}/desdobramento`)).body;
  assert.equal(arv[0].nome, 'Receita empresa');
  assert.equal(arv[0].filhas[0].filhas[0].colaborador, 'Ana Vendas');

  // Colaboradora vê o próprio bônus
  const anaU = await entrarComo('ana@x.com', 'senha-ana-1');
  const meu = (await anaU('GET', `/metas/ciclos/${ciclo.id}/meu-bonus`)).body;
  assert.equal(meu.bonus, a.bonus);
  assert.equal((await anaU('GET', `/metas/ciclos/${ciclo.id}/individuais.csv`)).status, 403);

  // PDFs
  const pdf = await req('GET', `/metas/ciclos/${ciclo.id}/acordo.pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.equal((await req('GET', `/metas/ciclos/${ciclo.id}/apuracao.pdf`)).status, 200);
  assert.equal((await gestor('GET', `/metas/ciclos/${ciclo.id}/apuracao.pdf`)).status, 403);
  assert.match((await req('GET', `/metas/ciclos/${ciclo.id}/individuais.csv`)).body, /Ana Vendas/);
});

test('remuneração restrita: salários e bônus individuais só com permissão específica', async (t) => {
  const { req, com, ciclo, entrarComo } = await cenario(t);
  const meta = (await req('POST', '/metas', { ciclo_id: ciclo.id, departamento_id: com.id, nome: 'Receita', polaridade: 'maior_melhor', peso: 100, gatilho: 80, alvo: 100 })).body;
  await req('POST', `/metas/${meta.id}/resultados`, { periodo: '2026-06', valor: 100 });
  const ana = (await req('POST', '/metas/colaboradores', { matricula: '001', nome: 'Ana Vendas', email: 'ana@x.com', departamento_id: com.id, salario: 5000, admissao: '2020-01-01' })).body;
  await req('POST', `/metas/ciclos/${ciclo.id}/participantes/incluir-todos`, { multiplo_salarios: 2 });
  await req('PUT', `/metas/ciclos/${ciclo.id}/departamentos/${com.id}/bonus`, { valor_base: 30000 });
  await req('PUT', `/metas/ciclos/${ciclo.id}/gatilho`, { resultado: 12 });
  const ocultos = (o) => o.salario === undefined && o.bonus === undefined && o.bonus_alvo === undefined;

  // Diretoria SEM a permissão: não vê salário nem bônus individual, nem exporta o CSV
  const dir = await entrarComo('dir@x.com', 'senha-diret');
  assert.ok(ocultos((await dir('GET', '/metas/colaboradores')).body[0]));
  assert.ok(ocultos((await dir('GET', `/metas/ciclos/${ciclo.id}/participantes`)).body[0]));
  const indDir = (await dir('GET', `/metas/ciclos/${ciclo.id}/individuais`)).body[0];
  assert.ok(ocultos(indDir));
  assert.equal(typeof indDir.nota_final, 'number', 'notas continuam visíveis');
  assert.equal((await dir('GET', `/metas/ciclos/${ciclo.id}/individuais.csv`)).status, 403);
  assert.equal((await dir('GET', `/metas/ciclos/${ciclo.id}/apuracao.pdf`)).status, 200, 'PDF sai sem a tabela individual');
  // ...mas continua vendo os valores por departamento, usados na aprovação
  assert.equal((await dir('GET', `/metas/ciclos/${ciclo.id}/apuracao`)).body.departamentos[0].valor_base, 30000);

  // Diretoria sem permissão edita cadastro sem apagar o salário, e não consegue informar salário
  assert.equal((await dir('PUT', `/metas/colaboradores/${ana.id}`, { ...ana, salario: undefined, cargo: 'Vendedora' })).status, 200);
  assert.equal((await dir('PUT', `/metas/colaboradores/${ana.id}`, { ...ana, salario: 9999 })).status, 403);
  assert.equal((await dir('POST', '/metas/colaboradores', { matricula: '003', nome: 'C', departamento_id: com.id, salario: 1, admissao: '2020-01-01' })).status, 403);
  assert.equal((await req('GET', `/metas/colaboradores/${ana.id}`)).body.salario, 5000, 'salário preservado');

  // Gestor e colaborador: nada de bônus individual nem valores em R$ do departamento
  const gestor = await entrarComo('ges@x.com', 'senha-gestor');
  assert.ok(ocultos((await gestor('GET', `/metas/ciclos/${ciclo.id}/individuais`)).body[0]));
  const apG = (await gestor('GET', `/metas/ciclos/${ciclo.id}/apuracao`)).body;
  assert.equal(apG.departamentos[0].valor_base, undefined);
  assert.equal(apG.departamentos[0].bonus, undefined);
  assert.equal(apG.totais.bonus, undefined);
  assert.equal(typeof apG.departamentos[0].nota, 'number');
  const anaU = await entrarComo('ana@x.com', 'senha-ana-1');
  assert.ok(ocultos((await anaU('GET', `/metas/ciclos/${ciclo.id}/individuais`)).body[0]));
  assert.equal((await anaU('GET', `/metas/ciclos/${ciclo.id}/meu-bonus`)).body.bonus, 10000, 'o próprio bônus continua visível');

  // Admin concede a permissão (auditado); a diretora passa a ver
  const usuarios = (await req('GET', '/usuarios')).body;
  const uDir = usuarios.find((u) => u.email === 'dir@x.com');
  assert.equal(uDir.ver_remuneracao, false);
  assert.equal((await req('PUT', `/usuarios/${uDir.id}`, { ...uDir, ver_remuneracao: true })).body.ver_remuneracao, true);
  assert.equal((await dir('GET', '/eu')).body.ver_remuneracao, true);
  assert.equal((await dir('GET', '/metas/colaboradores')).body[0].salario, 5000);
  assert.equal((await dir('GET', `/metas/ciclos/${ciclo.id}/individuais`)).body[0].bonus, 10000);
  assert.equal((await dir('GET', `/metas/ciclos/${ciclo.id}/individuais.csv`)).status, 200);
  // Salvar o usuário sem o campo mantém a permissão
  assert.equal((await req('PUT', `/usuarios/${uDir.id}`, { nome: uDir.nome, email: uDir.email, perfil: 'diretoria' })).body.ver_remuneracao, true);
  const aud = (await req('GET', '/auditoria?entidade=usuario')).body;
  assert.ok(aud.some((a) => JSON.stringify(a).includes('ver_remuneracao')));

  // A permissão não amplia o escopo: gestor com permissão só vê a própria área, e não pode se conceder
  assert.equal((await gestor('PUT', `/usuarios/${usuarios.find((u) => u.email === 'ges@x.com').id}`, { nome: 'G', email: 'ges@x.com', perfil: 'gestor', departamento_id: com.id, ver_remuneracao: true })).status, 403);
});

test('versionamento: alteração em ciclo ativo exige justificativa e aprovação de outra pessoa', async (t) => {
  const { req, com, ciclo, entrarComo, ctx } = await cenario(t);
  const m = (await req('POST', '/metas', { ciclo_id: ciclo.id, departamento_id: com.id, nome: 'Receita', polaridade: 'maior_melhor', peso: 100, gatilho: 80, alvo: 100 })).body;
  // Em planejamento: aplica direto e registra histórico
  await req('PUT', `/metas/${m.id}`, { ...m, alvo: 110 });
  assert.equal((await req('GET', `/metas/${m.id}`)).body.alvo, 110);
  assert.equal((await req('GET', `/metas/alteracoes?meta_id=${m.id}`)).body[0].status, 'aplicada');

  await req('PUT', `/metas/ciclos/${ciclo.id}`, { ...ciclo, status: 'ativo' });
  const dir = await entrarComo('dir@x.com', 'senha-diret');
  assert.equal((await dir('PUT', `/metas/${m.id}`, { ...m, alvo: 120 })).status, 400, 'sem justificativa');
  const sol = (await dir('PUT', `/metas/${m.id}`, { ...m, alvo: 120, justificativa: 'Mercado aqueceu' })).body;
  assert.ok(sol.alteracao_pendente);
  assert.equal(sol.alvo, 110, 'não aplica antes da aprovação');
  assert.equal((await dir('PUT', `/metas/${m.id}`, { ...m, alvo: 130, justificativa: 'x' })).status, 400, 'uma pendente por vez');
  assert.equal((await dir('POST', `/metas/alteracoes/${sol.alteracao_pendente}/aprovar`)).status, 403, 'quem pede não aprova');
  assert.equal((await req('DELETE', `/metas/${m.id}`)).status, 400, 'não exclui meta em ciclo ativo');
  assert.equal((await req('POST', `/metas/ciclos/${ciclo.id}/encerrar`)).status, 400);
  const ok = (await req('POST', `/metas/alteracoes/${sol.alteracao_pendente}/aprovar`)).body;
  assert.equal(ok.status, 'aprovada');
  assert.equal((await req('GET', `/metas/${m.id}`)).body.alvo, 120);
  await esperar();
  const notifs = (await dir('GET', '/notificacoes')).body.itens.map((n) => n.titulo);
  assert.ok(notifs.some((x) => /aprovada/.test(x)));
  // Rejeição exige motivo
  const s2 = (await dir('PUT', `/metas/${m.id}`, { ...m, alvo: 150, justificativa: 'y' })).body;
  assert.equal((await req('POST', `/metas/alteracoes/${s2.alteracao_pendente}/rejeitar`, {})).status, 400);
  assert.equal((await req('POST', `/metas/alteracoes/${s2.alteracao_pendente}/rejeitar`, { motivo: 'Sem base' })).body.status, 'rejeitada');
  void ctx;
});

test('encerramento congela também a apuração individual; importação de colaboradores', async (t) => {
  const { req, com, ciclo } = await cenario(t);
  const csv = 'matricula;nome;email;departamento;cargo;salario;admissao\n10;Carlos;c@x.com;COM;Vendedor;3.500,00;01/02/2020\n11;Duda;;Inexistente;;1000;2020-01-01\n';
  const imp = (await req('POST', '/metas/colaboradores/importar?nome=c.csv', Buffer.from(csv), { headers: { 'Content-Type': 'application/octet-stream' } })).body;
  assert.equal(imp.importadas, 1);
  assert.match(imp.linhas[1].erro, /Inexistente/);
  const carlos = (await req('GET', '/metas/colaboradores')).body[0];
  assert.equal(carlos.salario, 3500);
  assert.equal(carlos.admissao, '2020-02-01');

  const m = (await req('POST', '/metas', { ciclo_id: ciclo.id, departamento_id: com.id, nome: 'R', polaridade: 'maior_melhor', peso: 100, gatilho: 80, alvo: 100 })).body;
  await req('POST', `/metas/${m.id}/resultados`, { periodo: '2026-03', valor: 100 });
  await req('POST', `/metas/ciclos/${ciclo.id}/participantes/incluir-todos`, {});
  await req('POST', `/metas/ciclos/${ciclo.id}/departamentos/${com.id}/submeter`, {});
  await req('POST', `/metas/ciclos/${ciclo.id}/departamentos/${com.id}/aprovar`, { usuario: 'Diretoria' });
  assert.equal((await req('POST', `/metas/ciclos/${ciclo.id}/encerrar`)).status, 400, 'gatilho corporativo sem resultado');
  await req('PUT', `/metas/ciclos/${ciclo.id}/gatilho`, { resultado: 15 });
  assert.equal((await req('POST', `/metas/ciclos/${ciclo.id}/encerrar`)).status, 200);
  const antes = (await req('GET', `/metas/ciclos/${ciclo.id}/individuais`)).body[0].bonus;
  assert.equal(antes, 3500);
  await req('PUT', `/metas/colaboradores/${carlos.id}`, { ...carlos, salario: 9999 });
  assert.equal((await req('GET', `/metas/ciclos/${ciclo.id}/individuais`)).body[0].bonus, antes, 'resultado congelado');
});
