// Tela Hoje: a primeira coisa útil a fazer, por perfil.
// Gestor/supervisor: no máximo 3 cartões de decisão (Hick, Miller). Equipe: rota do dia. Auditor: alertas.
// Cada cartão leva a uma ação que o perfil pode fazer; toda ação tocada fica no log.
import { el, toast, fmtData, fmtDataHora, fmtMoeda, fmtNum, hojeISO, somarDias, semanaISO, deslocarSemana, distanciaM, diasEntre } from './util.js';
import { estado, ativoPorId, equipeDoUsuario, nomeUsuario, rascunhosDoUsuario } from './store.js';
import { TIPOS_ATIVO, criterio, tipoDefeito, pendenciasDaEquipe, indicadores, PARAM } from './dominio.js';
import { retomarRascunho } from './ui.js';
import { congelamento, congelarSemana, ErroRegra } from './acoes.js';
import { orcamentoDoMes, projecaoCarteira, mesDe } from './custos.js';
import { temposPorEtapa, taxaAchado } from './fluxo.js';
import { definirFiltroDefeitos } from './telas.js';
import { garantirHistorico } from './historico.js';
import { logar, consultarLogs, verificarIntegridade } from './auditoria.js';

const MAX_CARTOES = 3;

function cartao({ id, nivel, titulo, numero, porque, rotulo, acao }) {
  return el('article', { class: `hoje-card hoje-card--${nivel}`, dataset: { cartao: id } },
    el('div', { class: 'hoje-card__cab' },
      el('span', { class: 'hoje-card__nivel', text: nivel === 'critico' ? '⚠ Urgente' : nivel === 'alerta' ? '● Atenção' : 'ℹ Acompanhar' }),
      el('strong', { class: 'hoje-card__num', text: numero })),
    el('h2', { class: 'hoje-card__tit', text: titulo }),
    el('p', { class: 'muted', text: porque }),
    el('button', { type: 'button', class: `btn${nivel === 'critico' ? '' : ' btn--sec'}`, text: rotulo, onclick: () => {
      logar({ categoria: 'NAVEGACAO', acao: 'HOJE_ACAO', entidade: 'cartao', entidadeId: id, detalhe: { titulo } });
      acao();
    } }));
}

