// Tela Dados: qual base está carregada, importação da base real (CSV lido e validado no aparelho), modelos e parâmetros.
import { el, preencher, toast, fmtNum, fmtDataHora } from './util.js';
import { estado, substituirRede, restaurarRedeSintetica } from './store.js';
import { PARAMS, PERFIS } from './dominio.js';
import { montarBase, LIMITES } from './importar.js';
import { logar } from './auditoria.js';
import { sincronizarBasePublica } from './publica.js';
import { seletorUTD } from './carteira.js';

const PODE_IMPORTAR = ['GESTOR', 'ANALISTA'];
let ultimoRelatorio = null;

/** Permissão checada no comando (não só no botão): perfil sem permissão é recusado e registrado. */
export async function importar(arquivos) {
  if (!PODE_IMPORTAR.includes(estado.usuario?.perfil)) {
    logar({ categoria: 'SEGURANCA', acao: 'IMPORTACAO_NEGADA', resultado: 'NEGADO' });
    throw new Error('Seu perfil não importa base.');
  }
  const textos = {};
  for (const [k, f] of Object.entries(arquivos)) {
    if (!f) continue;
    if (f.size > LIMITES.bytes) throw new Error(`${f.name}: arquivo acima de ${LIMITES.bytes / 1048576} MB.`);
    if (!/\.(csv|txt)$/i.test(f.name)) throw new Error(`${f.name}: envie CSV (separado por ; ou ,).`);
    textos[k] = await f.text();
  }
  if (!textos.postes) throw new Error('A planilha de postes é obrigatória.');
  const { rede, rel } = montarBase(textos);
  ultimoRelatorio = rel;
  // O log guarda contagens, nunca o conteúdo da base.
  logar({ categoria: 'ESCRITA', acao: rede ? 'BASE_IMPORTADA' : 'IMPORTACAO_RECUSADA', resultado: rede ? 'OK' : 'INVALIDO',
    detalhe: { aceitas: rel.aceitas, recusadas: rel.recusadas, avisos: rel.avisos.length, alimentadores: rede?.alimentadores.length || 0, postes: rede?.postes.length || 0, ocorrencias: rede?.ocorrencias.length || 0 } });
  if (rede) await substituirRede(rede);
  return { rede, rel };
}

