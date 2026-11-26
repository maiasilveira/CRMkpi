'use strict';
/* Inicialização: sessão, menu por perfil, notificações e PWA. */

function montarNav() {
  const itens = [['#/', 'Painel']];
  if (!estado.usuario) { $('#nav').innerHTML = ''; return; }
  if (temModulo('indicadores')) itens.push(['#/indicadores', 'Indicadores'], ['#/planos', 'Planos'], ['#/mapa', 'Mapa estratégico']);
  if (temModulo('metas')) itens.push(['#/metas', 'Metas']);
  if (temModulo('governanca')) itens.push(['#/reunioes', 'Reuniões'], ['#/benchmark', 'Benchmark']);
  $('#nav').innerHTML = itens.map(([h, t]) => `<a href="${h}">${t}</a>`).join('');
  const admin = [
    ['#/departamentos', 'Estrutura organizacional', true],
    ['#/colaboradores', 'Colaboradores', temModulo('metas') && ehGestorOuMais()],
    ['#/metas/alteracoes', 'Alterações de metas', temModulo('metas') && ehGestorOuMais()],
    ['#/importar', 'Importar planilhas', temModulo('indicadores') && ehGestorOuMais()],
    ['#/admin/integracoes', 'Integrações', temModulo('indicadores') && ehDiretoria()],
    ['#/admin/usuarios', 'Usuários', ehAdmin()], ['#/admin/tokens', 'Tokens de API', ehAdmin()], ['#/admin/config', 'Configurações', ehAdmin()],
    ['#/auditoria', 'Auditoria', ehDiretoria()],
  ].filter(([, , v]) => v);
  $('#menuUsuario').innerHTML = `<summary class="btn-icone" aria-label="Menu do usuário">${esc(estado.usuario.nome.split(' ').map((p) => p[0]).slice(0, 2).join(''))}</summary>
    <div><div class="menu-cab"><b>${esc(estado.usuario.nome)}</b><span class="muted">${rot(estado.usuario.perfil)}</span></div>
    <a href="#/perfil">Meu perfil</a>${admin.map(([h, t]) => `<a href="${h}">${t}</a>`).join('')}<button id="sair" class="link-btn">Sair</button></div>`;
  $('#sair').onclick = tentar(async () => { await api('/auth/logout', { metodo: 'POST' }); estado.usuario = null; montarNav(); irPara('#/login'); });
  $('#menuUsuario').addEventListener('click', (e) => { if (e.target.closest('a')) $('#menuUsuario').open = false; });
}

async function iniciarSessao() {
  const st = await api('/auth/estado');
  estado.sso = st.sso;
  if (!st.usuario) { estado.usuario = null; montarNav(); document.body.classList.add('sem-sessao'); return false; }
  const [eu, modulos, deps, dir] = await Promise.all([api('/eu'), api('/modulos'), api('/departamentos'), api('/usuarios/diretorio')]);
  Object.assign(estado, { usuario: eu, modulos, departamentos: deps, diretorio: dir });
  $('#dlPessoas').innerHTML = dir.map((u) => `<option value="${esc(u.nome)}">`).join('');
  document.body.classList.remove('sem-sessao');
  montarNav();
  atualizarSino();
  return true;
}

(function tema() {
  let t = null; try { t = localStorage.getItem('tema'); } catch { /* sem storage */ }
  if (t) document.documentElement.dataset.theme = t;
  $('#temaBtn').onclick = () => {
    const escuro = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = escuro ? 'light' : 'dark';
    try { localStorage.setItem('tema', document.documentElement.dataset.theme); } catch { /* ignora */ }
  };
}());
$('#menuBtn').onclick = () => $('#nav').classList.toggle('aberto');
$('#sinoBtn').onclick = tentar(abrirNotificacoes);

(async function iniciar() {
  try {
    await iniciarSessao();
    window.addEventListener('hashchange', render);
    await render();
    setInterval(atualizarSino, 60000);
  } catch (err) { $('#app').innerHTML = `<div class="card vazio">Não foi possível conectar à API: ${esc(err.message)}</div>`; }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('/sw.js').catch(() => {});
}());