/** Candidatos a decisão do dia, com peso; a tela mostra os 3 mais pesados. */
function decisoes(ctx) {
  const d = estado.dados, hoje = hojeISO(), perfil = estado.usuario.perfil, ind = indicadores(d);
  const lista = [];
  const criticosSemData = d.defeitos.filter((f) => f.severidade === 'A' && f.status === 'VALIDADO');
  if (criticosSemData.length) lista.push({ id: 'criticos-sem-data', peso: 100 + criticosSemData.length, nivel: 'critico', titulo: 'Críticos validados sem data',
    numero: fmtNum(criticosSemData.length), porque: `Severidade A tem prazo de ${PARAM.sla.A} dias. O mais antigo foi identificado há ${Math.max(...criticosSemData.map((f) => diasEntre(f.criadoEm, hoje)))} dia(s).`,
    rotulo: 'Programar agora', acao: () => ctx.irPara('programacao') });
  if (ind.criticosVelhos) lista.push({ id: 'criticos-vencidos', peso: 95 + ind.criticosVelhos, nivel: 'critico', titulo: `Críticos com mais de ${PARAM.sla.A} dias`,
    numero: fmtNum(ind.criticosVelhos), porque: 'Fora do prazo: risco de desarme e de compensação por DIC/FIC. Meta é zero.',
    rotulo: 'Ver os críticos', acao: () => { definirFiltroDefeitos({ sev: 'A' }); ctx.irPara('defeitos'); } });
  const prox = deslocarSemana(semanaISO(hoje), 1);
  const semanaAlvo = [semanaISO(hoje), prox].find((s) => !congelamento(s) && d.defeitos.some((f) => f.status === 'PROGRAMADO' && f.programacao?.semana === s));
  if (semanaAlvo) {
    const n = d.defeitos.filter((f) => f.status === 'PROGRAMADO' && f.programacao?.semana === semanaAlvo).length;
    lista.push({ id: 'congelar', peso: semanaAlvo === semanaISO(hoje) ? 80 : 60, nivel: semanaAlvo === semanaISO(hoje) ? 'alerta' : 'info', titulo: `Congelar a semana ${semanaAlvo.slice(5)} (${n} atividade${n > 1 ? 's' : ''})`,
      numero: fmtNum(n), porque: 'Sem congelar, a aderência da programação não é medida e a equipe não tem uma agenda firme.',
      rotulo: 'Congelar a semana', acao: () => {
        try { congelarSemana(semanaAlvo); toast(`Semana ${semanaAlvo.slice(5)} congelada.`, { tipo: 'ok' }); }
        catch (e) { toast(e instanceof ErroRegra ? e.message : 'Não foi possível congelar.', { tipo: 'erro' }); }
      } });
  }
  if (ind.aguardandoVerificacao) lista.push({ id: 'verificar', peso: 50 + Math.min(30, ind.aguardandoVerificacao), nivel: ind.aguardandoVerificacao > 10 ? 'alerta' : 'info', titulo: 'Execuções aguardando verificação',
    numero: fmtNum(ind.aguardandoVerificacao), porque: 'Sem verificação o defeito não fecha, o ranking não pontua e a eficácia da manutenção fica sem base.',
    rotulo: 'Verificar', acao: () => { definirFiltroDefeitos({ status: 'EXECUTADO' }); ctx.irPara('defeitos'); } });
  const o = orcamentoDoMes(mesDe(hoje)), crit = projecaoCarteira().reduce((t, p) => t + p.valorCriticos, 0);
  if (perfil === 'GESTOR' && crit > o.total.saldo) lista.push({ id: 'orcamento', peso: 70, nivel: 'alerta', titulo: 'Saldo do mês não cobre os críticos',
    numero: fmtMoeda(crit - o.total.saldo), porque: `Faltam ${fmtMoeda(crit - o.total.saldo)} para programar todos os críticos sem data (saldo ${fmtMoeda(o.total.saldo)}).`,
    rotulo: 'Ver custo × orçamento', acao: () => ctx.irPara('programacao') });
  const tp = temposPorEtapa();
  if (tp.gargalo?.limite && tp.gargalo.mediana > tp.gargalo.limite) lista.push({ id: 'gargalo', peso: 45, nivel: 'alerta', titulo: `Gargalo: até ${tp.gargalo.nome.toLowerCase()}`,
    numero: `${String(tp.gargalo.mediana).replace('.', ',')} d`, porque: `Mediana acima do limite de ${tp.gargalo.limite} dia(s) nessa etapa.`,
    rotulo: 'Ver o fluxo', acao: () => ctx.irPara('painel') });
  const tx = taxaAchado(90).equipes.filter((e) => e.alerta);
  if (tx.length) lista.push({ id: 'achado-baixo', peso: 40, nivel: 'info', titulo: 'Equipe achando pouco por km',
    numero: fmtNum(tx.length), porque: `${tx.map((e) => e.nome).join(', ')}: menos da metade da média de defeitos/km. Sinal antecipado de inspeção superficial.`,
    rotulo: 'Ver taxa de achado', acao: () => ctx.irPara('painel') });
  if (ind.vencidas && perfil === 'SUPERVISOR') lista.push({ id: 'insp-vencidas', peso: 55, nivel: 'alerta', titulo: 'Inspeções vencidas',
    numero: fmtNum(ind.vencidas), porque: 'Prazo do plano expirado sem execução.', rotulo: 'Distribuir no Plano', acao: () => ctx.irPara('plano') });
  return lista.sort((a, b) => b.peso - a.peso);
}

