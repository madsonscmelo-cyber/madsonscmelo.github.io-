// Painel lateral (bottom sheet no celular): ficha do ativo, formulários de inspeção, defeito e execução.
// Diretrizes de usabilidade aplicadas (docs/especificacao §7):
//  Fitts   — ação principal única, larga, fixa no rodapé (zona do polegar); alvos ≥ 48 px.
//  Hick    — uma ação principal por tela; secundárias discretas; tipos de defeito agrupados por categoria.
//  Zeigarnik — inspeção iniciada vira rascunho persistido e aparece como "em andamento" até ser concluída.
//  Jakob   — bottom sheet, botão voltar do celular fecha o painel, ícones e termos usuais.
//  Gradiente de meta — assistente em 3 etapas com barra de progresso.
//  Von Restorff — só a ação principal é preenchida; severidade A é o único elemento animado.
//  Miller  — uma decisão por etapa; informações agrupadas em blocos de até 3–4 itens.
import { el, $, toast, fmtData, fmtMoeda, fmtNum, diasEntre, hojeISO, distanciaM } from './util.js';
import { estado, ativoPorId, equipeDoUsuario, nomeEquipe, nomeUsuario, salvarRascunho, removerRascunho, obterRascunho } from './store.js';
import {
  TIPOS_ATIVO, criterio, CONJUNTOS, tipoDefeito, tiposDefeitoPara, SEVERIDADES, STATUS_DEFEITO, CATEGORIAS,
  STATUS_ABERTOS, TIPOS_EQUIPE, scoreRisco, faixaRisco, estadoAtivo, podeTransicionar, equipesAptas, RAIO_VALIDACAO_M,
} from './dominio.js';
import { concluirInspecao, transicionar, atribuirInspecao, ErroRegra } from './acoes.js';
import { campoFotos, galeria } from './fotos.js';
import { logar } from './auditoria.js';

// ---------- Sheet (com integração ao botão "voltar" do celular) ----------
let atual = null; // { tipo: 'ativo'|'area'|'form', id }
export const sheetAtual = () => atual;

export function abrirSheet(titulo, corpo, contexto = { tipo: 'form' }, rodape = null) {
  atual = contexto;
  const s = $('#sheet');
  $('#sheet-titulo').textContent = titulo;
  $('#sheet-corpo').replaceChildren(corpo);
  const r = $('#sheet-rodape');
  r.replaceChildren(...(rodape ? [rodape] : []));
  r.hidden = !rodape;
  if (s.hidden && history.state?.sheet !== true) history.pushState({ sheet: true }, '');
  s.hidden = false;
  s.classList.add('sheet--aberto');
  $('#sheet-corpo').scrollTop = 0;
}

function fecharInterno() {
  atual = null;
  const s = $('#sheet');
  s.classList.remove('sheet--aberto');
  s.hidden = true;
  document.dispatchEvent(new CustomEvent('sheet-fechado'));
}
export function fecharSheet() {
  if ($('#sheet').hidden) return;
  if (history.state?.sheet === true) history.back(); // o popstate fecha
  else fecharInterno();
}
window.addEventListener('popstate', () => { if (!$('#sheet').hidden) fecharInterno(); });

const pode = (...perfis) => perfis.includes(estado.usuario.perfil);

function tratar(fn) {
  try { fn(); return true; } catch (e) {
    if (e instanceof ErroRegra) toast(e.message, { tipo: 'erro' });
    else { console.error(e); toast('Não foi possível concluir a ação. Tente novamente.', { tipo: 'erro' }); }
    return false;
  }
}

// ---------- Geovalidação (RF-INS-07) ----------
export function validarGeo(alvos) {
  const p = estado.posicao;
  if (!p) return { temPosicao: false, dentroDoRaio: false, distanciaM: null };
  const dist = Math.min(...alvos.map((a) => distanciaM(p.lat, p.lon, a.lat, a.lon)));
  return { temPosicao: true, dentroDoRaio: dist <= RAIO_VALIDACAO_M, distanciaM: Math.round(dist), simulada: !!p.simulada, lat: p.lat, lon: p.lon };
}

