// Trajeto de inspeção: inspeção de trecho (GPS), patrulha da emergência e voo de drone (log importado).
// Uma inspeção só conta no KMI se for completa: cobertura ≥ mínima + checklist respondido + foto.
import { el, $, toast, fmtData, fmtDataHora, fmtPct, uid, distanciaM } from './util.js';
import { estado, registrar, equipeDoUsuario, nomeEquipe } from './store.js';
import { PARAM } from './dominio.js';
import { cobertura, amostrar, lerTrajeto, distanciaAteLinha } from './rede.js';
import { trechos, trechoPorId, situacaoTrecho, areasDoTrecho, tipoPlano, inspecoesDoTrecho } from './planos.js';
import { abrirSheet, fecharSheet } from './ui.js';
import { campoFotos } from './fotos.js';
import { ErroRegra } from './acoes.js';
import { logar } from './auditoria.js';
import * as mapa from './mapa.js';

const CHECKLIST_TRECHO = ['Vegetação afastada dos condutores', 'Faixa de servidão limpa (roçada)', 'Estruturas (postes, cruzetas, isoladores)', 'Condutores, emendas e conexões', 'Equipamentos (chaves, trafos, para-raios)', 'Risco a terceiros (cabo baixo, poste acessível)'];
const PERFIS_CAMPO = ['EQUIPE', 'SUPERVISOR', 'GESTOR'];

export const trilhaAtiva = () => estado.trilha || null;

function exigirCampo() {
  if (!PERFIS_CAMPO.includes(estado.usuario?.perfil)) throw new ErroRegra('Seu perfil não registra inspeções.', 'PERMISSAO');
}

// ---------- Gravação ----------
export function iniciarTrilha(modo, trechoId = null) {
  exigirCampo();
  if (estado.trilha) throw new ErroRegra('Já existe um trajeto em gravação. Conclua ou cancele antes.');
  estado.trilha = { id: uid('tj'), modo, trechoId, inicio: new Date().toISOString(), pontos: [] };
  if (estado.posicao) estado.trilha.pontos.push([estado.posicao.lat, estado.posicao.lon]);
  logar({ categoria: 'ESCRITA', acao: modo === 'PATRULHA' ? 'PATRULHA_INICIADA' : 'INSPECAO_TRECHO_INICIADA', entidade: 'trecho', entidadeId: trechoId });
  atualizarPainel();
}

/** Recebe cada posição (GPS real ou simulada) enquanto o trajeto está gravando. */
export function adicionarPonto({ lat, lon }) {
  const t = estado.trilha;
  if (!t || t.pausada) return;
  const ult = t.pontos.at(-1);
  if (ult && distanciaM(ult[0], ult[1], lat, lon) < 3) return; // ignora ruído parado
  t.pontos.push([lat, lon]);
  atualizarPainel();
}

/** Pausa/retoma a gravação (almoço, parada no veículo, área sem acesso) sem perder o trajeto. */
export function pausarTrilha() {
  const t = estado.trilha;
  if (!t) return;
  t.pausada = !t.pausada;
  logar({ categoria: 'ESCRITA', acao: t.pausada ? 'TRAJETO_PAUSADO' : 'TRAJETO_RETOMADO', detalhe: { modo: t.modo, pontos: t.pontos.length } });
  atualizarPainel();
}

export function cancelarTrilha() {
  if (!estado.trilha) return;
  logar({ categoria: 'ESCRITA', acao: 'TRAJETO_CANCELADO', detalhe: { modo: estado.trilha.modo, pontos: estado.trilha.pontos.length } });
  estado.trilha = null;
  mapa.desenharTrilha([]);
  atualizarPainel();
}