export function telaDados(raiz) {
  const r = estado.rede, pode = PODE_IMPORTAR.includes(estado.usuario.perfil);
  const datas = r.ocorrencias.map((o) => o.data).sort();
  const arq = (id, rotulo, ajuda, obrigatorio) => el('label', { class: 'campo' },
    el('span', { class: 'campo__rotulo', text: `${rotulo}${obrigatorio ? ' (obrigatório)' : ''}` }),
    el('input', { type: 'file', id, accept: '.csv,.txt,text/csv', class: 'campo__input' }),
    el('span', { class: 'muted pequeno', text: ajuda }));
  const msg = el('div', { role: 'status', class: 'import-status' });
  const botao = el('button', { type: 'submit', class: 'btn btn--grande', text: 'Validar e carregar' });
  const form = el('form', { class: 'form', novalidate: true },
    arq('arq-postes', 'Postes', 'alimentador; poste; poste_pai; latitude; longitude; arvore (S/N); acesso (S/N); acesso_motivo; chave (DJ/RL/CS/CF/NA); trafo; ucs; conjunto; comp_2025; comp_2026', true),
    arq('arq-ocorrencias', 'Ocorrências', 'data_hora; alimentador; poste (origem); causa; ucs; duracao_h (ou chi); dispositivo', false),
    arq('arq-compensacoes', 'Compensações por mês', 'alimentador; poste (do trafo); mes (AAAA-MM) ou ano; valor', false),
    msg, botao);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    botao.disabled = true;
    preencher(msg, el('p', { text: 'Lendo e validando no aparelho…' }));
    try {
      const pick = (id) => form.querySelector(`#${id}`).files[0] || null;
      const { rede } = await importar({ postes: pick('arq-postes'), ocorrencias: pick('arq-ocorrencias'), compensacoes: pick('arq-compensacoes') });
      toast(rede ? `Base carregada: ${rede.alimentadores.length} alimentador(es), ${fmtNum(rede.postes.length)} postes.` : 'Nada foi carregado. Veja o relatório.', { tipo: rede ? 'ok' : 'erro' });
      telaDados(raiz);
    } catch (e) {
      preencher(msg, el('p', { class: 'txt-alerta', text: e.message || 'Falha ao ler os arquivos.' }));
      logar({ categoria: 'VALIDACAO', acao: 'IMPORTACAO_FALHOU', resultado: 'ERRO', detalhe: { mensagem: e.message } });
    } finally { botao.disabled = false; }
  });

  preencher(raiz,
    el('header', { class: 'tela__topo' }, el('h1', { text: 'Dados' })),
    el('section', { class: `bloco ${r.origem === 'SINTETICA' ? 'bloco--aviso' : 'bloco--ok'}` },
      el('h2', { text: r.origem === 'PUBLICA' ? `Base publicada: ${r.titulo} · UTD ${r.utdNome}` : r.origem === 'IMPORTADA' ? 'Base importada neste aparelho' : 'Base sintética de demonstração' }),
      el('p', { text: `${r.alimentadores.length} alimentadores · ${fmtNum(r.postes.length)} postes · ${fmtNum(r.ocorrencias.length)} ocorrências · ${fmtNum(r.compensacoes.length)} lançamentos de compensação${datas.length ? ` · ocorrências de ${datas[0].slice(0, 10)} a ${datas.at(-1).slice(0, 10)}` : ''}` }),
      r.origem === 'PUBLICA' ? el('p', { class: 'muted pequeno', text: `Baixada do site ao abrir o app e conferida pelo SHA-256 de cada arquivo (${fmtNum(r.rel?.aceitas || 0)} linhas aceitas, ${fmtNum(r.rel?.recusadas || 0)} recusadas). Para ver outra UTD, escolha abaixo; cada UTD é baixada só quando pedida.` }) : null,
      estado.manifesto ? el('div', { class: 'linha' }, seletorUTD()) : null,
      r.origem === 'PUBLICA' && r.rel?.avisos?.length ? el('ul', { class: 'lista pequeno' }, r.rel.avisos.map((a) => el('li', { class: 'lista__item', text: `⚠ ${a}` }))) : null,
      el('p', { class: 'muted pequeno', text: r.origem === 'PUBLICA' ? '' : r.origem === 'IMPORTADA' ? `Carregada em ${fmtDataHora(r.geradaEm)}. Fica só no IndexedDB deste navegador: não vai para o GitHub, não vai para servidor. Quem usa este aparelho com outra matrícula enxerga a mesma base.` : 'Alimentadores, postes, ocorrências e valores fictícios. Não representam nenhuma rede real.' }),
      r.origem === 'IMPORTADA' && pode ? el('button', { type: 'button', class: 'btn btn--perigo', text: 'Apagar base importada deste aparelho', onclick: async () => {
        if (!confirm('Apagar a base importada deste aparelho? O app volta para a base publicada (ou para a demonstração, se não houver).')) return;
        await restaurarRedeSintetica();
        sincronizarBasePublica();
        logar({ categoria: 'ESCRITA', acao: 'BASE_IMPORTADA_APAGADA' });
        toast('Base importada apagada.', { tipo: 'ok' });
        telaDados(raiz);
      } }) : null),
    pode ? el('section', { class: 'bloco' },
      el('h2', { text: 'Importar a base real' }),
      el('p', { class: 'bloco bloco--aviso pequeno', text: 'Este endereço é público (GitHub Pages). Os arquivos são lidos aqui no navegador e não são enviados a lugar nenhum, mas use só em aparelho corporativo, com a tela bloqueada quando sair, e apague a base ao terminar. Não salve CSV da rede no repositório.' }),
      el('p', { class: 'pequeno' }, 'Modelos: ',
        el('a', { href: 'modelos/postes.csv', download: '', text: 'postes.csv' }), ' · ',
        el('a', { href: 'modelos/ocorrencias.csv', download: '', text: 'ocorrencias.csv' }), ' · ',
        el('a', { href: 'modelos/compensacoes.csv', download: '', text: 'compensacoes.csv' }),
        '. Os nomes de coluna aceitam variações (ex.: lat/latitude, vegetacao/arvore) e números com vírgula.'),
      form) : el('p', { class: 'muted', text: `Importação de base: só ${PODE_IMPORTAR.map((p) => PERFIS[p]).join(' e ')}.` }),
    ultimoRelatorio ? relatorio(ultimoRelatorio) : null,
    el('section', { class: 'bloco' },
      el('h2', { text: 'Parâmetros dos cálculos' }),
      el('div', { class: 'tabela-wrap' }, el('table', { class: 'tabela' },
        el('thead', {}, el('tr', {}, el('th', { text: 'Parâmetro' }), el('th', { text: 'Valor' }))),
        el('tbody', {},
          el('tr', {}, el('td', { text: 'Poste reincidente: ocorrências originadas no período' }), el('td', { class: 'num', text: `≥ ${PARAMS.reincidenciaMin}` })),
          el('tr', {}, el('td', { text: 'CHI alto: percentil do CHI dos postes com falha no alimentador' }), el('td', { class: 'num', text: `P${Math.round(PARAMS.chiAltoPercentil * 100)}` })),
          el('tr', {}, el('td', { text: 'Trecho mínimo (postes)' }), el('td', { class: 'num', text: String(PARAMS.clusterMinPostes) })),
          el('tr', {}, el('td', { text: 'Compensação na base sintética: limite de DIC mensal urbano / rural' }), el('td', { class: 'num', text: `${PARAMS.dicLimiteMesUrbano} h / ${PARAMS.dicLimiteMesRural} h` }))))),
      el('p', { class: 'muted pequeno', text: 'Na base importada, a compensação é a que vier no arquivo (não é estimada). Chave sugerida: CHI evitado = Σ ocorrências a jusante × (UCs que caíram − UCs a jusante da chave nova) × duração.' })));
}

function relatorio(rel) {
  return el('section', { class: 'bloco', 'aria-live': 'polite' },
    el('h2', { text: 'Relatório da última importação' }),
    el('p', { text: `${fmtNum(rel.aceitas)} linha(s) aceitas · ${fmtNum(rel.recusadas)} recusada(s)` }),
    rel.avisos.length ? el('ul', { class: 'lista' }, rel.avisos.map((a) => el('li', { class: 'lista__item', text: `⚠ ${a}` }))) : null,
    rel.recusas.length ? el('div', { class: 'tabela-wrap' }, el('table', { class: 'tabela' },
      el('thead', {}, el('tr', {}, ['Arquivo', 'Linha', 'Motivo'].map((t) => el('th', { text: t })))),
      el('tbody', {}, rel.recusas.map((x) => el('tr', {}, el('td', { text: x.arquivo }), el('td', { class: 'num', text: String(x.linha) }), el('td', { text: x.motivo })))))) : null,
    rel.recusadas > rel.recusas.length ? el('p', { class: 'muted pequeno', text: `Mostrando as primeiras ${rel.recusas.length} recusas.` }) : null);
}