function blocoGeo(alvos, exigeJustificativa, { justificativa = '', aoMudar = () => {} } = {}) {
  const info = el('div', { class: 'geo' });
  const just = el('textarea', { class: 'campo__input', rows: 2, placeholder: 'Justificativa (obrigatória)', maxlength: 500 });
  just.value = justificativa;
  just.addEventListener('input', () => aoMudar(just.value));
  const wrapJust = el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Justificativa' }), just);
  const atualizar = () => {
    const g = validarGeo(alvos);
    info.className = `geo ${g.dentroDoRaio ? 'geo--ok' : 'geo--alerta'}`;
    info.textContent = !g.temPosicao
      ? '📍 Sem posição: ative o GPS ou simule a posição no mapa.'
      : g.dentroDoRaio
        ? `✓ Posição validada: ${g.distanciaM} m do ativo${g.simulada ? ' (simulada)' : ''}.`
        : `⚠ Você está a ${g.distanciaM} m do ativo (limite ${RAIO_VALIDACAO_M} m).`;
    wrapJust.hidden = g.dentroDoRaio && !exigeJustificativa;
    return g;
  };
  atualizar();
  const timer = setInterval(() => { if (!info.isConnected) clearInterval(timer); else atualizar(); }, 3000);
  return { elemento: el('div', { class: 'grupo' }, info, wrapJust), geo: atualizar, justificativa: () => just.value };
}

// ---------- Componentes ----------
function chip(texto, classe = '') { return el('span', { class: `chip ${classe}`, text: texto }); }

function linhaMeta(rotulo, valor) {
  return el('div', { class: 'meta__item' }, el('span', { class: 'meta__rotulo', text: rotulo }), el('span', { class: 'meta__valor', text: valor }));
}
const grupoMeta = (titulo, ...itens) => el('section', { class: 'meta-grupo' }, el('h3', { class: 'meta-grupo__tit', text: titulo }), el('div', { class: 'meta' }, ...itens));

function selectDe(opcoes, valor, attrs = {}) {
  const s = el('select', { class: 'campo__input', ...attrs });
  for (const [v, t] of opcoes) s.append(el('option', { value: v, text: t, selected: v === valor }));
  return s;
}

/** Hick + Miller: tipos de defeito agrupados por categoria (optgroup) em vez de uma lista longa e plana. */
function selectTiposDefeito(tipoAtivo, valor) {
  const s = el('select', { class: 'campo__input' });
  const preencher = (tipo) => {
    s.replaceChildren(...Object.entries(CATEGORIAS).map(([cat, nome]) => {
      const tipos = tiposDefeitoPara(tipo).filter((t) => t.categoria === cat);
      return tipos.length ? el('optgroup', { label: `${CATEGORIA_ICONE[cat]} ${nome}` }, tipos.map((t) => el('option', { value: t.id, text: t.nome, selected: t.id === valor }))) : null;
    }).filter(Boolean));
  };
  preencher(tipoAtivo);
  s.recarregar = preencher;
  return s;
}

function acaoComTexto(rotulo, placeholder, aoConfirmar) {
  const caixa = el('div', { class: 'acao-texto' });
  const btn = el('button', {
    type: 'button', class: 'btn btn--txt', text: rotulo, onclick: () => {
      const inp = el('input', { class: 'campo__input', placeholder, maxlength: 300, 'aria-label': placeholder });
      caixa.replaceChildren(inp, el('button', { type: 'button', class: 'btn btn--sec', text: 'Confirmar', onclick: () => aoConfirmar(inp.value) }),
        el('button', { type: 'button', class: 'btn btn--txt', text: 'Cancelar', onclick: () => caixa.replaceChildren(btn) }));
      inp.focus();
    },
  });
  caixa.append(btn);
  return caixa;
}