/** Demonstração: percorre o trecho a pé (pontos a cada 25 m com pequeno desvio), como se o GPS estivesse andando. */
export function simularPercurso(trechoId, { fracao = 1, aoTerminar } = {}) {
  const t = trechoPorId(trechoId || estado.trilha?.trechoId);
  if (!t || !estado.trilha) return;
  const pts = amostrar(t.coords, 25);
  const n = Math.ceil(pts.length * fracao);
  let i = 0;
  const timer = setInterval(() => {
    if (!estado.trilha || i >= n) { clearInterval(timer); aoTerminar?.(); return; }
    const [la, lo] = pts[i++];
    const p = { lat: la + (Math.random() - 0.5) * 0.00008, lon: lo + (Math.random() - 0.5) * 0.00008 };
    estado.posicao = { ...p, precisao: 6, simulada: true, em: new Date().toISOString() };
    mapa.definirPosicao(estado.posicao);
    adicionarPonto(p);
  }, 15);
}

/** Painel flutuante no mapa enquanto grava. */
export function atualizarPainel() {
  const box = $('#trilha-painel');
  if (!box) return;
  const t = estado.trilha;
  box.hidden = !t;
  if (!t) return;
  mapa.desenharTrilha(t.pontos);
  const trecho = t.trechoId ? trechoPorId(t.trechoId) : null;
  const cob = trecho ? cobertura(trecho.coords, t.pontos, PARAM.faixaTrilhaM) : null;
  const kmPerc = t.pontos.reduce((s, p, i) => (i ? s + distanciaM(t.pontos[i - 1][0], t.pontos[i - 1][1], p[0], p[1]) : 0), 0) / 1000;
  const barra = el('span', { class: 'progresso-dia__preench' });
  barra.style.width = `${Math.round((cob ?? 0) * 100)}%`;
  const patrulha = t.modo === 'PATRULHA';
  box.classList.toggle('trilha-painel--patrulha', patrulha);
  box.replaceChildren(
    el('div', { class: 'trilha__tit' }, el('span', { class: `rec${t.pausada ? ' rec--pausa' : ''}`, 'aria-hidden': 'true' }),
      el('strong', { text: `${patrulha ? 'Patrulha' : `Inspeção do trecho ${t.trechoId}`}${t.pausada ? ' — PAUSADA' : ' em andamento'}` })),
    patrulha ? el('p', { class: 'pequeno aviso-direcao', text: '⚠ Quem dirige não opera o app. A gravação é automática; o passageiro pausa ou encerra.' }) : null,
    el('div', { class: 'pequeno', text: `${kmPerc.toFixed(2)} km percorridos · ${t.pontos.length} pontos${cob !== null ? ` · cobertura ${fmtPct(cob)} (mín. ${PARAM.coberturaMinPct}%)` : ''}` }),
    cob !== null ? el('span', { class: 'progresso-dia__trilho' }, barra) : null,
    el('div', { class: `linha${patrulha ? ' trilha__grandes' : ''}` },
      el('button', { type: 'button', class: `btn btn--sec${patrulha ? ' btn--grande' : ''}`, text: t.pausada ? '▶ Retomar' : '⏸ Pausar', 'aria-pressed': String(!!t.pausada), onclick: pausarTrilha }),
      el('button', { type: 'button', class: `btn${patrulha ? ' btn--grande' : ''}`, text: t.modo === 'PATRULHA' ? 'Encerrar patrulha' : 'Concluir', onclick: () => (t.modo === 'PATRULHA' ? encerrarPatrulha() : abrirConclusao({ trechoId: t.trechoId, tipo: 'TERRESTRE', pontos: t.pontos, inicio: t.inicio })) }),
      t.trechoId ? el('button', { type: 'button', class: 'btn btn--sec', text: 'Simular caminhada (demo)', onclick: () => simularPercurso(t.trechoId) }) : null,
      el('button', { type: 'button', class: 'btn btn--txt', text: 'Cancelar', onclick: () => { if (confirm('Descartar o trajeto gravado?')) cancelarTrilha(); } })));
}