/** Rota do dia da equipe: o que vence em até 7 dias e o programado para hoje, na ordem do vizinho mais próximo. */
function rotaDoDia(eq) {
  const d = estado.dados, hoje = hojeISO(), limite = somarDias(hoje, 7);
  const itens = pendenciasDaEquipe(d, eq).filter((p) => (p.tipo === 'inspecao' ? p.ref.prazo <= limite : p.ref.status === 'PROGRAMADO' && (p.ref.programacao?.data || hoje) <= hoje))
    .map((p) => ({ ...p, a: ativoPorId(p.ativoId) })).filter((p) => p.a);
  let pos = estado.posicao || (itens[0] && { lat: itens[0].a.lat, lon: itens[0].a.lon });
  const restantes = [...itens], ordem = [];
  while (restantes.length && pos) {
    let k = 0, melhor = Infinity;
    restantes.forEach((p, i) => { const m = distanciaM(pos.lat, pos.lon, p.a.lat, p.a.lon); if (m < melhor) { melhor = m; k = i; } });
    const [p] = restantes.splice(k, 1);
    ordem.push({ ...p, distM: melhor });
    pos = { lat: p.a.lat, lon: p.a.lon };
  }
  return ordem;
}

function telaEquipe(raiz, ctx, eq) {
  const rota = rotaDoDia(eq), rasc = rascunhosDoUsuario();
  const totalKm = rota.reduce((t, p, i) => t + (i ? p.distM : 0), 0) / 1000;
  raiz.replaceChildren(
    el('header', { class: 'tela__topo' }, el('h1', { text: `Hoje — ${eq.nome}` }),
      el('span', { class: 'muted', text: `${rota.length} parada(s) · cerca de ${totalKm.toFixed(1).replace('.', ',')} km em linha reta${estado.posicao ? ' a partir da sua posição' : ''}` })),
    rasc.length ? el('section', { class: 'bloco bloco--aviso' }, el('h2', { text: `Em andamento (${rasc.length})` }),
      el('p', { class: 'muted', text: 'Inspeção iniciada e não concluída. Termine antes de começar outra.' }),
      el('ul', { class: 'lista' }, rasc.map((r) => el('li', { class: 'lista__item' }, el('button', { type: 'button', class: 'btn btn--sec', text: `Retomar ${r.titulo || 'inspeção'}`, onclick: () => { ctx.irPara('mapa'); retomarRascunho(r); } }))))) : null,
    rota.length ? el('ol', { class: 'rota' }, rota.map((p, i) => el('li', { class: 'rota__item' },
      el('span', { class: 'rota__n', text: i + 1, 'aria-hidden': 'true' }),
      el('div', { class: 'rota__txt' },
        el('strong', { text: `${p.a.codigo} · ${TIPOS_ATIVO[p.a.tipo]}` }),
        el('span', { class: 'muted pequeno', text: p.tipo === 'inspecao' ? `Inspeção ${criterio(p.ref.criterioId)?.nome || ''} · prazo ${fmtData(p.ref.prazo)}${p.ref.prazo < hojeISO() ? ' · VENCIDA' : ''}` : `Defeito ${tipoDefeito(p.ref.tipoId)?.nome} · sev. ${p.ref.severidade}` }),
        el('span', { class: 'muted pequeno', text: `${p.a.alimentador}${i ? ` · ${p.distM < 1000 ? `${Math.round(p.distM)} m` : `${(p.distM / 1000).toFixed(1).replace('.', ',')} km`} da anterior` : ''}` })),
      el('button', { type: 'button', class: 'btn btn--sec', text: 'Abrir', 'aria-label': `Abrir ${p.a.codigo} no mapa`, onclick: () => { logar({ categoria: 'NAVEGACAO', acao: 'HOJE_ROTA_ABERTA', entidade: 'ativo', entidadeId: p.a.id, detalhe: { ordem: i + 1 } }); ctx.abrirNoMapa(p.a.id); } }))))
      : el('p', { class: 'vazio', text: '✓ Nada pendente para hoje. Inspeções avulsas podem ser registradas pelo mapa.' }),
    el('p', { class: 'muted pequeno', text: 'Ordem pelo ponto mais próximo (sem considerar ruas). Ative o GPS no mapa para recalcular a partir de onde você está.' }));
}

