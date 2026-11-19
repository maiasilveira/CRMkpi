'use strict';
const express = require('express');
const E = require('./erros');
const { lerCookies, definirCookie, COOKIE } = require('./autenticacao');

/** Rotas públicas de autenticação (/api/auth). */
function rotasAuth(core, sso) {
  const r = express.Router();
  const responderLogin = (res, u) => { const s = core.criarSessao(u.id); definirCookie(res, s.token, s.expira); return core.publico(u); };

  r.get('/estado', (req, res) => res.json({
    precisa_configurar: core.totalUsuarios() === 0,
    sso: sso.ativo ? { nome: sso.nome } : null,
    usuario: req.usuario ? { ...core.publico(req.usuario) } : null,
  }));
  // Primeiro acesso: cria o administrador inicial (só funciona com o banco sem usuários)
  r.post('/configurar', (req, res) => {
    E.exigir(core.totalUsuarios() === 0, 'O sistema já foi configurado', 409);
    const u = core.salvarUsuario({ ...req.body, perfil: 'admin' }, null, { bootstrap: true });
    res.status(201).json(responderLogin(res, core.obterUsuario(u.id)));
  });
  r.post('/login', (req, res) => res.json(responderLogin(res, core.autenticar(req.body?.email, req.body?.senha))));
  r.post('/logout', (req, res) => {
    const t = lerCookies(req)[COOKIE];
    if (t) core.encerrarSessao(t);
    definirCookie(res, '', null);
    res.status(204).end();
  });
  r.get('/sso/iniciar', async (req, res, next) => { try { res.redirect(await sso.iniciar()); } catch (e) { next(e); } });
  r.get('/sso/retorno', async (req, res) => {
    try {
      const u = await sso.concluir(req.query.code, req.query.state);
      responderLogin(res, u);
      res.redirect('/#/');
    } catch (e) {
      res.redirect('/#/login?erro=' + encodeURIComponent(e.message));
    }
  });
  return r;
}

/** Rotas autenticadas do núcleo. */
function rotasCore(core, modulosAtivos) {
  const r = express.Router();
  const n = (v) => Number(v);
  r.get('/modulos', (req, res) => res.json(modulosAtivos));
  r.get('/eu', (req, res) => res.json({ ...core.publico(req.usuario), departamentos_visiveis: core.deptosVisiveis(req.usuario) }));
  r.put('/eu/senha', (req, res) => { core.alterarPropriaSenha(req.body?.atual, req.body?.nova); res.status(204).end(); });
  r.put('/eu/preferencias', (req, res) => res.json(core.preferencias(req.body || {})));

  r.get('/departamentos', (req, res) => res.json(core.listarDepartamentos({ incluirInativos: req.query.todos === '1' })));
  r.get('/departamentos/:id', (req, res) => { core.garantirVer(n(req.params.id)); res.json(core.obterDepartamento(n(req.params.id))); });
  r.post('/departamentos', (req, res) => res.status(201).json(core.salvarDepartamento(req.body)));
  r.put('/departamentos/:id', (req, res) => res.json(core.salvarDepartamento(req.body, n(req.params.id))));

  r.get('/usuarios/diretorio', (req, res) => res.json(core.diretorio()));
  r.get('/usuarios', (req, res) => { core.exigirPerfil(); res.json(core.listarUsuarios()); });
  r.post('/usuarios', (req, res) => res.status(201).json(core.salvarUsuario(req.body)));
  r.put('/usuarios/:id', (req, res) => res.json(core.salvarUsuario(req.body, n(req.params.id))));

  r.get('/tokens', (req, res) => res.json(core.listarTokensApi()));
  r.post('/tokens', (req, res) => res.status(201).json(core.criarTokenApi(req.body?.nome, req.body?.usuario_id)));
  r.delete('/tokens/:id', (req, res) => { core.revogarTokenApi(n(req.params.id)); res.status(204).end(); });

  r.get('/configuracoes', (req, res) => res.json(core.listarConfig()));
  r.put('/configuracoes', (req, res) => res.json(core.salvarConfig(req.body)));

  r.get('/auditoria', (req, res) => res.json(core.listarAuditoria(req.query)));
  return r;
}

module.exports = { rotasAuth, rotasCore };

/** Rotas de notificações, comentários e anexos. */
function rotasColaboracao(core, notif, colab, agendador) {
  const r = express.Router();
  const n = (v) => Number(v);
  r.get('/notificacoes', (req, res) => res.json(notif.listar({ apenasNaoLidas: req.query.nao_lidas === '1' })));
  r.put('/notificacoes/lidas', (req, res) => { notif.marcarTodas(); res.status(204).end(); });
  r.put('/notificacoes/:id/lida', (req, res) => { notif.marcarLida(n(req.params.id)); res.status(204).end(); });
  r.post('/notificacoes/verificar', async (req, res, next) => {
    try { core.exigirPerfil(); res.json(await notif.executarVerificacoes()); } catch (e) { next(e); }
  });
  r.post('/notificacoes/teste', async (req, res, next) => { try { res.json(await notif.testarCanais()); } catch (e) { next(e); } });
  r.get('/notificacoes/envios', (req, res) => res.json(notif.enviados()));
  r.get('/agendador', (req, res) => { core.exigirPerfil(); res.json(agendador.status()); });

  const ent = '/:modulo(\\w+)/:entidade(\\w+)/:id(\\d+)';
  r.get('/comentarios' + ent, (req, res) => res.json(colab.listarComentarios(req.params.modulo, req.params.entidade, n(req.params.id))));
  r.post('/comentarios' + ent, (req, res) => res.status(201).json(colab.comentar(req.params.modulo, req.params.entidade, n(req.params.id), req.body?.texto)));
  r.delete('/comentarios/:id', (req, res) => { colab.excluirComentario(n(req.params.id)); res.status(204).end(); });

  r.get('/anexos' + ent, (req, res) => res.json(colab.listarAnexos(req.params.modulo, req.params.entidade, n(req.params.id))));
  r.post('/anexos' + ent, express.raw({ type: () => true, limit: '25mb' }), (req, res) =>
    res.status(201).json(colab.anexar(req.params.modulo, req.params.entidade, n(req.params.id), req.query.nome, req.body)));
  r.get('/anexos/:id', (req, res) => {
    const a = colab.obterAnexo(n(req.params.id));
    res.setHeader('Content-Type', a.mime);
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Content-Disposition', `${a.inline && req.query.baixar !== '1' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.nome)}`);
    res.sendFile(a.caminho);
  });
  r.delete('/anexos/:id', (req, res) => { colab.excluirAnexo(n(req.params.id)); res.status(204).end(); });
  return r;
}
module.exports.rotasColaboracao = rotasColaboracao;