// ---------- Ficha do trecho ----------
export function abrirTrecho(id) {
  const t = trechoPorId(id);
  if (!t) return;
  const s = situacaoTrecho(t);
  const hist = inspecoesDoTrecho(id).slice(0, 6);
  const planos = areasDoTrecho(id);
  const corpo = el('div', { class: 'ficha' },
    el('div', { class: 'ficha__estado' }, el('span', { class: `chip chip--tr-${s.id}`, text: s.id === 'vencido' ? 'Inspeção vencida' : s.id === 'vencendo' ? `Vence ${fmtData(s.venceEm)}` : `Em dia até ${fmtData(s.venceEm)}` }),
      ...planos.map((a) => el('span', { class: `chip chip--plano-${a.tipoPlano.toLowerCase()}`, text: tipoPlano(a.tipoPlano)?.nome || a.tipoPlano }))),
    el('div', { class: 'meta' },
      el('div', { class: 'meta__item' }, el('span', { class: 'meta__rotulo', text: 'Alimentador' }), el('span', { class: 'meta__valor', text: `${t.alimentador} · ${t.conjunto}` })),
      el('div', { class: 'meta__item' }, el('span', { class: 'meta__rotulo', text: 'Extensão' }), el('span', { class: 'meta__valor', text: `${t.km.toFixed(2)} km` })),
      el('div', { class: 'meta__item' }, el('span', { class: 'meta__rotulo', text: 'Exigência' }), el('span', { class: 'meta__valor', text: `${s.exigencia.plano} · a cada ${s.exigencia.periodicidade} dias` })),
      el('div', { class: 'meta__item' }, el('span', { class: 'meta__rotulo', text: 'Última completa' }), el('span', { class: 'meta__valor', text: s.ultima ? `${fmtData(s.ultima.fim)} · ${s.ultima.tipo === 'DRONE' ? 'drone' : 'terrestre'} · ${fmtPct(s.ultima.cobertura)}` : 'nunca' }))),
    el('h3', { text: 'Histórico' }),
    hist.length ? el('ul', { class: 'lista' }, hist.map((i) => el('li', { class: 'lista__item pequeno', text: `${fmtDataHora(i.fim)} · ${i.tipo === 'PATRULHA' ? 'Patrulha' : i.tipo === 'DRONE' ? 'Drone' : 'Terrestre'} · ${nomeEquipe(i.equipeId)} · cobertura ${fmtPct(i.cobertura)} · ${i.completa ? 'completa ✓' : 'não conta no KMI'}` })))
      : el('p', { class: 'muted', text: 'Sem inspeções registradas.' }),
    el('div', { class: 'ficha__acoes' },
      el('button', { type: 'button', class: 'btn btn--sec', text: '🛩 Importar voo de drone', onclick: () => importarDrone(id) }),
      el('a', { class: 'btn btn--txt', href: `https://www.google.com/maps/dir/?api=1&destination=${t.coords[0][0]},${t.coords[0][1]}`, target: '_blank', rel: 'noopener noreferrer', text: '🧭 Rota até o início do trecho' })));
  const pode = PERFIS_CAMPO.includes(estado.usuario.perfil);
  const rodape = pode ? el('button', { type: 'button', class: 'btn btn--grande', text: estado.trilha ? 'Já existe um trajeto gravando' : 'Iniciar inspeção do trecho', disabled: !!estado.trilha, onclick: () => {
    try { iniciarTrilha('TRECHO', id); fecharSheet(); toast('Gravando o trajeto. Percorra o trecho; ao final toque em Concluir.', { tipo: 'ok' }); } catch (e) { toast(e.message, { tipo: 'erro' }); }
  } }) : null;
  logar({ categoria: 'LEITURA', acao: 'TRECHO_CONSULTADO', entidade: 'trecho', entidadeId: id });
  abrirSheet(`Trecho ${t.id}`, corpo, { tipo: 'trecho', id }, rodape);
}

