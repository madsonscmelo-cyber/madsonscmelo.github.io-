// Sincroniza a base pública (Setor Norte) ao entrar: baixa a UTD escolhida só quando a versão publicada mudou.
// Base importada pelo usuário tem prioridade: enquanto ela existir, a pública não a substitui sem pedido explícito.
import { el, toast } from './util.js';
import { estado, persistir, substituirRede, emitir } from './store.js';
import { lerManifesto, carregarUTD } from './fonte.js';
import { logar } from './auditoria.js';

let emCurso = null;

function painelCarga(nome) {
  const barra = el('span', { class: 'progresso-dia__preench' });
  const txt = el('span', { text: `Carregando a base do Setor Norte · ${nome}…` });
  const caixa = el('div', { class: 'carga-base', role: 'status', 'aria-live': 'polite' },
    el('div', { class: 'progresso-dia' }, el('div', { class: 'progresso-dia__txt' }, txt), el('span', { class: 'progresso-dia__trilho' }, barra)));
  document.body.append(caixa);
  return { progresso: (f) => { barra.style.width = `${Math.round(f * 100)}%`; }, fechar: () => caixa.remove() };
}

/** forcarUtd: troca de UTD pedida pelo usuário (também substitui uma base importada). */
export function sincronizarBasePublica({ forcarUtd = '' } = {}) {
  if (emCurso) return emCurso;
  emCurso = (async () => {
    if (estado.rede?.origem === 'IMPORTADA' && !forcarUtd) return false;
    const m = await lerManifesto();
    estado.manifesto = m;
    if (!m) return false;
    const utd = forcarUtd || estado.dados.utdPublica || m.padrao || m.utds[0].id;
    const u = m.utds.find((x) => x.id === utd) || m.utds[0];
    if (estado.rede?.versao === `pub-${m.versao}-${u.id}`) { emitir('mudou'); return true; }
    const painel = painelCarga(u.nome);
    try {
      const rede = await carregarUTD(m, u.id, painel.progresso);
      estado.dados.utdPublica = u.id;
      await persistir();
      await substituirRede(rede);
      logar({ categoria: 'LEITURA', acao: 'BASE_PUBLICA_CARREGADA', detalhe: { versao: m.versao, utd: u.id, alimentadores: rede.alimentadores.length, postes: rede.postes.length, ocorrencias: rede.ocorrencias.length } });
      toast(`Base ${rede.titulo} · ${u.nome}: ${rede.alimentadores.length} alimentadores carregados.`, { tipo: 'ok' });
      return true;
    } catch (e) {
      logar({ categoria: 'SISTEMA', acao: 'BASE_PUBLICA_FALHOU', resultado: 'ERRO', detalhe: { utd: u.id, mensagem: e.message } });
      toast(`Não foi possível carregar a base publicada: ${e.message} Seguindo com a base atual.`, { tipo: 'erro', duracao: 9000 });
      return false;
    } finally { painel.fechar(); }
  })().finally(() => { emCurso = null; });
  return emCurso;
}