export function cartaoDefeito(f, { comAtivo = false, aoAbrirAtivo } = {}) {
  const d = estado.dados, a = ativoPorId(f.ativoId), td = tipoDefeito(f.tipoId);
  const sc = scoreRisco(f, a), fx = faixaRisco(sc.total);
  const idade = diasEntre(f.criadoEm, hojeISO());
  const card = el('article', { class: `card-def card-def--${fx.id}` });
  card.append(
    el('div', { class: 'card-def__topo' },
      el('span', { class: `score score--${fx.id}`, text: sc.total, title: `Risco ${fx.nome}` }),
      el('div', { class: 'card-def__tit' },
        el('strong', { text: td?.nome || f.tipoId }),
        el('span', { class: 'muted', text: `${comAtivo ? `${a?.codigo} · ${a?.alimentador} · ` : ''}Sev. ${f.severidade} · ${idade} dia(s)` })),
      chip(STATUS_DEFEITO[f.status], `chip--st-${f.status.toLowerCase()}`)),
  );
  if (f.descricao) card.append(el('p', { class: 'card-def__desc', text: f.descricao }));
  const info = [`Exige: ${td?.equipes.map((t) => TIPOS_EQUIPE[t]).join(' / ')}`];
  if (f.equipeId) info.push(`Programado: ${nomeEquipe(f.equipeId)}`);
  if (f.execucao) info.push(`Executado por ${nomeEquipe(f.execucao.equipeId)}${f.execucao.naHora ? ' (na hora)' : ''}`);
  card.append(el('div', { class: 'muted pequeno', text: info.join(' · ') }));

  const detalhes = el('details', { class: 'card-def__det' }, el('summary', { text: 'Detalhes: risco, fotos e histórico' }));
  detalhes.addEventListener('toggle', () => {
    if (!detalhes.open || detalhes.dataset.carregado) return;
    detalhes.dataset.carregado = '1';
    detalhes.append(
      el('div', { class: 'pequeno muted', text: `Risco ${sc.total}: severidade ${sc.partes.severidade} · clientes ${sc.partes.clientes} · DEC/FEC ${sc.partes.continuidade} · compensação ${sc.partes.compensacao} · reincidência ${sc.partes.reincidencia}` }),
      el('div', { class: 'pequeno', text: 'Identificação' }), galeria(f.fotos),
      ...(f.execucao ? [el('div', { class: 'pequeno', text: 'Execução' }), galeria(f.execucao.fotos)] : []),
      el('ol', { class: 'historico' }, f.historico.map((h) => el('li', { text: `${fmtData(h.em)} — ${STATUS_DEFEITO[h.status]} — ${nomeUsuario(h.por)}${h.obs ? ` (${h.obs})` : ''}` }))));
  });
  card.append(detalhes);

  // Von Restorff: uma única ação preenchida (o próximo passo do fluxo); o resto é texto.
  const acoes = el('div', { class: 'card-def__acoes' });
  const u = estado.usuario;
  const exec = (para, extra) => tratar(() => { transicionar(f, para, extra); toast(`Defeito: ${STATUS_DEFEITO[para]}`, { tipo: 'ok' }); });
  if (podeTransicionar(u, f, 'VALIDADO')) {
    const sev = selectDe(Object.entries(SEVERIDADES), f.severidade, { 'aria-label': 'Severidade' });
    acoes.append(sev, el('button', { type: 'button', class: 'btn', text: 'Validar', onclick: () => exec('VALIDADO', { severidade: sev.value }) }));
  }
  if (podeTransicionar(u, f, 'PROGRAMADO') && f.status !== 'EXECUTADO') {
    const aptas = equipesAptas(d, f);
    const sel = selectDe(aptas.map((e) => [e.id, `${e.nome}${e.disponivel ? '' : ' (indisponível)'}`]), f.equipeId || aptas.find((e) => e.disponivel)?.id, { 'aria-label': 'Equipe' });
    acoes.append(sel, el('button', { type: 'button', class: f.status === 'PROGRAMADO' ? 'btn btn--sec' : 'btn', text: f.status === 'PROGRAMADO' ? 'Reprogramar' : 'Programar', onclick: () => exec('PROGRAMADO', { equipeId: sel.value }) }));
  }
  if (podeTransicionar(u, f, 'EXECUTADO')) acoes.append(el('button', { type: 'button', class: 'btn', text: 'Registrar execução', onclick: () => abrirExecucao(f) }));
  if (podeTransicionar(u, f, 'VERIFICADO')) acoes.append(el('button', { type: 'button', class: 'btn btn--ok', text: 'Verificar e fechar', onclick: () => exec('VERIFICADO') }));
  if (podeTransicionar(u, f, 'REJEITADO')) acoes.append(acaoComTexto('Rejeitar', 'Motivo da rejeição', (j) => exec('REJEITADO', { justificativa: j })));
  if (f.status === 'EXECUTADO' && podeTransicionar(u, f, 'PROGRAMADO')) {
    const aptas = equipesAptas(d, f).map((e) => e.id);
    const retorno = [f.equipeId, f.execucao?.equipeId].find((x) => aptas.includes(x)) || aptas[0];
    acoes.append(acaoComTexto('Devolver', 'Motivo da devolução', (j) => exec('PROGRAMADO', { equipeId: retorno, justificativa: j })));
  }
  if (podeTransicionar(u, f, 'CANCELADO')) acoes.append(acaoComTexto('Cancelar', 'Justificativa do cancelamento', (j) => exec('CANCELADO', { justificativa: j })));
  if (comAtivo && aoAbrirAtivo && estado.usuario.perfil !== 'AUDITOR') acoes.append(el('button', { type: 'button', class: 'btn btn--txt', text: 'Ver no mapa', onclick: () => aoAbrirAtivo(a.id) }));
  if (acoes.childElementCount) card.append(acoes);
  return card;
}

// ---------- Ficha do ativo ----------
const chaveRascunho = (ativoIds, avulsa) => `${avulsa ? 'A' : 'P'}|${[...ativoIds].sort().join(',')}`;

