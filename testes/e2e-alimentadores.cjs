// Raio-X de Alimentadores — teste ponta a ponta + checklist de usabilidade/segurança executável.
// Uso: cd testes && npm install && npx playwright install chromium && npm run e2e:alimentadores
// As regras são provadas chamando os módulos direto no navegador com o perfil mais fraco (checklist 6.9), não só pelo botão.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { iniciar } = require('./servidor.cjs');

const RAIZ = path.resolve(__dirname, '..');
const SAIDA = path.join(__dirname, 'saida', 'alimentadores');
fs.mkdirSync(SAIDA, { recursive: true });
let AXE = null;
try { AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'); } catch { /* axe-core opcional */ }

const resultados = [];
function registrar(id, nome, passou, evidencia) {
  resultados.push({ id, nome, passou, evidencia });
  console.log(`${passou ? '✅' : '⚠️ '} ${id} ${nome} — ${evidencia}`);
}

const SENHA_INICIAL = 'Rede@Raiox2026', SENHA_NOVA = 'Turno#Azul2026x';

(async () => {
  const srv = await iniciar(RAIZ);
  const BASE = `http://127.0.0.1:${srv.address().port}/alimentadores/`;
  const browser = await chromium.launch();
  const erros = [], externos = [];
  const vigiar = (p) => {
    p.on('console', (m) => { if (m.type() === 'error' && !/net::ERR|Failed to load resource/.test(m.text())) erros.push(m.text()); });
    p.on('pageerror', (e) => erros.push(e.message));
    p.on('dialog', (d) => d.accept());
    p.on('request', (r) => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname) && !u.protocol.startsWith('data') && !u.protocol.startsWith('blob')) externos.push(u.hostname); });
  };
  const mod = (p, fn, arg) => p.evaluate(fn, arg);
  const sair = async (p) => { await p.click('#btn-usuario'); await p.click('.menu__item:has-text("Sair")'); await p.waitForSelector('#login input[autocomplete=username]'); };
  const entrar = async (p, mat) => {
    await p.waitForFunction(() => !document.querySelector('#login').hidden || document.querySelector('#nav').childElementCount > 0, null, { timeout: 20000 });
    if (await p.locator('#login').isHidden()) await sair(p);
    p.__trocadas ||= new Set();
    await p.fill('#login input[autocomplete=username]', mat);
    await p.fill('#login input[autocomplete=current-password]', p.__trocadas.has(mat) ? SENHA_NOVA : SENHA_INICIAL);
    await p.click('#login button[type=submit]');
    await p.waitForFunction(() => document.querySelector('#login').hidden || document.querySelector('#login input[autocomplete=new-password]') || document.querySelector('.login__msg')?.textContent, null, { timeout: 15000 });
    if (await p.locator('#login input[autocomplete=new-password]').count()) {
      const [n1, n2] = await p.locator('#login input[autocomplete=new-password]').all();
      await n1.fill(SENHA_NOVA); await n2.fill(SENHA_NOVA);
      await p.click('#login button[type=submit]');
      await p.waitForFunction(() => document.querySelector('#login').hidden, null, { timeout: 15000 });
      p.__trocadas.add(mat);
    }
    await p.waitForTimeout(300);
  };
  const irPara = async (p, tela) => { await p.click(`#nav .nav__btn[data-view=${tela}]`); await p.waitForTimeout(350); };
  const fecharToasts = (p) => p.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  const acoesLog = (p) => mod(p, async () => { const { todosLogs } = await import('./js/auditoria.js'); return (await todosLogs()).map((r) => ({ acao: r.acao, resultado: r.resultado, detalhe: r.detalhe })); });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, serviceWorkers: 'block', acceptDownloads: true });
    await ctx.route(/tile\.openstreetmap\.org|arcgisonline\.com|opentopomap\.org/, (r) => r.abort()); // fundo de ruas não é necessário no teste
    const p = await ctx.newPage();
    vigiar(p);
    await p.goto(BASE);

    // ================= Acesso =================
    await p.waitForSelector('#login input[autocomplete=username]', { timeout: 20000 });
    await p.fill('#login input[autocomplete=username]', 'G4001');
    await p.fill('#login input[autocomplete=current-password]', 'senha-errada');
    await p.click('#login button[type=submit]');
    await p.waitForFunction(() => document.querySelector('.login__msg')?.textContent);
    const msgErro = await p.textContent('.login__msg');
    await p.fill('#login input[autocomplete=username]', 'X9999');
    await p.fill('#login input[autocomplete=current-password]', 'senha-errada');
    await p.click('#login button[type=submit]');
    await p.waitForTimeout(1200);
    const msgInexistente = await p.textContent('.login__msg');
    registrar('2.1', 'Mensagem única para senha errada e matrícula inexistente', msgErro === msgInexistente && /inválidas/.test(msgErro), msgErro);
    await entrar(p, 'G4001');
    registrar('2.2', 'Primeiro acesso obriga senha pessoal com política', p.__trocadas.has('G4001'), 'senha inicial trocada antes de entrar');

    // ================= Carteira =================
    const linhas = await p.locator('#view-carteira tbody tr').count();
    const kpis = await p.locator('#view-carteira .kpi').count();
    const pontos = await p.locator('#view-carteira .matriz__pt').count();
    registrar('F1', 'Carteira: 8 alimentadores, DEC/FEC/CHI/compensação × ano anterior e matriz CHI × R$', linhas === 8 && kpis === 4 && pontos === 8, `${linhas} linhas, ${kpis} KPIs, ${pontos} pontos na matriz`);
    await p.locator('#view-carteira .matriz__pt').first().focus();
    await p.keyboard.press('Enter');
    await p.waitForTimeout(500);
    registrar('F2', 'Matriz: ponto acessível por teclado abre o mapa do alimentador', !(await p.locator('#view-mapa').isHidden()), `alimentador: ${await p.inputValue('#sel-al')}`);

    // ================= Mapa: camadas, perguntas, trechos, árvore de manobra =================
    await p.selectOption('#sel-al', 'ALM-06');
    await p.waitForTimeout(400);
    await p.click('[data-foco="r-arvore"]');
    await p.waitForTimeout(300);
    const arvoreOn = await p.getAttribute('[data-foco="r-arvore"]', 'aria-pressed');
    const linhasArvore = await p.locator('#mapa path.cam-arvore').count();
    const focoFicou = await p.evaluate(() => document.activeElement?.dataset?.foco);
    registrar('F3', 'Camada árvore liga sozinha num toque (estado anunciado, trecho desenhado, foco preservado)', arvoreOn === 'true' && linhasArvore === 1 && focoFicou === 'r-arvore', `aria-pressed=${arvoreOn}, camada SVG=${linhasArvore}, foco=${focoFicou}`);
    await p.click('[data-foco="r-arvore"]');
    await p.click('[data-foco="r-acesso"]');
    await p.waitForTimeout(300);
    const soAcesso = (await p.locator('#mapa path.cam-acesso').count()) === 1 && (await p.locator('#mapa path.cam-arvore').count()) === 0;
    registrar('F4', 'Camada acesso sozinha (árvore desligada some do mapa)', soAcesso, 'só a camada de acesso desenhada');
    const perguntar = async (pg, texto) => { await pg.click('#ctrl-perguntas'); await pg.click(`#painel-perguntas .pergunta:has-text("${texto}")`); await pg.waitForTimeout(400); };
    await perguntar(p, 'Onde podar primeiro?');
    const painelAbriu = !(await p.locator('#sheet').isHidden());
    const nTrechos = await p.locator('.trechos .trecho').count();
    const nMarcadores = await p.locator('#mapa .mk-cluster').count();
    registrar('F5', 'Pergunta pronta "Onde podar primeiro?" forma trechos e abre os resultados no painel lateral', painelAbriu && nTrechos > 0 && nMarcadores === Math.min(nTrechos, 15), `${nTrechos} trechos, ${nMarcadores} marcadores numerados`);
    await p.locator('.trechos .trecho').first().click();
    await p.waitForSelector('#sheet:not([hidden])');
    const fichaTrecho = await p.textContent('#sheet-corpo');
    registrar('F6', 'Ficha do trecho: ação sugerida, CHI, compensação, % árvore e acesso, CHI por causa', /Poda/.test(fichaTrecho) && /CHI originado/.test(fichaTrecho) && /Vegetação/.test(fichaTrecho), fichaTrecho.slice(0, 90));
    const voltou = await p.locator('#sheet-rodape button:has-text("Resultados")').count();
    await p.click('#sheet-rodape button:has-text("Resultados")');
    registrar('F6b', 'Ficha tem "← Resultados" e volta para a lista', voltou === 1 && (await p.locator('.trechos .trecho').count()) === nTrechos, 'rodapé da ficha');
    await p.click('#sheet-fechar');
    await perguntar(p, 'Onde falta chave?');
    const nNos = await p.locator('.arvore-manobra .no').count();
    const nSug = await p.locator('#mapa .mk-sugestao').count();
    const nChaves = await p.locator('#mapa .mk-chave').count();
    registrar('F7', 'Árvore de manobra: blocos entre chaves, chaves no mapa e chave nova sugerida por CHI evitado', nNos > 3 && nSug > 0 && nChaves > 3, `${nNos} blocos, ${nChaves} chaves, ${nSug} sugestões ★`);
    // Regra da sugestão provada no módulo: CHI evitado = Σ ocorrências a jusante × (UCs que caíram − UCs a jusante da chave) × duração
    const regra = await mod(p, async () => {
      const D = await import('./js/dominio.js'); const { estado } = await import('./js/store.js');
      const P = D.periodos(), idx = D.indexar(estado.rede, 'ALM-06'), st = D.statsPostes(idx, P.ATUAL);
      const b = D.blocos(idx, st, P.ATUAL).find((x) => x.sugestao);
      const x = b.sugestao.poste.id;
      let esperado = 0;
      for (const id of b.membros) for (const o of idx.ocPorPoste.get(id) || []) if (D.noPeriodo(o.data, P.ATUAL) && idx.jusante(x, o.poste)) esperado += Math.max(0, o.ucs - idx.ucsSub.get(x)) * o.dur;
      return { calc: b.sugestao.chiEvitado, esperado };
    });
    registrar('F8', 'Cálculo do CHI evitado confere com a fórmula documentada', Math.abs(regra.calc - regra.esperado) < 0.01, `${regra.calc.toFixed(1)} = ${regra.esperado.toFixed(1)}`);
    // Combinação E × OU
    const eou = await mod(p, async () => {
      const D = await import('./js/dominio.js'); const { estado } = await import('./js/store.js');
      const P = D.periodos(), idx = D.indexar(estado.rede, 'ALM-06'), st = D.statsPostes(idx, P.DOZE);
      const n = (cfg) => idx.postes.filter(D.filtroPostes(idx, st, cfg)).length;
      return { e: n({ camadas: ['arvore', 'acesso'], modo: 'E' }), ou: n({ camadas: ['arvore', 'acesso'], modo: 'OU' }), arv: n({ camadas: ['arvore'] }), ac: n({ camadas: ['acesso'] }) };
    });
    registrar('F9', 'Filtro E/OU: árvore E acesso = interseção; OU = união', eou.ou === eou.arv + eou.ac - eou.e && eou.e <= Math.min(eou.arv, eou.ac), `E=${eou.e}, OU=${eou.ou}, árvore=${eou.arv}, acesso=${eou.ac}`);

    // Fundo do mapa e trechos coloridos pelo CHI
    await perguntar(p, 'Onde podar primeiro?');
    await p.click('#sheet-fechar');
    const niveis = await p.locator('#mapa path.cluster--alto').count();
    const pedidos = [];
    p.on('request', (r) => pedidos.push(r.url()));
    await p.click('#ctrl-mais');
    await p.click('.fundos [data-fundo="satelite"]'); await p.waitForTimeout(400);
    const sat = pedidos.some((u) => u.includes('arcgisonline.com')) && await p.locator('#mapa.mapa--satelite').count();
    await p.click('.fundos [data-fundo="terreno"]'); await p.waitForTimeout(400);
    const ter = pedidos.some((u) => u.includes('opentopomap.org'));
    pedidos.length = 0;
    await p.click('.fundos [data-fundo="nenhum"]'); await p.waitForTimeout(400);
    await p.mouse.move(700, 450); await p.mouse.wheel(0, -400); await p.waitForTimeout(400);
    const semFundo = !pedidos.some((u) => /openstreetmap|arcgisonline|opentopomap/.test(u)) && await p.locator('#mapa.mapa--leve').count();
    await p.click('.fundos [data-fundo="ruas"]');
    await p.click('#ctrl-mais');
    registrar('F12', 'Fundo do mapa: satélite e terreno carregam; "Sem fundo" não busca nada fora; trecho de maior CHI em vermelho', !!sat && ter && !!semFundo && niveis >= 1, `satélite=${!!sat}, terreno=${ter}, sem fundo sem rede=${!!semFundo}, trechos CHI alto=${niveis}`);

    // ================= Onde agir =================
    await irPara(p, 'prioridades');
    const nPrior = await p.locator('#view-prioridades tbody tr').count();
    await p.locator('#view-prioridades tbody tr').first().locator('button:has-text("Ver no mapa")').click();
    await p.waitForTimeout(600);
    const abriuFicha = !(await p.locator('#view-mapa').isHidden()) && !(await p.locator('#sheet').isHidden());
    registrar('F10', 'Onde agir: lista única de todos os alimentadores e "Ver no mapa" abre o trecho', nPrior > 0 && abriuFicha, `${nPrior} linhas; ficha aberta no mapa: ${abriuFicha}`);
    await p.click('#sheet-fechar');

    // ================= Exportação protegida =================
    await irPara(p, 'prioridades');
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#view-prioridades button:has-text("Exportar lista")')]);
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    registrar('4.8', 'Exportação CSV com BOM e separador ; (abre certo no Excel)', csv.startsWith('﻿') && csv.split('\n')[0].includes(';'), `${csv.split('\n').length - 1} linhas`);

    // ================= Importação da base real (no aparelho) =================
    await irPara(p, 'dados');
    await p.setInputFiles('#arq-postes', path.join(RAIZ, 'alimentadores/modelos/postes.csv'));
    await p.setInputFiles('#arq-ocorrencias', path.join(RAIZ, 'alimentadores/modelos/ocorrencias.csv'));
    await p.setInputFiles('#arq-compensacoes', path.join(RAIZ, 'alimentadores/modelos/compensacoes.csv'));
    await p.click('#view-dados button[type=submit]');
    await p.waitForFunction(() => /Base importada/.test(document.querySelector('#view-dados')?.textContent || ''), null, { timeout: 10000 });
    const base = await mod(p, async () => { const { estado } = await import('./js/store.js'); const r = estado.rede; return { origem: r.origem, al: r.alimentadores.map((a) => a.id), postes: r.postes.length, oc: r.ocorrencias.length, comp: r.compensacoes.length }; });
    registrar('F11', 'Importa os modelos CSV (postes, ocorrências, compensações) e troca a base', base.origem === 'IMPORTADA' && base.al.join() === 'ALM-90' && base.postes === 5 && base.oc === 2 && base.comp === 4, JSON.stringify(base));
    const logImp = (await acoesLog(p)).filter((r) => r.acao === 'BASE_IMPORTADA').at(-1);
    registrar('9.x', 'Log da importação guarda só contagens (nunca o conteúdo da base)', logImp && !JSON.stringify(logImp.detalhe).includes('P-00') && logImp.detalhe.postes === 5, JSON.stringify(logImp?.detalhe));
    registrar('9.y', 'Nenhum dado enviado para fora (só o servidor local e os tiles do fundo escolhido)', !externos.filter((h) => !/^(tile\.openstreetmap\.org|server\.arcgisonline\.com|[abc]\.tile\.opentopomap\.org)$/.test(h)).length, [...new Set(externos)].join(', ') || 'nenhum domínio externo');

    // Validação linha a linha + XSS + CSV injection
    const ruim = 'alimentador;poste;poste_pai;latitude;longitude;chave;nome_alimentador;ucs\n'
      + 'ALM-X;=HYPERLINK("http://x");;-15,80;-48,08;DJ;<img src=x onerror="window.__xss=1">Alim;10\n'
      + 'ALM-X;P2;=HYPERLINK("http://x");-15,801;-48,081;;;20\n'
      + 'ALM-X;P3;P2;99;-48,08;;;\n'
      + 'ALM-X;P4;P2;-15,802;-48,082;TURBINA;;\n'
      + 'ALM-X;P2;P3;-15,803;-48,083;;;\n';
    fs.writeFileSync(path.join(SAIDA, 'postes-com-erros.csv'), ruim);
    await p.setInputFiles('#arq-postes', path.join(SAIDA, 'postes-com-erros.csv'));
    await p.setInputFiles('#arq-ocorrencias', []);
    await p.setInputFiles('#arq-compensacoes', []);
    await p.click('#view-dados button[type=submit]');
    // Espera o relatório desta importação (o da anterior continua na tela até a nova terminar).
    await p.waitForFunction(() => /coordenada fora do Brasil/.test(document.querySelector('#view-dados')?.textContent || ''), null, { timeout: 10000 });
    const rel = await p.textContent('#view-dados');
    registrar('4.1', 'Validação linha a linha: coordenada fora do Brasil, chave desconhecida e poste repetido recusados com motivo', /coordenada fora do Brasil/.test(rel) && /tipo de chave desconhecido/.test(rel) && /repetido/.test(rel), '3 recusas com linha e motivo');
    await irPara(p, 'carteira');
    const xss = await p.evaluate(() => window.__xss);
    const nomeTexto = await p.locator('#view-carteira tbody').textContent();
    registrar('6.3', 'Texto importado é exibido como texto (sem execução de HTML)', xss === undefined && nomeTexto.includes('<img src=x'), 'nome com <img onerror> aparece literal');
    const [dl2] = await Promise.all([p.waitForEvent('download'), (async () => { await irPara(p, 'mapa'); if (await p.locator('.filtros-ativos button').count()) await p.click('.filtros-ativos button'); await p.click('[data-foco="r-arvore"]'); })().then(async () => {
      // base importada sem ocorrências: força um trecho de árvore marcando os postes, só para exportar
      await mod(p, async () => { const { estado } = await import('./js/store.js'); const D = await import('./js/dominio.js'); estado.rede.postes.forEach((x) => { x.veg = 1; }); estado.rede.versao += '-t'; D.limparCache(); });
      await p.click('[data-foco="r-acesso"]'); await p.click('[data-foco="r-acesso"]');
      await p.click('#ctrl-mais'); await p.click('#ctrl-exportar');
    })]);
    const csv2 = fs.readFileSync(await dl2.path(), 'utf8');
    registrar('4.9', 'Exportação neutraliza fórmula vinda da base (=HYPERLINK vira texto)', csv2.includes("'=HYPERLINK") && !/;=HYPERLINK/.test(csv2), csv2.split('\n')[1]?.slice(0, 80));

    // Perfil sem permissão: comando chamado pelo console é recusado e registrado
    await entrar(p, 'S4201');
    const negado = await mod(p, async () => { try { await (await import('./js/dados.js')).importar({ postes: new File(['a;b'], 'x.csv') }); return 'importou'; } catch (e) { return e.message; } });
    const logNeg = (await acoesLog(p)).some((r) => r.acao === 'IMPORTACAO_NEGADA' && r.resultado === 'NEGADO');
    registrar('6.9', 'Supervisor não importa base, nem chamando o módulo pelo console (negação registrada)', /não importa/.test(negado) && logNeg, negado);
    const navSup = await p.locator('#nav .nav__btn').allTextContents();
    registrar('2.5', 'Supervisor não vê a tela de Acesso/logs', !navSup.some((t) => /Acesso/.test(t)), navSup.join(' · '));

    // Gestor apaga a base importada
    await entrar(p, 'G4001');
    await irPara(p, 'dados');
    await p.click('#view-dados button:has-text("Apagar base importada")');
    await p.waitForTimeout(500);
    const origem = await mod(p, async () => (await import('./js/store.js')).estado.rede.origem);
    registrar('9.z', 'Apagar base importada volta para a demonstração', origem === 'SINTETICA', origem);

    // Log íntegro
    const integ = await mod(p, async () => (await import('./js/auditoria.js')).verificarIntegridade());
    const acoes = new Set((await acoesLog(p)).map((r) => r.acao));
    registrar('9.1', 'Log de auditoria encadeado e íntegro, com camadas, perguntas, consultas e exportações', integ.ok && ['CAMADA_ALTERADA', 'PERGUNTA_PRONTA', 'CLUSTER_CONSULTADO', 'PRIORIDADES_EXPORTADAS', 'BASE_IMPORTADA_APAGADA'].every((a) => acoes.has(a)), `${integ.total} registros, íntegro=${integ.ok}`);

    // Anti-iframe e CSP
    const html = fs.readFileSync(path.join(RAIZ, 'alimentadores/index.html'), 'utf8');
    const fr = await ctx.newPage();
    await fr.setContent(`<iframe src="${BASE}" width="400" height="300"></iframe>`);
    await fr.waitForTimeout(1500);
    const dentro = await fr.frames()[1]?.evaluate(() => document.body.textContent).catch(() => '');
    const externosCsp = (html.match(/https?:\/\/[^\s;"]+/g) || []).filter((u) => !/tile\.openstreetmap\.org|server\.arcgisonline\.com|tile\.opentopomap\.org/.test(u));
    registrar('1.3/1.4', 'CSP só libera o próprio site e os fundos de mapa; recusa abrir dentro de iframe', /Content-Security-Policy/.test(html) && !externosCsp.length && /não pode ser aberto dentro de outra página/.test(dentro || ''), `iframe: "${(dentro || '').trim().slice(0, 60)}"`);
    await ctx.close();

    // ================= Celular 360 px, alvos de toque e acessibilidade =================
    const cm = await browser.newContext({ viewport: { width: 360, height: 760 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await cm.route(/tile\.openstreetmap\.org|arcgisonline\.com|opentopomap\.org/, (r) => r.abort());
    const m = await cm.newPage();
    vigiar(m);
    await m.goto(BASE);
    const estouros = [], pequenos = [], a11y = [];
    const medir = async (tela) => {
      await m.waitForTimeout(350);
      await fecharToasts(m);
      const sw = await m.evaluate(() => Math.max(...[...document.querySelectorAll('.view:not([hidden]), #login:not([hidden]), #sheet:not([hidden])')].map((n) => n.scrollWidth), document.documentElement.scrollWidth));
      if (sw > 360) estouros.push(`${tela}:${sw}px`);
      const ruins = await m.evaluate(() => [...document.querySelectorAll('button, a.btn, input:not([type=file]):not([type=hidden]), select, textarea, summary, label.btn')]
        .filter((n) => n.offsetParent !== null && !n.closest('.sr-only'))
        .map((n) => ({ n, r: n.getBoundingClientRect() }))
        .filter(({ n, r }) => (n.type === 'checkbox' ? Math.max(r.height, n.closest('label')?.getBoundingClientRect().height || 0) : r.height) < 47.5) // checkbox: o alvo é a linha inteira (label)
        .map(({ n, r }) => `${n.tagName.toLowerCase()}${n.className ? '.' + String(n.className).split(' ')[0] : ''}(${Math.round(r.height)}px "${(n.textContent || n.placeholder || n.type || '').trim().slice(0, 18)}")`));
      ruins.forEach((x) => pequenos.push(`${tela}: ${x}`));
      if (AXE) {
        if (!(await m.evaluate(() => !!window.axe))) await m.evaluate(AXE);
        const v = await m.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa'] })).violations.map((x) => `${x.id}(${x.nodes.length}: ${x.nodes[0]?.target?.join(' ')})`));
        v.forEach((x) => a11y.push(`${tela}: ${x}`));
      }
      await m.screenshot({ path: path.join(SAIDA, `360-${tela}.png`) });
    };
    await m.waitForSelector('#login input[autocomplete=username]');
    await medir('login');
    await entrar(m, 'S4202');
    await medir('mapa-supervisor');
    await m.click('#ctrl-perguntas'); await medir('mapa-perguntas');
    await m.click('#painel-perguntas .pergunta:has-text("Onde o acesso alonga")');
    await medir('mapa-acesso');
    await m.click('#sheet-fechar'); await m.waitForTimeout(300);
    await m.click('#ctrl-filtros'); await medir('mapa-filtros'); await m.click('#ctrl-filtros');
    await m.click('#ctrl-perguntas');
    await m.click('#painel-perguntas .pergunta:has-text("Onde falta chave?")');
    await medir('mapa-arvore-manobra');
    await m.locator('.arvore-manobra .no__btn').first().tap();
    await medir('ficha-poste');
    await m.goBack(); await m.waitForTimeout(300);
    registrar('8.9', 'Botão voltar do celular fecha o painel sem sair do app', await m.locator('#sheet').isHidden() && m.url().includes('/alimentadores/'), m.url());
    await irPara(m, 'carteira'); await medir('carteira');
    await irPara(m, 'prioridades'); await medir('onde-agir');
    await irPara(m, 'dados'); await medir('dados-supervisor');
    await entrar(m, 'G4001');
    await irPara(m, 'dados'); await medir('dados-gestor');
    await irPara(m, 'acesso'); await m.waitForTimeout(400); await medir('acesso');
    registrar('8.1', 'Viewport 360 px sem rolagem horizontal', !estouros.length, estouros.join(', ') || '12 telas verificadas');
    registrar('8.2', 'Alvos de toque ≥ 48 px', !pequenos.length, pequenos.length ? `${pequenos.length} abaixo: ${pequenos.slice(0, 6).join('; ')}` : 'todos os controles visíveis ≥ 48 px');
    registrar('A11Y', 'axe-core (WCAG 2.1 A/AA) sem violações nas telas', AXE ? !a11y.length : false, AXE ? (a11y.slice(0, 8).join('; ') || '0 violações em 12 telas') : 'axe-core não instalado (npm install em testes/)');
    await cm.close();

    registrar('6.x', 'Sem erros de JavaScript nem violações de CSP no console', !erros.length, erros.slice(0, 3).join(' | ') || 'console limpo');
  } catch (e) {
    registrar('E2E', 'Execução do roteiro', false, e.message.split('\n').slice(0, 6).join(' | '));
  } finally {
    await browser.close();
    srv.close();
  }
  const falhas = resultados.filter((r) => !r.passou).length;
  fs.writeFileSync(path.join(SAIDA, 'resultado-e2e.json'), JSON.stringify({ quando: new Date().toISOString(), resultados }, null, 2));
  console.log(`\n${resultados.length - falhas}/${resultados.length} verificações aprovadas.`);
  process.exit(falhas ? 1 : 0);
})();
