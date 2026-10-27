// Tela Alimentadores: a carteira inteira no período atual contra o mesmo período do ano anterior,
// a matriz CHI × compensação (onde está o dinheiro e onde está o cliente) e o ranking que abre o mapa.
import { el, preencher, svgEl, fmtNum, csvStringify, baixarArquivo, hojeISO } from './util.js';
import { estado } from './store.js';
import { carteira, periodos } from './dominio.js';
import { kpi, delta, fmt1, fmt2, fmtChi, fmtR, barra } from './ui.js';
import { logar } from './auditoria.js';

const ORDENS = { chi: 'CHI', comp: 'Compensação', dec: 'DEC', dChi: 'Piora do CHI', reinc: 'Reincidentes' };

export function telaCarteira(raiz, ctx) {
  const P = periodos();
  const todos = carteira(estado.rede);
  const conjuntos = [...new Set(todos.map((x) => x.al.conjunto))].sort();
  const filtro = (raiz.__filtro ||= { conjunto: estado.usuario.conjunto || '', ordem: 'chi' });
  const lista = todos.filter((x) => !filtro.conjunto || x.al.conjunto === filtro.conjunto);
  const chave = { chi: (x) => x.atual.chi, comp: (x) => x.atual.comp, dec: (x) => x.atual.dec, dChi: (x) => x.dChi ?? -Infinity, reinc: (x) => x.atual.reincidentes }[filtro.ordem];
  lista.sort((a, b) => chave(b) - chave(a));

  const soma = (k, per) => lista.reduce((s, x) => s + x[per][k], 0);
  const ucs = lista.reduce((s, x) => s + x.atual.ucs, 0) || 1;
  const chiA = soma('chi', 'atual'), chiB = soma('chi', 'ant'), ciA = soma('ci', 'atual'), ciB = soma('ci', 'ant'), compA = soma('comp', 'atual'), compB = soma('comp', 'ant');
  const d = (a, b) => (b ? (a - b) / b : null);
  const abrir = (al) => { estado.sel.al = al; ctx.irPara('mapa'); };

  const selConj = el('select', { class: 'campo__input', 'aria-label': 'Conjunto', onchange: (e) => { filtro.conjunto = e.target.value; telaCarteira(raiz, ctx); } },
    el('option', { value: '', text: 'Todos os conjuntos' }), conjuntos.map((c) => el('option', { value: c, text: c, selected: c === filtro.conjunto })));
  const selOrdem = el('select', { class: 'campo__input', 'aria-label': 'Ordenar por', onchange: (e) => { filtro.ordem = e.target.value; telaCarteira(raiz, ctx); } },
    Object.entries(ORDENS).map(([k, v]) => el('option', { value: k, text: `Ordenar: ${v}`, selected: k === filtro.ordem })));
  const exportar = el('button', { type: 'button', class: 'btn btn--sec', text: 'Exportar (CSV)', onclick: () => {
    logar({ categoria: 'EXPORTACAO', acao: 'CARTEIRA_EXPORTADA', detalhe: { alimentadores: lista.length } });
    baixarArquivo(`carteira-alimentadores-${hojeISO()}.csv`, csvStringify([
      ['alimentador', 'nome', 'conjunto', 'tipo', 'ucs', 'km', `dec_${P.ATUAL.curto}`, `dec_${P.ANTERIOR_MP.curto}`, `fec_${P.ATUAL.curto}`, `chi_${P.ATUAL.curto}`, `chi_${P.ANTERIOR_MP.curto}`, `comp_${P.ATUAL.curto}`, `comp_${P.ANTERIOR_MP.curto}`, `comp_${P.ANTERIOR.curto}`, 'postes_reincidentes', 'pct_postes_arvore', 'pct_postes_acesso_dificil', 'chaves'],
      ...lista.map((x) => [x.al.id, x.al.nome, x.al.conjunto, x.al.tipo, x.atual.ucs, fmt2(x.atual.km), fmt2(x.atual.dec), fmt2(x.ant.dec), fmt2(x.atual.fec), Math.round(x.atual.chi), Math.round(x.ant.chi),
        Math.round(x.atual.comp), Math.round(x.ant.comp), Math.round(x.ano.comp), x.atual.reincidentes, Math.round(x.atual.pctVeg * 100), Math.round(x.atual.pctAcesso * 100), x.atual.chaves])]));
  } });

  preencher(raiz,
    el('header', { class: 'tela__topo' }, el('div', {}, el('h1', { text: 'Alimentadores' }),
      el('p', { class: 'muted pequeno', text: `${P.ATUAL.rotulo} × ${P.ANTERIOR_MP.rotulo} · base ${estado.rede.origem === 'IMPORTADA' ? 'importada neste aparelho' : 'sintética de demonstração'}` })),
    el('div', { class: 'linha' }, selConj, selOrdem, exportar)),
    el('div', { class: 'kpis' },
      kpi('DEC', `${fmt2(chiA / ucs)} h`, `${P.ANTERIOR_MP.curto}: ${fmt2(chiB / ucs)} h`, delta(d(chiA, chiB))),
      kpi('FEC', fmt2(ciA / ucs), `${P.ANTERIOR_MP.curto}: ${fmt2(ciB / ucs)}`, delta(d(ciA, ciB))),
      kpi('CHI', fmtChi(chiA), `${P.ANTERIOR_MP.curto}: ${fmtChi(chiB)}`, delta(d(chiA, chiB))),
      kpi('Compensação', fmtR(compA), `${P.ANTERIOR_MP.curto}: ${fmtR(compB)}`, delta(d(compA, compB)))),
    el('section', { class: 'bloco' },
      el('h2', { text: 'Matriz CHI × compensação' }),
      el('p', { class: 'muted pequeno', text: 'Cada círculo é um alimentador (tamanho = UCs). Acima da linha horizontal: paga mais compensação que a mediana; à direita da vertical: gera mais CHI que a mediana. O quadrante de cima à direita é a prioridade 1. Toque para abrir o mapa.' }),
      matriz(lista, abrir)),
    el('section', { class: 'bloco' },
      el('h2', { text: 'Ranking' }),
      el('div', { class: 'tabela-wrap' }, el('table', { class: 'tabela' },
        el('thead', {}, el('tr', {}, ['Alimentador', 'DEC (h)', 'CHI', 'Compensação', 'Reinc.', 'Árvore', 'Acesso difícil', 'Chaves', ''].map((t) => el('th', { text: t })))),
        el('tbody', {}, lista.map((x) => el('tr', {},
          el('td', {}, el('strong', { text: x.al.id }), el('div', { class: 'muted pequeno', text: `${x.al.nome} · ${x.al.conjunto} · ${x.al.tipo}` })),
          el('td', { class: 'num' }, fmt2(x.atual.dec), el('br'), delta(x.dDec)),
          el('td', { class: 'num' }, fmtChi(x.atual.chi), el('br'), delta(x.dChi)),
          el('td', { class: 'num' }, fmtR(x.atual.comp), el('br'), delta(x.dComp)),
          el('td', { class: 'num', text: String(x.atual.reincidentes) }),
          el('td', {}, el('div', { class: 'mini-barra' }, barra(x.atual.pctVeg, 'ok'), el('span', { text: `${Math.round(x.atual.pctVeg * 100)}%` }))),
          el('td', {}, el('div', { class: 'mini-barra' }, barra(x.atual.pctAcesso, 'alerta'), el('span', { text: `${Math.round(x.atual.pctAcesso * 100)}%` }))),
          el('td', { class: 'num', text: `${x.atual.chaves} · ${fmt1(x.atual.chaves / (x.atual.km || 1))}/km` }),
          el('td', {}, el('button', { type: 'button', class: 'btn btn--mini', text: 'Abrir mapa', 'aria-label': `Abrir mapa do ${x.al.id}`, onclick: () => abrir(x.al.id) }))))))),
      el('p', { class: 'muted pequeno', text: `Δ contra ${P.ANTERIOR_MP.rotulo}. Árvore e acesso: % dos postes marcados no levantamento. Reinc.: postes que originaram 2 ou mais ocorrências no período.` })));
}