export function abrirAtivo(id) {
  const d = estado.dados, a = ativoPorId(id);
  if (!a) return;
  const est = estadoAtivo(d, id);
  const cj = CONJUNTOS[a.conjunto];
  const eq = equipeDoUsuario();
  const pend = d.inspecoes.filter((i) => i.ativoId === id && i.status !== 'CONCLUIDA');
  const minhasExec = d.defeitos.filter((f) => f.ativoId === id && podeTransicionar(estado.usuario, f, 'EXECUTADO'));
  const rascunho = obterRascunho(chaveRascunho([id], false)) || obterRascunho(chaveRascunho([id], true));

  const corpo = el('div', { class: 'ficha' });
  corpo.append(
    el('div', { class: 'ficha__estado' }, chip(est.nome, `chip--${est.id}`), a.avulso ? chip('Fora do plano') : null,
      rascunho ? chip('📝 Inspeção em andamento', 'chip--rascunho') : null),
    // Miller: dois grupos de 3 informações.
    grupoMeta('Rede',
      linhaMeta('Alimentador', a.alimentador),
      linhaMeta('Conjunto', cj ? `${a.conjunto} · DEC ${cj.decApurado} / meta ${cj.decMeta}` : a.conjunto),
      linhaMeta('Critérios', a.criterios.length ? a.criterios.map((c) => criterio(c)?.nome).join(', ') : '—')),
    grupoMeta('Impacto',
      linhaMeta('UCs a jusante', fmtNum(a.ucs)),
      linhaMeta('Compensação 12m', fmtMoeda(a.comp12m)),
      linhaMeta('Falhas 12m', String(a.falhas12m))),
  );

  // Hick + Fitts: a ação principal é escolhida pelo contexto e vai para o rodapé; as demais ficam discretas.
  let principal;
  if (rascunho) principal = { texto: `Continuar inspeção (etapa ${rascunho.etapa + 1} de 3)`, fn: () => retomarRascunho(rascunho) };
  else if (pend.length && !(eq && eq.tipo !== 'INSPECAO' && !pend.some((i) => i.equipeId === eq.id))) principal = { texto: `Inspecionar agora (${pend.length})`, fn: () => abrirFormInspecao({ ativos: [a], inspecoes: pend }) };
  else if (minhasExec.length) principal = { texto: 'Registrar execução', fn: () => abrirExecucao(minhasExec[0]) };
  else principal = { texto: 'Registrar inspeção avulsa / defeito', fn: () => abrirFormInspecao({ ativos: [a], inspecoes: [], avulsa: true }) };

  const secundarias = el('div', { class: 'ficha__acoes' },
    el('a', { class: 'btn btn--sec', href: `https://www.google.com/maps/dir/?api=1&destination=${a.lat},${a.lon}`, target: '_blank', rel: 'noopener noreferrer', text: '🧭 Rota até aqui', onclick: () => logar({ categoria: 'LEITURA', acao: 'ROTA_ABERTA', entidade: 'ativo', entidadeId: a.id }) }));
  if (!principal.texto.startsWith('Registrar inspeção avulsa')) secundarias.append(el('button', { type: 'button', class: 'btn btn--txt', text: 'Inspeção avulsa / defeito', onclick: () => abrirFormInspecao({ ativos: [a], inspecoes: [], avulsa: true }) }));
  corpo.append(secundarias);

  if (pend.length) {
    corpo.append(el('h3', { text: 'Inspeções programadas' }));
    const lista = el('ul', { class: 'lista' });
    for (const i of pend) {
      const venc = i.prazo < hojeISO();
      const li = el('li', { class: 'lista__item' },
        el('div', {}, el('strong', { text: criterio(i.criterioId)?.nome || 'Avulsa' }),
          el('div', { class: `pequeno ${venc ? 'txt-alerta' : 'muted'}`, text: `Prazo ${fmtData(i.prazo)}${venc ? ' · VENCIDA' : ''} · ${i.equipeId ? nomeEquipe(i.equipeId) : 'sem equipe'}` })));
      if (pode('GESTOR', 'SUPERVISOR')) {
        const sel = selectDe([['', 'Sem equipe'], ...d.equipes.filter((e) => e.tipo === 'INSPECAO').map((e) => [e.id, e.nome])], i.equipeId || '', { 'aria-label': 'Equipe da inspeção' });
        sel.addEventListener('change', () => tratar(() => atribuirInspecao(i.id, sel.value)));
        li.append(sel);
      }
      lista.append(li);
    }
    corpo.append(lista);
  }

  const defs = d.defeitos.filter((f) => f.ativoId === id).sort((x, y) => (STATUS_ABERTOS.includes(y.status) - STATUS_ABERTOS.includes(x.status)) || y.criadoEm.localeCompare(x.criadoEm));
  corpo.append(el('h3', { text: `Defeitos (${defs.length})` }));
  if (!defs.length) corpo.append(el('p', { class: 'muted', text: 'Nenhum defeito registrado.' }));
  defs.forEach((f) => corpo.append(cartaoDefeito(f)));

  const hist = d.inspecoes.filter((i) => i.ativoId === id && i.status === 'CONCLUIDA').sort((x, y) => y.concluidaEm.localeCompare(x.concluidaEm)).slice(0, 5);
  if (hist.length) {
    corpo.append(el('details', { class: 'bloco-det' }, el('summary', { text: `Últimas inspeções (${hist.length})` }),
      el('ul', { class: 'lista' }, hist.map((i) => el('li', { class: 'lista__item pequeno', text: `${fmtData(i.concluidaEm)} · ${i.tipo === 'AVULSA' ? 'Avulsa' : criterio(i.criterioId)?.nome} · ${nomeEquipe(i.equipeId)} · ${i.resultado === 'COM_DEFEITO' ? 'com defeito' : 'sem anomalia'}${i.geo && !i.geo.dentroDoRaio ? ' · fora do raio' : ''}` })))));
  }
  const rodape = el('button', { type: 'button', class: 'btn btn--grande', text: principal.texto, onclick: principal.fn });
  abrirSheet(`${TIPOS_ATIVO[a.tipo]} ${a.codigo}`, corpo, { tipo: 'ativo', id }, rodape);
}

