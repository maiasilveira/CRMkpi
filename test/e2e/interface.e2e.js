'use strict';
// Teste de ponta a ponta da interface (Playwright). Execute: npm run test:e2e
// Sobe o servidor com o banco de demonstração em um arquivo temporário e percorre as telas.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

let chromium;
try { ({ chromium } = require('playwright')); } catch { /* opcional */ }
const pastaCapturas = process.env.CAPTURAS_DIR || null;

test('interface: login, navegação por todas as telas e fluxos principais', { skip: !chromium && 'Playwright não instalado' }, async (t) => {
  const dbFile = path.join(os.tmpdir(), `kpi-e2e-${process.pid}.db`);
  const anexos = path.join(os.tmpdir(), `kpi-e2e-anexos-${process.pid}`);
  execFileSync(process.execPath, [path.join(__dirname, '..', '..', 'src', 'seed.js')], { env: { ...process.env, DB_FILE: dbFile, ANEXOS_DIR: anexos }, stdio: 'ignore' });
  process.env.ANEXOS_DIR = anexos;
  const { criarApp } = require('../../src/app');
  const ctx = criarApp({ dbFile, semAgendador: true });
  const srv = await new Promise((ok) => { const s = ctx.app.listen(0, '127.0.0.1', () => ok(s)); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch();
  t.after(async () => {
    await browser.close(); srv.close(); ctx.encerrar(); ctx.db.close();
    for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) fs.rmSync(f, { force: true });
  });

  const erros = [];
  const nova = async (opts = {}) => {
    const p = await browser.newPage({ viewport: { width: 1280, height: 900 }, ...opts });
    p.on('pageerror', (e) => erros.push(`${p.url()}: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/401|Failed to load resource/.test(m.text())) erros.push(`${p.url()}: ${m.text()}`); });
    return p;
  };
  const entrar = async (p, email) => {
    await p.goto(base + '/#/login');
    await p.fill('input[name=email]', email);
    await p.fill('input[name=senha]', 'demo1234');
    await p.click('button.btn.pri');
    try { await p.waitForSelector('#nav a', { timeout: 10000, state: 'attached' }); } catch (e) {
      throw new Error(`login de ${email} falhou: ${(await p.textContent('body')).replace(/\s+/g, ' ').slice(0, 300)} | erros: ${erros.join(' / ')}`);
    }
  };
  const captura = async (p, nome) => { if (pastaCapturas) await p.screenshot({ path: path.join(pastaCapturas, nome + '.png'), fullPage: true }); };
  const visitar = async (p, hash, nome) => {
    await p.goto(base + '/' + hash);
    await p.waitForLoadState('networkidle');
    const txt = await p.textContent('#app');
    assert.ok(!/⚠/.test(txt), `${hash} exibiu erro: ${txt.slice(0, 200)}`);
    await captura(p, nome);
  };

  // Login inválido mostra erro
  const p = await nova();
  await p.goto(base + '/#/login');
  await p.fill('input[name=email]', 'admin@demo.com');
  await p.fill('input[name=senha]', 'errada');
  await p.click('button.btn.pri');
  await p.waitForSelector('.toast.erro');

  await entrar(p, 'admin@demo.com');
  const ids = {
    ind: ctx.db.prepare("SELECT id FROM ind_indicadores WHERE codigo='OPS-02'").get().id,
    plano: ctx.db.prepare('SELECT id FROM ind_planos ORDER BY id LIMIT 1').get().id,
    reuniao: ctx.db.prepare('SELECT id FROM gov_reunioes LIMIT 1').get().id,
  };
  const telas = [['#/', 'painel'], ['#/indicadores', 'indicadores'], [`#/indicadores/${ids.ind}`, 'indicador'], [`#/indicadores/${ids.ind}?aba=analises`, 'indicador-analises'],
    [`#/indicadores/${ids.ind}?aba=sazonal`, 'indicador-sazonal'], [`#/indicadores/${ids.ind}?aba=historico`, 'indicador-historico'], [`#/indicadores/${ids.ind}?aba=colab`, 'indicador-colab'],
    ['#/planos', 'planos'], [`#/planos/${ids.plano}`, 'plano'], ['#/mapa', 'mapa'], ['#/metas', 'metas'], ['#/metas?aba=individuais', 'metas-individuais'],
    ['#/metas?aba=participantes', 'metas-participantes'], ['#/metas?aba=desdobramento', 'metas-desdobramento'], ['#/metas/alteracoes', 'alteracoes'],
    ['#/colaboradores', 'colaboradores'], ['#/reunioes', 'reunioes'], [`#/reunioes/${ids.reuniao}`, 'reuniao'],
    ['#/importar', 'importar'], ['#/lancar', 'lancar'], ['#/admin/integracoes', 'integracoes'], ['#/departamentos', 'departamentos'], ['#/admin/usuarios', 'usuarios'],
    ['#/admin/tokens', 'tokens'], ['#/admin/config', 'config'], ['#/auditoria', 'auditoria'], ['#/perfil', 'perfil']];
  for (const [h, n] of telas) await visitar(p, h, n);

  // Fluxo: lançar desvio → análise abre automaticamente → sugestões → Pareto → registrar
  await p.goto(`${base}/#/indicadores/${ids.ind}`);
  await p.fill('#fMed input[name=valor]', '9');
  await p.click('#fMed button');
  await p.waitForSelector('#fAnalise');
  // 5 Porquês é a primeira opção e a técnica padrão
  assert.equal(await p.$eval('#tecnica', (s) => s.value), '5porques');
  assert.equal(await p.$eval('#tecnica', (s) => s.options[0].value), '5porques');
  // Clicar fora do popup não fecha (nem perde o que foi digitado)
  await p.fill('[name=c_problema]', 'texto digitado');
  await p.mouse.click(5, 450);
  assert.equal(await p.isVisible('#modal'), true, 'popup continua aberto ao clicar fora');
  assert.equal(await p.inputValue('[name=c_problema]'), 'texto digitado');
  await p.selectOption('#tecnica', 'pareto');
  await p.click('#sugerir');
  await p.waitForSelector('.sugestao');
  await captura(p, 'analise-sugestoes');
  await p.fill('[name=c_problema]', 'Refugo alto');
  const causas = await p.$$('.linha-pareto');
  await (await causas[0].$('[name=p_causa]')).fill('Ferramenta gasta');
  await (await causas[0].$('[name=p_freq]')).fill('30');
  await (await causas[1].$('[name=p_causa]')).fill('Matéria-prima');
  await (await causas[1].$('[name=p_freq]')).fill('10');
  await p.click('#fAnalise [type=submit]');
  await p.waitForSelector('.toast:not(.erro)');
  assert.equal(await p.isVisible('#modal'), false, 'popup fecha após salvar');

  // Cards do painel são clicáveis e levam à lista filtrada
  await p.goto(base + '/#/');
  await p.click('a.stat.clicavel:has-text("Em desvio")');
  await p.waitForURL(/#\/indicadores\?status=desvio/);
  await p.waitForSelector('#filtros');
  assert.equal(await p.$eval('[name=status]', (s) => s.value), 'desvio');
  await p.goto(base + '/#/');
  await p.click('a.stat.clicavel:has-text("Planos em aberto")');
  await p.waitForURL(/#\/planos\?status=abertos/);

  // Filtro por responsável nas listas de indicadores e planos
  await p.goto(base + '/#/indicadores');
  await p.waitForSelector('#filtros');
  await p.selectOption('#filtros [name=responsavel]', 'Carla Mendes');
  await p.waitForURL(/responsavel=Carla/);
  await p.waitForLoadState('networkidle');
  const linhas = await p.$$eval('#app tbody tr', (trs) => trs.map((t) => t.textContent));
  assert.ok(linhas.length && linhas.every((t) => /Financeiro/.test(t)), 'só indicadores da Carla');
  await captura(p, 'filtro-responsavel');

  // Diretoria aprova a alteração de meta pendente
  const pd = await nova();
  await entrar(pd, 'diretoria@demo.com');
  await pd.goto(base + '/#/metas/alteracoes');
  await pd.click('[data-aprovar]');
  await pd.waitForSelector('.toast:not(.erro)');

  // Colaborador: vê o próprio bônus e não tem acesso à administração
  const pc = await nova({ viewport: { width: 390, height: 800 } });
  await entrar(pc, 'eduardo@demo.com');
  await pc.goto(base + '/#/');
  await pc.waitForSelector('.card.destaque');
  await captura(pc, 'mobile-colaborador');
  assert.equal(await pc.evaluate(() => document.documentElement.scrollWidth), 390, 'sem rolagem horizontal no celular');
  const menu = await pc.textContent('#menuUsuario');
  assert.ok(!/Usuários|Configurações/.test(menu));

  // Gestor: lançamento rápido no celular
  const pg = await nova({ viewport: { width: 390, height: 800 } });
  await entrar(pg, 'bruno@demo.com');
  await pg.goto(base + '/#/lancar');
  await pg.waitForSelector('#fLanc');
  await captura(pg, 'mobile-lancamento');
  // Filtros do lançamento rápido não apagam valores já digitados
  const total = await pg.$$eval('.lanc-item', (l) => l.length);
  const primeiro = await pg.$eval('.lanc-item input', (i) => i.name);
  await pg.fill(`.lanc-item input[name="${primeiro}"]`, '123');
  await pg.fill('#fFiltro [name=busca]', 'refugo');
  const visiveis = await pg.$$eval('.lanc-item:not([hidden])', (l) => l.map((x) => x.textContent));
  assert.ok(visiveis.length >= 1 && visiveis.length < total, 'busca reduz a lista');
  assert.ok(visiveis.every((t) => /refugo/i.test(t)));
  await pg.click('#limpar');
  assert.equal(await pg.$$eval('.lanc-item:not([hidden])', (l) => l.length), total);
  assert.equal(await pg.inputValue(`.lanc-item input[name="${primeiro}"]`), '123', 'valor digitado preservado');
  assert.equal(await pg.evaluate(() => document.documentElement.scrollWidth), 390, 'filtros cabem no celular');

  assert.deepEqual(erros, []);
});
