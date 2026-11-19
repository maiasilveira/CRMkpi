'use strict';
/* Componentes reutilizáveis: comentários/anexos e notificações. */

const realcarMencoes = (t) => esc(t).replace(/@([a-z0-9._-]+)/gi, (m, l) => (estado.diretorio.some((u) => u.login === l.toLowerCase()) ? `<b class="mencao">@${esc(l)}</b>` : m));

/** Monta o bloco de comentários e anexos de uma entidade dentro de `alvo`. */
async function painelColaboracao(alvo, modulo, entidade, id, { podeAnexar = true } = {}) {
  const base = `${modulo}/${entidade}/${id}`;
  const desenhar = async () => {
    const [coments, anexos] = await Promise.all([api(`/comentarios/${base}`), api(`/anexos/${base}`)]);
    alvo.innerHTML = `<div class="grid g2">
      <div class="card"><h2>Comentários</h2>
        <div class="comentarios">${coments.map((c) => `<div class="comentario"><div class="muted" style="font-size:12px"><b>${esc(c.autor || 'Sistema')}</b> · ${dataHoraBR(c.criado_em)}
          ${c.usuario_id === estado.usuario.id || ehAdmin() ? `<button class="link-btn" data-del-coment="${c.id}" aria-label="Excluir comentário">excluir</button>` : ''}</div>
          <div>${realcarMencoes(c.texto).replace(/\n/g, '<br>')}</div></div>`).join('') || vazio('Nenhum comentário')}</div>
        <form class="form-coment"><label>Novo comentário<textarea name="texto" required placeholder="Use @login para mencionar alguém"></textarea></label>
          <p class="dica">Pessoas: ${estado.diretorio.slice(0, 8).map((u) => `@${esc(u.login)}`).join(', ')}${estado.diretorio.length > 8 ? '…' : ''}</p>
          <div class="rodape-form"><button class="btn pri">Comentar</button></div></form></div>
      <div class="card"><h2>Anexos e evidências</h2>
        ${anexos.length ? `<ul class="anexos">${anexos.map((a) => `<li><a href="/api/anexos/${a.id}" target="_blank" rel="noopener">${esc(a.nome)}</a>
          <span class="muted">${tamanho(a.tamanho)} · ${esc(a.autor || '')} · ${dataBR(a.criado_em)}</span>
          ${podeAnexar ? `<button class="link-btn" data-del-anexo="${a.id}" aria-label="Excluir anexo">excluir</button>` : ''}</li>`).join('')}</ul>` : vazio('Nenhum anexo')}
        ${podeAnexar ? '<label class="upload">Anexar arquivo (PDF, imagem, planilha, documento — até 10 MB)<input type="file" name="arquivo"></label>' : ''}</div></div>`;
    $('.form-coment', alvo).addEventListener('submit', tentar(async (e) => {
      e.preventDefault();
      const r = await api(`/comentarios/${base}`, { metodo: 'POST', corpo: { texto: e.target.texto.value } });
      toast(r.mencionados ? `Comentário publicado; ${r.mencionados} pessoa(s) notificada(s)` : 'Comentário publicado');
      desenhar();
    }));
    const inp = $('input[type=file]', alvo);
    if (inp) inp.addEventListener('change', tentar(async () => { if (!inp.files[0]) return; await enviarArquivo(`/anexos/${base}`, inp.files[0]); toast('Arquivo anexado'); desenhar(); }));
  };
  alvo.addEventListener('click', tentar(async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.delComent && confirmar('Excluir o comentário?')) { await api('/comentarios/' + b.dataset.delComent, { metodo: 'DELETE' }); desenhar(); }
    if (b.dataset.delAnexo && confirmar('Excluir o anexo?')) { await api('/anexos/' + b.dataset.delAnexo, { metodo: 'DELETE' }); desenhar(); }
  }));
  await desenhar();
}

// ============ Notificações ============
async function atualizarSino() {
  if (!estado.usuario) return;
  try {
    const r = await api('/notificacoes?nao_lidas=1');
    const n = r.nao_lidas;
    const b = $('#sinoQtd');
    b.textContent = n > 99 ? '99+' : n; b.hidden = !n;
    $('#sinoBtn').setAttribute('aria-label', `Notificações (${n} não lidas)`);
  } catch { /* silencioso */ }
}
async function abrirNotificacoes() {
  const r = await api('/notificacoes');
  const corpo = abrirModal('Notificações', `<div class="depto-topo"><span class="muted">${r.nao_lidas} não lida(s)</span>${r.nao_lidas ? '<button class="btn peq" id="todasLidas">Marcar todas como lidas</button>' : ''}</div>
    <div class="lista-notif">${r.itens.map((n) => `<a class="notif ${n.lida ? '' : 'nova'}" href="${esc(n.link || '#/')}" data-id="${n.id}">
      <b>${esc(n.titulo)}</b><span>${esc(n.mensagem || '')}</span><small class="muted">${dataHoraBR(n.criado_em)}</small></a>`).join('') || vazio('Nenhuma notificação')}</div>`);
  corpo.addEventListener('click', tentar(async (e) => {
    const a = e.target.closest('a.notif');
    if (a) { await api(`/notificacoes/${a.dataset.id}/lida`, { metodo: 'PUT' }); fecharModal(); atualizarSino(); }
    if (e.target.id === 'todasLidas') { await api('/notificacoes/lidas', { metodo: 'PUT' }); fecharModal(); atualizarSino(); }
  }));
}