// ---------- Assistente de inspeção (3 etapas) ----------
const CHECKLIST = {
  POSTE: ['Poste/estrutura íntegro', 'Cruzeta e ferragens', 'Isoladores', 'Condutores e conexões', 'Vegetação afastada da rede', 'Aterramento e estai'],
  RELIGADOR: ['Estrutura e fixação', 'Isoladores e buchas', 'Conexões', 'Painel/sinalização', 'Vegetação afastada da rede'],
  TRAFO: ['Tanque sem vazamento de óleo', 'Buchas e para-raios', 'Conexões MT/BT', 'Aterramento', 'Sem sinais de sobrecarga/aquecimento'],
  CHAVE_FUSIVEL: ['Porta-fusível e elo adequado', 'Contatos sem oxidação', 'Isoladores', 'Fixação na cruzeta'],
};
const ETAPAS = ['Checklist', 'Defeitos', 'Evidência'];
const CATEGORIA_ICONE = { ESTRUTURAL: '🏗', VEGETACAO: '🌳', ELETRICO: '⚡', FAUNA: '🐦' };

export function retomarRascunho(r) {
  const ativos = r.ativoIds.map(ativoPorId).filter(Boolean);
  const inspecoes = estado.dados.inspecoes.filter((i) => r.inspecaoIds.includes(i.id) && i.status !== 'CONCLUIDA');
  if (!ativos.length || (!r.avulsa && !inspecoes.length)) { removerRascunho(r.chave); toast('Esta inspeção já foi concluída.', { tipo: 'aviso' }); return; }
  abrirFormInspecao({ ativos, inspecoes, avulsa: r.avulsa });
}