/** Dispersão em SVG (sem biblioteca): eixo x = CHI, y = compensação, área = UCs; medianas dividem os quadrantes. */
function matriz(lista, abrir) {
  if (!lista.length) return el('p', { class: 'vazio', text: 'Sem alimentadores.' });
  const W = 640, H = 340, m = { e: 56, d: 16, t: 14, b: 40 };
  const xs = lista.map((x) => x.atual.chi), ys = lista.map((x) => x.atual.comp);
  const mx = Math.max(1, ...xs) * 1.08, my = Math.max(1, ...ys) * 1.12;
  // Escala raiz quadrada nos dois eixos: um alimentador muito fora da curva não espreme os outros no canto.
  const X = (v) => m.e + Math.sqrt(v / mx) * (W - m.e - m.d), Y = (v) => H - m.b - Math.sqrt(v / my) * (H - m.t - m.b);
  const mediana = (v) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const umax = Math.max(1, ...lista.map((x) => x.atual.ucs));
  const g = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'grafico matriz', role: 'group', 'aria-label': 'Matriz CHI por compensação dos alimentadores' },
    svgEl('rect', { x: X(mediana(xs)), y: m.t, width: W - m.d - X(mediana(xs)), height: Y(mediana(ys)) - m.t, class: 'matriz__q1' }),
    svgEl('line', { x1: X(mediana(xs)), x2: X(mediana(xs)), y1: m.t, y2: H - m.b, class: 'grafico__grade' }),
    svgEl('line', { x1: m.e, x2: W - m.d, y1: Y(mediana(ys)), y2: Y(mediana(ys)), class: 'grafico__grade' }),
    svgEl('line', { x1: m.e, x2: W - m.d, y1: H - m.b, y2: H - m.b, class: 'grafico__eixo-linha' }),
    svgEl('line', { x1: m.e, x2: m.e, y1: m.t, y2: H - m.b, class: 'grafico__eixo-linha' }),
    svgEl('text', { x: W - m.d, y: H - 8, 'text-anchor': 'end', class: 'grafico__eixo' }, 'CHI → (escala raiz)'),
    svgEl('text', { x: 8, y: m.t + 10, class: 'grafico__eixo' }, 'R$ ↑'),
    svgEl('text', { x: X(mediana(xs)) + 6, y: m.t + 14, class: 'grafico__eixo matriz__rotulo' }, 'Prioridade 1'),
    lista.map((x) => {
      const r = 8 + 16 * Math.sqrt(x.atual.ucs / umax);
      const nome = `${x.al.id}: CHI ${fmtChi(x.atual.chi)}, compensação ${fmtR(x.atual.comp)}, ${fmtNum(x.atual.ucs)} UCs. Abrir mapa`;
      const grupo = svgEl('g', { class: `matriz__pt ${x.dChi > 0.05 ? 'matriz__pt--piorou' : ''}`, tabindex: 0, role: 'button', 'aria-label': nome },
        svgEl('title', {}, nome),
        svgEl('circle', { cx: X(x.atual.chi), cy: Y(x.atual.comp), r }),
        svgEl('text', { x: X(x.atual.chi), y: Y(x.atual.comp) - r - 4, 'text-anchor': 'middle', class: 'matriz__txt' }, x.al.id));
      grupo.addEventListener('click', () => abrir(x.al.id));
      grupo.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(x.al.id); } });
      return grupo;
    }));
  return el('div', { class: 'matriz-wrap' }, g, el('p', { class: 'legenda-inline' },
    el('span', { class: 'leg leg--normal', text: 'estável ou melhor' }), el('span', { class: 'leg leg--piorou', text: 'CHI piorou mais de 5%' })));
}