async function telaAuditor(raiz, ctx) {
  const corpo = el('div', { class: 'hoje-cards', 'aria-busy': 'true' }, el('p', { class: 'muted', text: 'Verificando a cadeia de logs…' }));
  raiz.replaceChildren(el('header', { class: 'tela__topo' }, el('h1', { text: 'Hoje — auditoria' }), el('span', { class: 'muted', text: 'Alertas para conferir' })), corpo);
  const [integ, negados] = await Promise.all([verificarIntegridade(), consultarLogs({ resultado: 'NEGADO' })]);
  const desde = somarDias(hojeISO(), -7);
  const negRec = negados.filter((x) => x.em.slice(0, 10) >= desde);
  const params = (estado.dados.parametros?.versoes || []).filter((v) => (v.em || '').slice(0, 10) >= desde);
  const cards = [
    cartao({ id: 'integridade', nivel: integ.ok ? 'info' : 'critico', titulo: integ.ok ? 'Cadeia de logs íntegra' : 'Cadeia de logs quebrada', numero: fmtNum(integ.total ?? 0),
      porque: integ.ok ? 'Nenhum registro alterado ou removido no aparelho.' : `Quebra a partir do registro ${integ.quebraEm ?? '?'} — tratar como incidente.`,
      rotulo: 'Abrir logs', acao: () => ctx.irPara('acesso') }),
    cartao({ id: 'negados', nivel: negRec.length ? 'alerta' : 'info', titulo: 'Ações negadas (7 dias)', numero: fmtNum(negRec.length),
      porque: negRec.length ? `Última: ${negRec[0].acao} por ${nomeUsuario(negRec[0].usuario)} em ${fmtDataHora(negRec[0].em)}.` : 'Nenhuma tentativa fora do perfil.', rotulo: 'Ver no log', acao: () => ctx.irPara('acesso') }),
    cartao({ id: 'parametros', nivel: params.length ? 'alerta' : 'info', titulo: 'Parâmetros alterados (7 dias)', numero: fmtNum(params.length),
      porque: params.length ? 'Pesos, prazos, preços ou orçamento mudaram — conferir justificativa e vigência.' : 'Sem mudança de regra na semana.', rotulo: 'Ver parâmetros', acao: () => ctx.irPara('parametros') }),
  ];
  corpo.removeAttribute('aria-busy');
  corpo.replaceChildren(...cards);
}

export function telaHoje(raiz, ctx) {
  const u = estado.usuario;
  garantirHistorico();
  if (u.perfil === 'AUDITOR') { telaAuditor(raiz, ctx); return; }
  const eq = equipeDoUsuario();
  if (u.perfil === 'EQUIPE' && eq) { telaEquipe(raiz, ctx, eq); return; }
  const todas = decisoes(ctx);
  const mostrar = todas.slice(0, MAX_CARTOES);
  raiz.replaceChildren(
    el('header', { class: 'tela__topo' }, el('h1', { text: `Hoje — ${fmtData(hojeISO())}` }),
      el('span', { class: 'muted', text: mostrar.length ? `${mostrar.length} decisão(ões) mais importante(s) agora${todas.length > MAX_CARTOES ? ` · +${todas.length - MAX_CARTOES} no Painel` : ''}` : 'Nada urgente' })),
    mostrar.length ? el('div', { class: 'hoje-cards' }, mostrar.map(cartao))
      : el('p', { class: 'vazio', text: '✓ Sem críticos sem data, semana congelada e nada aguardando verificação.' }),
    el('div', { class: 'linha' },
      el('button', { type: 'button', class: 'btn btn--txt', text: 'Ver o painel completo', onclick: () => ctx.irPara('painel') }),
      el('button', { type: 'button', class: 'btn btn--txt', text: 'Abrir o mapa', onclick: () => ctx.irPara('mapa') })));
}