export function abrirFormInspecao({ ativos, inspecoes, avulsa = false }) {
  const eq = equipeDoUsuario();
  const chave = chaveRascunho(ativos.map((a) => a.id), avulsa);
  const salvo = obterRascunho(chave);
  const tipos = [...new Set(ativos.map((a) => a.tipo))];
  const r = salvo ? structuredClone(salvo) : {
    chave, ativoIds: ativos.map((a) => a.id), inspecaoIds: inspecoes.map((i) => i.id), avulsa, etapa: 0,
    respostas: {}, defeitos: [], fotos: [], justificativa: '', observacao: '',
    titulo: avulsa ? `Inspeção avulsa · ${ativos[0].codigo}` : ativos.length > 1 ? `Inspeção em lote · ${ativos.length} ativos` : `Inspeção · ${ativos[0].codigo}`,
  };
  for (const t of tipos) for (const item of CHECKLIST[t]) r.respostas[`${t}:${item}`] ||= 'C';
  const guardar = () => salvarRascunho(r);
  if (!salvo) guardar();
  else toast('Rascunho retomado de onde você parou.');

  const corpo = el('div', { class: 'form' });
  const progresso = el('ol', { class: 'passos', 'aria-label': 'Progresso da inspeção' });
  const barra = el('div', { class: 'passos__barra' }, el('span', { class: 'passos__preench' }));
  const etapaBox = el('div', { class: 'etapa' });
  const rodape = el('div', { class: 'rodape-acoes' });
  corpo.append(el('p', { class: 'muted pequeno', text: avulsa
    ? 'Inspeção avulsa: fora da programação do plano.'
    : `${inspecoes.length} inspeção(ões): ${[...new Set(inspecoes.map((i) => criterio(i.criterioId)?.nome))].join(', ')}` }), barra, progresso, etapaBox);

  const qtdNC = () => Object.values(r.respostas).filter((v) => v === 'NC').length;
  let geo = null;

  function desenhar() {
    progresso.replaceChildren(...ETAPAS.map((n, i) => el('li', { class: `passo ${i < r.etapa ? 'passo--feito' : i === r.etapa ? 'passo--atual' : ''}`, 'aria-current': i === r.etapa ? 'step' : null },
      el('span', { class: 'passo__num', text: i < r.etapa ? '✓' : String(i + 1) }), el('span', { text: n }))));
    barra.firstChild.style.width = `${((r.etapa + 1) / ETAPAS.length) * 100}%`;
    etapaBox.replaceChildren([etapaChecklist, etapaDefeitos, etapaEvidencia][r.etapa]());
    const voltar = r.etapa > 0 ? el('button', { type: 'button', class: 'btn btn--sec', text: '← Voltar', onclick: () => { r.etapa--; guardar(); desenhar(); } }) : null;
    const ultimo = r.etapa === ETAPAS.length - 1;
    const avancar = el('button', { type: 'button', class: 'btn btn--grande', text: ultimo ? 'Concluir inspeção ✓' : `Próximo: ${ETAPAS[r.etapa + 1]} →`, onclick: ultimo ? concluir : proximo });
    rodape.replaceChildren(...[voltar, avancar].filter(Boolean));
    $('#sheet-corpo').scrollTop = 0;
  }

  function proximo() {
    if (r.etapa === 1 && qtdNC() && !r.defeitos.length) { toast(`Há ${qtdNC()} item(ns) não conforme(s): registre ao menos um defeito.`, { tipo: 'erro' }); return; }
    r.etapa++;
    guardar();
    desenhar();
  }

  function etapaChecklist() {
    const ck = el('fieldset', { class: 'checklist' }, el('legend', { text: ativos.length > 1 ? `Aplica-se aos ${ativos.length} ativos` : 'Marque o que não estiver conforme' }));
    for (const t of tipos) for (const item of CHECKLIST[t]) {
      const k = `${t}:${item}`;
      // Fitts + Jakob: botões segmentados grandes no lugar de um select pequeno.
      const grupo = el('div', { class: 'segmentado', role: 'radiogroup', 'aria-label': item });
      for (const [v, rot] of [['C', 'OK'], ['NC', 'Não conforme'], ['NA', 'N/A']]) {
        grupo.append(el('button', { type: 'button', role: 'radio', 'aria-checked': String(r.respostas[k] === v), class: `segmentado__op segmentado__op--${v.toLowerCase()}${r.respostas[k] === v ? ' ativo' : ''}`, text: rot,
          onclick: () => { r.respostas[k] = v; guardar(); etapaBox.replaceChildren(etapaChecklist()); } }));
      }
      ck.append(el('div', { class: 'checklist__item' }, el('span', { text: tipos.length > 1 ? `${TIPOS_ATIVO[t]}: ${item}` : item }), grupo));
    }
    return el('div', {}, ck, qtdNC() ? el('p', { class: 'geo geo--alerta', text: `${qtdNC()} não conformidade(s): na próxima etapa registre o defeito.` }) : null);
  }

  function etapaDefeitos() {
    const box = el('div', { class: 'grupo' });
    const lista = el('div', { class: 'def-lista' }, r.defeitos.map((f, i) => el('div', { class: 'def-chip' },
      el('span', { text: `${tipoDefeito(f.tipoId).nome} · Sev. ${f.severidade}${f.resolvido ? ' · resolvido na hora' : ''}${ativos.length > 1 ? ` · ${ativoPorId(f.ativoId).codigo}` : ''}` }),
      el('button', { type: 'button', class: 'btn btn--txt', text: 'remover', onclick: () => { r.defeitos.splice(i, 1); guardar(); etapaBox.replaceChildren(etapaDefeitos()); } }))));
    const area = el('div');
    const btnNovo = el('button', { type: 'button', class: 'btn btn--sec btn--largo', text: '＋ Adicionar defeito / manutenção', onclick: () => { btnNovo.hidden = true; area.replaceChildren(formNovoDefeito(() => { guardar(); etapaBox.replaceChildren(etapaDefeitos()); }, () => { area.replaceChildren(); btnNovo.hidden = false; })); } });
    box.append(
      el('p', { class: 'muted', text: r.defeitos.length ? `${r.defeitos.length} registrado(s).` : qtdNC() ? 'Registre o defeito das não conformidades.' : 'Nenhum defeito? Avance para a evidência.' }),
      lista, area, btnNovo);
    if (qtdNC() && !r.defeitos.length) btnNovo.click();
    return box;
  }

  function formNovoDefeito(aoAdicionar, aoCancelar) {
    const selAtivo = selectDe(ativos.map((a) => [a.id, `${TIPOS_ATIVO[a.tipo]} ${a.codigo}`]), ativos[0].id);
    const selTipo = selectTiposDefeito(ativos[0].tipo);
    const selSev = selectDe(Object.entries(SEVERIDADES), tipoDefeito(selTipo.value).severidade);
    const desc = el('textarea', { class: 'campo__input', rows: 2, maxlength: 500, placeholder: 'O quê, onde, extensão' });
    const resolvido = el('input', { type: 'checkbox' });
    const ativ = el('input', { class: 'campo__input', maxlength: 120 });
    const wrapRes = el('label', { class: 'campo campo--check' }, resolvido, el('span', { text: 'Resolvido na hora (manutenção feita nesta visita)' }));
    const wrapAtiv = el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Atividade realizada' }), ativ);
    const exige = el('div', { class: 'pequeno muted' });
    const fotos = campoFotos({ rotulo: () => `Defeito · ${ativoPorId(selAtivo.value).codigo}`, minimo: 1, titulo: 'Foto do defeito' });
    const sincronizar = () => {
      const td = tipoDefeito(selTipo.value);
      selSev.value = td.severidade;
      exige.textContent = `Equipe exigida: ${td.equipes.map((t) => TIPOS_EQUIPE[t]).join(' / ')}`;
      const podeResolver = !!eq && (td.resolveNaHora || td.equipes.includes(eq.tipo));
      wrapRes.hidden = !podeResolver;
      if (!podeResolver) resolvido.checked = false;
      ativ.value = td.atividade;
      wrapAtiv.hidden = !resolvido.checked;
    };
    selAtivo.addEventListener('change', () => { selTipo.recarregar(ativoPorId(selAtivo.value).tipo); sincronizar(); });
    selTipo.addEventListener('change', sincronizar);
    resolvido.addEventListener('change', () => { wrapAtiv.hidden = !resolvido.checked; });
    sincronizar();
    return el('div', { class: 'novo-def' },
      ativos.length > 1 ? el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Ativo' }), selAtivo) : null,
      el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Tipo de defeito' }), selTipo),
      exige,
      el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Severidade' }), selSev),
      fotos.elemento,
      el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Descrição' }), desc),
      wrapRes, wrapAtiv,
      el('div', { class: 'linha' },
        el('button', { type: 'button', class: 'btn', text: 'Adicionar defeito', onclick: () => {
          if (!fotos.suficiente()) { toast('Inclua ao menos uma foto do defeito.', { tipo: 'erro' }); return; }
          r.defeitos.push({ ativoId: selAtivo.value, tipoId: selTipo.value, severidade: selSev.value, descricao: desc.value.trim(), fotos: fotos.fotos(), resolvido: resolvido.checked, atividade: ativ.value.trim() });
          aoAdicionar();
        } }),
        el('button', { type: 'button', class: 'btn btn--txt', text: 'Cancelar', onclick: aoCancelar })));
  }

  function etapaEvidencia() {
    const fotosInsp = campoFotos({
      rotulo: () => (ativos.length > 1 ? `Inspeção em lote (${ativos.length})` : `Inspeção · ${ativos[0].codigo}`),
      minimo: 1, titulo: 'Foto geral da inspeção', iniciais: r.fotos, aoMudar: (l) => { r.fotos = l; guardar(); },
    });
    geo = blocoGeo(ativos, avulsa, { justificativa: r.justificativa, aoMudar: (v) => { r.justificativa = v; guardar(); } });
    const obs = el('textarea', { class: 'campo__input', rows: 2, maxlength: 500, placeholder: 'Opcional' });
    obs.value = r.observacao;
    obs.addEventListener('input', () => { r.observacao = obs.value; guardar(); });
    const resumo = `${Object.keys(r.respostas).length} itens verificados · ${qtdNC()} não conforme(s) · ${r.defeitos.length} defeito(s)`;
    return el('div', { class: 'grupo' },
      el('p', { class: 'resumo', text: resumo }),
      fotosInsp.elemento, geo.elemento,
      el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Observações' }), obs));
  }

  function concluir() {
    const ok = tratar(() => concluirInspecao({
      ativoIds: r.ativoIds, inspecaoIds: r.inspecaoIds, avulsa,
      checklist: r.respostas, fotos: r.fotos, geo: geo.geo(), justificativa: r.justificativa, observacao: r.observacao.trim(), defeitos: r.defeitos,
    }));
    if (ok) {
      removerRascunho(chave);
      toast(r.defeitos.length ? `Inspeção concluída com ${r.defeitos.length} defeito(s).` : 'Inspeção concluída sem anomalia.', { tipo: 'ok' });
      if (ativos.length === 1) abrirAtivo(ativos[0].id); else fecharSheet();
    }
  }

  abrirSheet(r.titulo, corpo, { tipo: 'form' }, rodape);
  desenhar();
}

// ---------- Execução do defeito ----------
export function abrirExecucao(f) {
  const a = ativoPorId(f.ativoId), td = tipoDefeito(f.tipoId);
  const corpo = el('div', { class: 'form' });
  const ativ = el('input', { class: 'campo__input', value: td.atividade, maxlength: 120 });
  const mat = el('textarea', { class: 'campo__input', rows: 2, maxlength: 300, placeholder: 'Ex.: 1 cruzeta 2,4 m, 2 isoladores pino' });
  const fotos = campoFotos({ rotulo: () => `Execução · ${a.codigo}`, minimo: 1, titulo: 'Foto depois do serviço' });
  const geo = blocoGeo([a], false);
  corpo.append(
    el('p', { class: 'muted', text: `${td.nome} · Sev. ${f.severidade} · ${a.codigo}` }),
    el('details', { class: 'bloco-det' }, el('summary', { text: 'Ver foto de identificação (antes)' }), galeria(f.fotos)),
    fotos.elemento,
    el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Atividade realizada' }), ativ),
    el('label', { class: 'campo' }, el('span', { class: 'campo__rotulo', text: 'Materiais aplicados' }), mat),
    geo.elemento);
  const salvar = () => {
    const g = geo.geo();
    if (!g.dentroDoRaio && !geo.justificativa().trim()) { toast('Fora do raio: informe a justificativa.', { tipo: 'erro' }); return; }
    if (tratar(() => transicionar(f, 'EXECUTADO', { atividade: ativ.value.trim(), materiais: mat.value.trim(), fotos: fotos.fotos(), geo: g, justificativa: g.dentroDoRaio ? undefined : geo.justificativa() }))) {
      toast('Execução registrada. Aguarda verificação do supervisor.', { tipo: 'ok' });
      abrirAtivo(a.id);
    }
  };
  abrirSheet(`Execução · ${a.codigo}`, corpo, { tipo: 'form' }, el('button', { type: 'button', class: 'btn btn--grande', text: 'Registrar execução ✓', onclick: salvar }));
}

// ---------- Seleção de área ----------
export function abrirArea(ativos, aoLimpar) {
  const d = estado.dados, eq = equipeDoUsuario();
  const ids = new Set(ativos.map((a) => a.id));
  let pend = d.inspecoes.filter((i) => ids.has(i.ativoId) && i.status !== 'CONCLUIDA');
  if (eq) pend = pend.filter((i) => i.equipeId === eq.id || (!i.equipeId && eq.tipo === 'INSPECAO'));
  const abertos = d.defeitos.filter((f) => ids.has(f.ativoId) && STATUS_ABERTOS.includes(f.status));
  const comPend = ativos.filter((a) => pend.some((i) => i.ativoId === a.id));
  const corpo = el('div', { class: 'ficha' },
    grupoMeta('Na área',
      linhaMeta('Ativos', String(ativos.length)),
      linhaMeta('Inspeções pendentes', String(pend.length)),
      linhaMeta('Defeitos abertos', String(abertos.length))),
    el('ul', { class: 'lista' }, comPend.map((a) => el('li', { class: 'lista__item pequeno' },
      el('button', { type: 'button', class: 'btn btn--txt', text: `${TIPOS_ATIVO[a.tipo]} ${a.codigo}`, onclick: () => { logar({ categoria: 'LEITURA', acao: 'ATIVO_CONSULTADO', entidade: 'ativo', entidadeId: a.id }); abrirAtivo(a.id); } }),
      el('span', { class: 'muted', text: pend.filter((i) => i.ativoId === a.id).map((i) => criterio(i.criterioId)?.nome).join(', ') })))),
    el('button', { type: 'button', class: 'btn btn--txt', text: 'Limpar seleção', onclick: () => { aoLimpar(); fecharSheet(); } }),
  );
  if (!comPend.length) corpo.append(el('p', { class: 'muted', text: 'Nenhuma inspeção pendente para você nesta área.' }));
  const rodape = comPend.length ? el('button', { type: 'button', class: 'btn btn--grande', text: `Inspecionar em lote (${pend.length})`, onclick: () => abrirFormInspecao({ ativos: comPend, inspecoes: pend }) }) : null;
  abrirSheet('Área selecionada', corpo, { tipo: 'area' }, rodape);
}
