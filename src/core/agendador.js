'use strict';
// Agendador simples em processo para tarefas periódicas (verificações de alertas, integrações).
function criarAgendador({ ativo = true } = {}) {
  const tarefas = new Map();
  const timers = [];
  async function executar(nome) {
    const t = tarefas.get(nome);
    if (!t || t.rodando) return null;
    t.rodando = true;
    try { t.ultimo = { em: new Date().toISOString(), resultado: await t.fn() }; } catch (e) {
      t.ultimo = { em: new Date().toISOString(), erro: e.message };
      console.error(`[agendador] ${nome}:`, e.message);
    } finally { t.rodando = false; }
    return t.ultimo;
  }
  function registrar(nome, intervaloMs, fn) {
    tarefas.set(nome, { fn, intervaloMs, rodando: false, ultimo: null });
    if (ativo) {
      const tm = setInterval(() => executar(nome), intervaloMs); tm.unref();
      const ini = setTimeout(() => executar(nome), 5000); ini.unref();
      timers.push(tm, ini);
    }
  }
  const status = () => [...tarefas].map(([nome, t]) => ({ nome, intervalo_min: Math.round(t.intervaloMs / 60000), ultimo: t.ultimo }));
  const parar = () => timers.forEach((t) => clearTimeout(t));
  return { registrar, executar, status, parar };
}
module.exports = { criarAgendador };
