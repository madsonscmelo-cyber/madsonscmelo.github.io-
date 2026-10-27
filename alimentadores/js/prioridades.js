// Tela Onde agir: a mesma pergunta aplicada a todos os alimentadores de uma vez, virando uma lista única de trechos
// (ou de chaves novas) ordenada por CHI ou por compensação. É a carteira de ações para o plano de manutenção e o PDI.
import { el, preencher, csvStringify, baixarArquivo, hojeISO, fmtNum } from './util.js';
import { estado } from './store.js';
import { PERGUNTAS, CAUSAS, CHAVES, TIPOS_ACAO, perguntaEfetiva, periodos, indexar, statsPostes, clusters, blocos, acaoSugerida } from './dominio.js';
import { fmt1, fmtChi, fmtR, codPoste } from './ui.js';
import { logar } from './auditoria.js';

export function telaPrioridades(raiz, ctx) {
  const f = (raiz.__f ||= { pergunta: 'podar', ordem: 'chi', conjunto: estado.usuario.conjunto || '' });
  const P = periodos(), per = P[estado.sel.periodo] || P.ATUAL;
  const q = perguntaEfetiva(PERGUNTAS.find((x) => x.id === f.pergunta), estado.rede);
  const als = estado.rede.alimentadores.filter((a) => !f.conjunto || a.conjunto === f.conjunto);
  const linhas = [];
  for (const al of als) {
    const idx = indexar(estado.rede, al.id), stats = statsPostes(idx, per);
    if (q.aba === 'blocos') {
      for (const b of blocos(idx, stats, per)) if (b.sugestao) linhas.push({ tipo: 'CHAVE', al, b, chi: b.sugestao.chiEvitado, comp: 0 });
    } else {
      for (const c of clusters(idx, stats, q)) linhas.push({ tipo: 'TRECHO', al, c, chi: c.chi, comp: c.comp });
    }
  }
  linhas.sort((a, b) => (f.ordem === 'comp' ? b.comp - a.comp || b.chi - a.chi : b.chi - a.chi));
  const totChi = linhas.reduce((s, x) => s + x.chi, 0), totComp = linhas.reduce((s, x) => s + x.comp, 0);
  const conjuntos = [...new Set(estado.rede.alimentadores.map((a) => a.conjunto))].sort();
  const re = () => telaPrioridades(raiz, ctx);
  const verNoMapa = (x) => {
    estado.sel.al = x.al.id;
    Object.assign(estado.sel, { camadas: [...q.camadas], modo: q.modo, causa: q.causa, chiMin: 0, pergunta: q.id, aba: q.aba });
    ctx.irPara('mapa', x.tipo === 'CHAVE' ? { poste: x.b.sugestao.poste.id, enquadrar: true } : { cluster: x.c.idCluster, enquadrar: true });
  };
  const exportar = el('button', { type: 'button', class: 'btn btn--sec', text: 'Exportar lista (CSV)', onclick: () => {
    logar({ categoria: 'EXPORTACAO', acao: 'PRIORIDADES_EXPORTADAS', detalhe: { pergunta: q.id, linhas: linhas.length } });
    baixarArquivo(`onde-agir-${q.id}-${hojeISO()}.csv`, csvStringify([
      ['rank', 'alimentador', 'conjunto', 'tipo', 'poste', 'postes', 'km', 'chi_ou_chi_evitado', 'compensacao', 'ocorrencias', 'causa_principal', 'acao', 'periodo'],
      ...linhas.map((x, i) => x.tipo === 'CHAVE'
        ? [i + 1, x.al.id, x.al.conjunto, 'Nova chave', codPoste(x.b.sugestao.poste), x.b.membros.length, fmt1(x.b.km), Math.round(x.chi), 0, x.b.sugestao.ocorrencias, '', `Chave/religador no poste ${codPoste(x.b.sugestao.poste)} (bloco ${codPoste(x.b.cabeca)})`, per.rotulo]
        : [i + 1, x.al.id, x.al.conjunto, TIPOS_ACAO[acaoSugerida(x.c).tipo], codPoste(x.c.montante), x.c.ids.length, fmt1(x.c.km), Math.round(x.chi), Math.round(x.comp), x.c.n, CAUSAS[x.c.causaPrinc] || '', acaoSugerida(x.c).texto, per.rotulo])]));
  } });

  preencher(raiz,
    el('header', { class: 'tela__topo' }, el('div', {}, el('h1', { text: 'Onde agir' }), el('p', { class: 'muted pequeno', text: `Todos os alimentadores${f.conjunto ? ` do ${f.conjunto}` : ''} · ${per.rotulo} (mude o período no Mapa)` })), exportar),
    el('div', { class: 'perguntas', role: 'group', 'aria-label': 'Pergunta' }, PERGUNTAS.map((x) => el('button', { type: 'button', class: `chip chip--btn chip--pergunta${x.id === f.pergunta ? ' ativo' : ''}`, 'aria-pressed': String(x.id === f.pergunta), text: x.texto,
      onclick: () => { f.pergunta = x.id; logar({ categoria: 'LEITURA', acao: 'PERGUNTA_CARTEIRA', detalhe: { pergunta: x.id } }); re(); } }))),
    el('p', { class: 'explica', text: q.explica }),
    el('div', { class: 'filtros' },
      el('select', { class: 'campo__input', 'aria-label': 'Conjunto', onchange: (e) => { f.conjunto = e.target.value; re(); } },
        el('option', { value: '', text: 'Todos os conjuntos' }), conjuntos.map((c) => el('option', { value: c, text: c, selected: c === f.conjunto }))),
      q.aba === 'blocos' ? null : el('select', { class: 'campo__input', 'aria-label': 'Ordenar por', onchange: (e) => { f.ordem = e.target.value; re(); } },
        el('option', { value: 'chi', text: 'Ordenar por CHI', selected: f.ordem === 'chi' }), el('option', { value: 'comp', text: 'Ordenar por compensação', selected: f.ordem === 'comp' }))),
    el('div', { class: 'kpis' },
      el('div', { class: 'kpi' }, el('span', { class: 'kpi__rotulo', text: q.aba === 'blocos' ? 'Chaves sugeridas' : 'Trechos' }), el('strong', { class: 'kpi__valor', text: String(linhas.length) })),
      el('div', { class: 'kpi' }, el('span', { class: 'kpi__rotulo', text: q.aba === 'blocos' ? 'CHI evitável (estimado)' : 'CHI nos trechos' }), el('strong', { class: 'kpi__valor', text: fmtChi(totChi) })),
      q.aba === 'blocos' ? null : el('div', { class: 'kpi' }, el('span', { class: 'kpi__rotulo', text: 'Compensação nos trechos' }), el('strong', { class: 'kpi__valor', text: fmtR(totComp) })),
      linhas.length ? el('div', { class: 'kpi' }, el('span', { class: 'kpi__rotulo', text: 'Top 10 concentra' }),
        el('strong', { class: 'kpi__valor', text: `${Math.round((linhas.slice(0, 10).reduce((s, x) => s + x.chi, 0) / (totChi || 1)) * 100)}%` }), el('span', { class: 'kpi__det', text: 'do CHI da lista (Pareto)' })) : null),
    linhas.length ? el('div', { class: 'tabela-wrap' }, el('table', { class: 'tabela' },
      el('thead', {}, el('tr', {}, ['#', 'Alimentador', 'Onde', q.aba === 'blocos' ? 'CHI evitado' : 'CHI', 'Compensação', 'Ação sugerida', ''].map((t) => el('th', { text: t })))),
      el('tbody', {}, linhas.slice(0, 150).map((x, i) => {
        const a = x.tipo === 'CHAVE' ? { tipo: 'CHAVE', texto: `${x.b.pctAcesso > 0.3 ? 'Chave telecomandada' : 'Chave/religador'} no poste ${codPoste(x.b.sugestao.poste)}. Bloco de ${CHAVES[x.b.cabeca.chave] || 'início'} ${codPoste(x.b.cabeca)} com ${x.b.n} ocorrências.` } : acaoSugerida(x.c);
        return el('tr', { class: i < 10 ? 'tr--top' : '' },
          el('td', { class: 'num', text: String(i + 1) }),
          el('td', {}, el('strong', { text: x.al.id }), el('div', { class: 'muted pequeno', text: x.al.conjunto })),
          el('td', { text: x.tipo === 'CHAVE' ? `Poste ${codPoste(x.b.sugestao.poste)} · ${fmtNum(x.b.sugestao.ucsJusante)} UCs a jusante` : `Poste ${codPoste(x.c.montante)} · ${x.c.ids.length} postes · ${fmt1(x.c.km)} km · ${x.c.n} ocorr.` }),
          el('td', { class: 'num', text: fmtChi(x.chi) }), el('td', { class: 'num', text: x.tipo === 'CHAVE' ? '—' : fmtR(x.comp) }),
          el('td', {}, el('span', { class: `etq etq--acao-${a.tipo.toLowerCase()}`, text: TIPOS_ACAO[a.tipo] }), el('div', { class: 'pequeno', text: a.texto })),
          el('td', {}, el('button', { type: 'button', class: 'btn btn--mini', text: 'Ver no mapa', 'aria-label': `Ver no mapa: item ${i + 1}, ${x.al.id}`, onclick: () => verNoMapa(x) })));
      })))) : el('p', { class: 'vazio', text: 'Nada atende a esta pergunta no período.' }),
    linhas.length > 150 ? el('p', { class: 'muted pequeno', text: `Mostrando 150 de ${linhas.length}. A exportação traz todos.` }) : null);
}