// ---------- Conclusão (terrestre, drone ou completar patrulha) ----------
export function abrirConclusao({ trechoId, tipo, pontos, inicio, origemPatrulha }) {
  const t = trechoPorId(trechoId);
  const cob = cobertura(t.coords, pontos, PARAM.faixaTrilhaM);
  const resp = {};
  const ck = el('fieldset', { class: 'checklist' }, el('legend', { text: tipo === 'DRONE' ? 'Checklist (análise das imagens do voo)' : 'Checklist do trecho' }),
    CHECKLIST_TRECHO.map((item) => {
      const grupo = el('div', { class: 'segmentado', role: 'radiogroup', 'aria-label': item });
      const desenhar = () => grupo.replaceChildren(...[['C', 'OK'], ['NC', 'Não conforme'], ['NA', 'N/A']].map(([v, r]) => el('button', { type: 'button', role: 'radio', 'aria-checked': String(resp[item] === v),
        class: `segmentado__op segmentado__op--${v.toLowerCase()}${resp[item] === v ? ' ativo' : ''}`, text: r, onclick: () => { resp[item] = v; desenhar(); } })));
      desenhar();
      return el('div', { class: 'checklist__item' }, el('span', { text: item }), grupo);
    }));
  const fotos = campoFotos({ rotulo: () => `${tipo === 'DRONE' ? 'Drone' : 'Trecho'} ${trechoId}`, minimo: 1, titulo: tipo === 'DRONE' ? 'Imagens do voo (mín. 1)' : 'Fotos do trecho (mín. 1)' });
  const obs = el('textarea', { class: 'campo__input', rows: 2, maxlength: 500, placeholder: 'Observações; defeitos encontrados devem ser registrados no ativo (botão Registrar defeito)' });
  const ok = cob * 100 >= PARAM.coberturaMinPct;
  const corpo = el('div', { class: 'form' },
    el('p', { class: `geo ${ok ? 'geo--ok' : 'geo--alerta'}`, text: `Cobertura do trecho: ${fmtPct(cob)} (mínimo ${PARAM.coberturaMinPct}%). ${ok ? 'Conta no KMI se o checklist e a foto forem preenchidos.' : 'Abaixo do mínimo: será registrada como inspeção parcial (não conta no KMI).'}` }),
    ck, fotos.elemento, el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Observações' }), obs));
  const salvar = () => {
    try {
      exigirCampo();
      const respondidos = CHECKLIST_TRECHO.every((i) => resp[i]);
      const completa = ok && respondidos && fotos.suficiente();
      if (!completa && !confirm(`A inspeção não cumpre o critério (${[!ok && 'cobertura', !respondidos && 'checklist', !fotos.suficiente() && 'foto'].filter(Boolean).join(', ')}). Salvar como parcial?`)) return;
      const eq = equipeDoUsuario();
      const reg = { id: uid('it'), trechoId, tipo, equipeId: eq?.id || null, inicio: inicio || new Date().toISOString(), fim: new Date().toISOString(),
        cobertura: Math.round(cob * 1000) / 1000, km: Math.round(t.km * (completa ? 1 : cob) * 100) / 100, completa, checklist: { ...resp }, fotos: fotos.fotos(), observacao: obs.value.trim(),
        pontos: pontos.length, origemPatrulha: origemPatrulha || null, por: estado.usuario.id };
      (estado.dados.inspecoesTrecho ||= []).push(reg);
      if (estado.trilha && estado.trilha.trechoId === trechoId) { estado.trilha = null; mapa.desenharTrilha([]); atualizarPainel(); }
      registrar(tipo === 'DRONE' ? 'INSPECAO_DRONE' : 'INSPECAO_TRECHO', 'trecho', trechoId, { completa, cobertura: reg.cobertura, km: reg.km, naoConformes: Object.values(resp).filter((v) => v === 'NC').length });
      toast(completa ? `Trecho ${trechoId}: inspeção completa (${t.km.toFixed(2)} km no KMI).` : `Trecho ${trechoId}: inspeção parcial registrada.`, { tipo: completa ? 'ok' : 'aviso' });
      fecharSheet();
    } catch (e) { toast(e.message, { tipo: 'erro' }); }
  };
  abrirSheet(`${tipo === 'DRONE' ? 'Voo de drone' : 'Concluir inspeção'} · ${trechoId}`, corpo, { tipo: 'form' }, el('button', { type: 'button', class: 'btn btn--grande', text: 'Salvar inspeção do trecho', onclick: salvar }));
}

// ---------- Drone ----------
function importarDrone(trechoId) {
  const inp = el('input', { type: 'file', accept: '.kml,.csv,.txt', class: 'oculto' });
  inp.addEventListener('change', async () => {
    const f = inp.files[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { toast('Arquivo maior que 5 MB.', { tipo: 'erro' }); return; }
    const pts = lerTrajeto(await f.text());
    if (pts.length < 2) { toast('Não encontrei coordenadas no arquivo (KML com <coordinates> ou CSV com lat/lon).', { tipo: 'erro' }); return; }
    logar({ categoria: 'ESCRITA', acao: 'VOO_DRONE_IMPORTADO', entidade: 'trecho', entidadeId: trechoId, detalhe: { arquivo: f.name, pontos: pts.length } });
    mapa.desenharTrilha(pts);
    abrirConclusao({ trechoId, tipo: 'DRONE', pontos: pts });
  });
  document.body.append(inp);
  inp.click();
  setTimeout(() => inp.remove(), 60000);
}

// ---------- Patrulha da emergência ----------
export function iniciarPatrulha() {
  try { iniciarTrilha('PATRULHA'); toast('Patrulha iniciada: o trajeto é gravado e convertido em km por trecho.', { tipo: 'ok' }); } catch (e) { toast(e.message, { tipo: 'erro' }); }
}

function encerrarPatrulha() {
  const tj = estado.trilha;
  if (!tj) return;
  const perto = trechos().filter((t) => tj.pontos.some((p) => distanciaAteLinha(p, t.coords) <= PARAM.faixaTrilhaM * 2));
  const resultado = perto.map((t) => ({ t, cob: cobertura(t.coords, tj.pontos, PARAM.faixaTrilhaM) })).filter((x) => x.cob >= 0.05).sort((a, b) => b.cob - a.cob);
  const eq = equipeDoUsuario();
  for (const { t, cob } of resultado) {
    (estado.dados.inspecoesTrecho ||= []).push({ id: uid('it'), trechoId: t.id, tipo: 'PATRULHA', equipeId: eq?.id || null, inicio: tj.inicio, fim: new Date().toISOString(),
      cobertura: Math.round(cob * 1000) / 1000, km: Math.round(t.km * cob * 100) / 100, completa: false, checklist: {}, fotos: [], pontos: tj.pontos.length, por: estado.usuario.id });
  }
  const pontos = tj.pontos;
  estado.trilha = null;
  atualizarPainel();
  registrar('PATRULHA_ENCERRADA', 'patrulha', tj.id, { trechos: resultado.length, km: resultado.reduce((s, x) => s + x.t.km * x.cob, 0).toFixed(2) });
  const corpo = el('div', { class: 'ficha' },
    el('p', { text: resultado.length ? `Km patrulhado registrado em ${resultado.length} trecho(s). Patrulha não conta no KMI; os trechos com cobertura suficiente podem virar inspeção completa preenchendo checklist e foto.` : 'O trajeto não passou por trechos da rede.' }),
    el('ul', { class: 'lista' }, resultado.map(({ t, cob }) => el('li', { class: 'lista__item' },
      el('div', {}, el('strong', { text: t.id }), el('div', { class: 'pequeno muted', text: `${fmtPct(cob)} do trecho · ${(t.km * cob).toFixed(2)} km` })),
      cob * 100 >= PARAM.coberturaMinPct ? el('button', { type: 'button', class: 'btn btn--sec', text: 'Completar como inspeção', onclick: () => abrirConclusao({ trechoId: t.id, tipo: 'TERRESTRE', pontos, inicio: tj.inicio, origemPatrulha: tj.id }) }) : null))));
  abrirSheet('Patrulha encerrada', corpo, { tipo: 'form' });
  setTimeout(() => mapa.desenharTrilha([]), 4000);
}

// ---------- Simulação de patrulha (demo) ----------
export function simularPatrulha() {
  const ts = trechos();
  const alvo = ts.filter((t) => t.alimentador === ts[0].alimentador).slice(0, 2);
  if (!estado.trilha) iniciarPatrulha();
  let i = 0;
  const seq = () => { if (i < alvo.length) simularPercurso(alvo[i++].id, { aoTerminar: seq }); };
  seq();
}

/** Lista para o mapa: cores por situação. */
export const situacoesDosTrechos = () => trechos().map((t) => ({ t, s: situacaoTrecho(t) }));
