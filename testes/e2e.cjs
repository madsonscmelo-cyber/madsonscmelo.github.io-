// Teste ponta a ponta + checklist de usabilidade/segurança executável (fases 3, 6 e 8).
// Uso: cd testes && npm install && npx playwright install chromium && npm run e2e
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { iniciar } = require('./servidor.cjs');

const RAIZ = path.resolve(__dirname, '..');
const FOTO = path.join(RAIZ, 'app', 'icon-512.png');
const CSV = path.join(RAIZ, 'app', 'modelos', 'exemplo-plano-com-erros.csv');
const SAIDA = path.join(__dirname, 'saida');
fs.mkdirSync(SAIDA, { recursive: true });

const resultados = [];
function registrar(id, nome, passou, evidencia) {
  resultados.push({ id, nome, passou, evidencia });
  console.log(`${passou ? '✅' : '⚠️ '} ${id} ${nome} — ${evidencia}`);
}

(async () => {
  const srv = await iniciar(RAIZ);
  const BASE = `http://127.0.0.1:${srv.address().port}/app/`;
  const browser = await chromium.launch();
  const erros = [];
  const vigiar = (p) => {
    p.on('console', (m) => { if (m.type() === 'error' && !/tile\.openstreetmap|net::ERR|status of 504/.test(m.text())) erros.push(m.text()); });
    p.on('pageerror', (e) => erros.push(e.message));
  };
  const dados = (p) => p.evaluate(() => new Promise((res) => { const q = indexedDB.open('redeviva'); q.onsuccess = () => { const g = q.result.transaction('kv').objectStore('kv').get('dados'); g.onsuccess = () => res(g.result); }; }));
  const entrar = async (p, nome) => {
    if (await p.locator('#login').isHidden()) { await p.click('#btn-usuario'); await p.click('text=Trocar usuário'); }
    await p.click(`.login__btn:has-text("${nome}")`);
    await p.waitForTimeout(350);
  };
  const ultimoToast = async (p) => (await p.locator('.toast').allInnerTexts()).at(-1) || '';

  try {
    // ================= Fluxo completo (cenário §14) =================
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 }, serviceWorkers: 'block' });
    const p = await ctx.newPage();
    vigiar(p);
    await p.goto(BASE);
    await entrar(p, 'Gestão de Planejamento');

    await p.click('.nav__btn[data-view=plano]');
    await p.setInputFiles('#view-plano input[type=file]', CSV);
    await p.waitForTimeout(400);
    const rel = await p.locator('#view-plano .bloco').first().innerText();
    registrar('E2E-1', 'Importação do plano valida linha a linha', /6 linha\(s\) aceita\(s\)/.test(rel) && /4 rejeitada/.test(rel), rel.split('\n')[2] || rel.slice(0, 120));

    await entrar(p, 'Equipe Inspeção 01');
    let d = await dados(p);
    const insp = d.inspecoes.find((x) => x.status !== 'CONCLUIDA' && x.equipeId === 'INS-01' && x.criterioId === 'TRAFO_REINCIDENTE');
    const alvo = d.ativos.find((x) => x.id === insp.ativoId);
    await p.fill('.busca__inp', alvo.codigo);
    await p.click(`.busca__item:has-text("${alvo.codigo}")`);
    await p.waitForTimeout(1100);
    registrar('UX-JAKOB', 'Busca por código abre o ativo no mapa', await p.locator('#sheet-titulo').innerText().then((t) => t.includes(alvo.codigo)), alvo.codigo);

    const mk = await p.locator(`.leaflet-marker-icon[title^="Transformador ${alvo.codigo} "]`).boundingBox();
    await p.click('#ctrl-mais');
    await p.click('#ctrl-simular');
    await p.mouse.click(mk.x + mk.width / 2 + 25, mk.y + mk.height / 2);
    await p.waitForTimeout(250);
    const alerta = (await p.locator('.toast--alerta').allInnerTexts()).join(' ');
    registrar('RF-ROT-03', 'Alerta de proximidade dispara para pendência da equipe', /Perto de você/.test(alerta), alerta.replace(/\n/g, ' '));
    await p.click('#ctrl-mais'); await p.click('#ctrl-simular');

    await p.click('#sheet-rodape button:has-text("Inspecionar agora")');
    await p.locator('.segmentado__op--nc').first().click();
    await p.click('#sheet-rodape button:has-text("Próximo")');
    await p.selectOption('.novo-def label:has-text("Tipo de defeito") select', 'TRAFO_VAZAMENTO');
    await p.setInputFiles('.novo-def input[type=file]', FOTO);
    await p.waitForTimeout(500);
    await p.click('.novo-def button:has-text("Adicionar defeito")');
    // Zeigarnik: fecha no meio e retoma pelo aviso no mapa
    await p.click('#sheet-fechar');
    await p.waitForTimeout(250);
    const aviso = await p.locator('.rascunho').innerText().catch(() => '');
    await p.click('.rascunho');
    await p.waitForTimeout(250);
    const etapa = await p.locator('.passo--atual').innerText();
    registrar('UX-ZEIGARNIK', 'Inspeção interrompida vira rascunho e é retomada na mesma etapa', /etapa 2 de 3/.test(aviso) && /Defeitos/.test(etapa), aviso.replace(/\n/g, ' '));

    await p.click('text=＋ Adicionar defeito / manutenção');
    await p.selectOption('.novo-def label:has-text("Tipo de defeito") select', 'NINHO');
    await p.setInputFiles('.novo-def input[type=file]', FOTO);
    await p.waitForTimeout(500);
    await p.check('.novo-def input[type=checkbox]');
    await p.click('.novo-def button:has-text("Adicionar defeito")');
    await p.click('#sheet-rodape button:has-text("Próximo")');
    const larg = await p.locator('.passos__preench').evaluate((n) => n.style.width);
    registrar('UX-GRADIENTE', 'Assistente mostra progresso por etapa', larg === '100%', `barra em ${larg} na etapa 3/3`);
    await p.setInputFiles('#sheet .fotos input[type=file]', FOTO);
    await p.waitForTimeout(500);
    await p.click('#sheet-rodape button:has-text("Concluir inspeção")');
    await p.waitForTimeout(400);
    d = await dados(p);
    const novos = d.defeitos.filter((x) => x.ativoId === alvo.id && !x.sintetico);
    registrar('E2E-2', 'Inspeção gera defeito (turma pesada) e manutenção na hora', novos.some((x) => x.tipoId === 'TRAFO_VAZAMENTO' && x.status === 'IDENTIFICADO') && novos.some((x) => x.tipoId === 'NINHO' && x.status === 'EXECUTADO') && !Object.keys(d.rascunhos || {}).length,
      novos.map((x) => `${x.tipoId}:${x.status}`).join(', '));

    await entrar(p, 'Supervisão de Campo');
    await p.click('.nav__btn[data-view=defeitos]');
    const card = () => p.locator(`.card-def:has-text("${alvo.codigo}"):has-text("Vazamento")`).first();
    await card().locator('button:has-text("Validar")').click();
    await card().locator('button:has-text("Programar")').click();
    await entrar(p, 'Equipe Turma Pesada 01');
    await p.click('.nav__btn[data-view=defeitos]');
    await card().locator('button:has-text("Registrar execução")').click();
    await p.setInputFiles('#sheet input[type=file]', FOTO);
    await p.waitForTimeout(500);
    await p.click('#sheet-rodape button');
    const bloqueio = await ultimoToast(p);
    await p.fill('#sheet textarea[placeholder^="Justificativa"]', 'GPS sem sinal no local');
    await p.click('#sheet-rodape button');
    await p.waitForTimeout(300);
    registrar('RF-INS-07', 'Execução fora do raio/sem GPS exige justificativa', /justificativa/i.test(bloqueio), bloqueio);
    await entrar(p, 'Supervisão de Campo');
    await p.click('.nav__btn[data-view=defeitos]');
    await p.click('.abas__btn:has-text("A verificar")');
    await card().locator('button:has-text("Verificar e fechar")').click();
    await p.waitForTimeout(300);
    d = await dados(p);
    registrar('E2E-3', 'Fluxo Identificado→Validado→Programado→Executado→Verificado', d.defeitos.find((x) => x.ativoId === alvo.id && x.tipoId === 'TRAFO_VAZAMENTO').status === 'VERIFICADO', 'PES-01 executou, supervisor verificou');

    // ================= Fase 3 — autorização (camada cliente, "por API direta") =================
    await entrar(p, 'Equipe Poda 01');
    const nav = (await p.locator('.nav__btn').allInnerTexts()).join(',');
    registrar('3.4', 'Equipe não vê telas de gestão (Plano/Painel)', !/Plano|Painel/.test(nav), nav.replace(/\n/g, ' '));
    const tentativas = await p.evaluate(async () => {
      const { estado } = await import('./js/store.js');
      const acoes = await import('./js/acoes.js');
      const out = [];
      const tenta = (nome, fn) => { try { fn(); out.push(`${nome}: PERMITIDO`); } catch (e) { out.push(`${nome}: bloqueado (${e.message})`); } };
      const ident = estado.dados.defeitos.find((f) => f.status === 'IDENTIFICADO');
      tenta('autovalidar defeito', () => acoes.transicionar(ident, 'VALIDADO'));
      const prog = estado.dados.defeitos.find((f) => f.status === 'PROGRAMADO' && f.equipeId !== 'POD-01');
      tenta('executar defeito de outra equipe', () => acoes.transicionar(prog, 'EXECUTADO', { fotos: [{ id: 'x' }] }));
      tenta('atribuir inspeção', () => acoes.atribuirInspecao(estado.dados.inspecoes[0].id, 'INS-01'));
      tenta('concluir inspeção sem foto', () => acoes.concluirInspecao({ ativoIds: [estado.dados.ativos[0].id], avulsa: true, fotos: [], geo: { dentroDoRaio: true }, justificativa: 'x' }));
      return out;
    });
    registrar('3.6/3.7/3.9', 'Ações proibidas chamadas direto no módulo são bloqueadas', tentativas.every((t) => t.includes('bloqueado')), tentativas.join(' | '));

    // ================= Fase 8 — offline =================
    await entrar(p, 'Supervisão de Campo');
    await p.click('#btn-usuario'); await p.click('text=Simular modo offline');
    await p.click('.nav__btn[data-view=plano]');
    await p.click('text=Distribuir pendentes automaticamente');
    await p.waitForTimeout(800);
    const fila = await p.locator('#st-sync').innerText();
    await p.click('#btn-usuario'); await p.click('text=Voltar a ficar online');
    await p.waitForTimeout(1200);
    const apos = await p.locator('#st-sync').innerText();
    registrar('8.3', 'Offline: fila local e sincronização ao reconectar', /a enviar/.test(fila) && /Sincronizado/.test(apos), `${fila} → ${apos}`);
    await ctx.close();

    // ================= Trabalho offline por alimentador =================
    const ctxo = await browser.newContext({ viewport: { width: 1280, height: 820 } });
    const po = await ctxo.newPage();
    vigiar(po);
    await po.goto(BASE);
    await po.waitForFunction(() => navigator.serviceWorker.ready.then(() => true));
    await po.reload();
    await entrar(po, 'Equipe Inspeção 01');
    await po.click('#ctrl-mais');
    await po.click('#ctrl-offline');
    await po.selectOption('#sheet select', 'ALM-07');
    await po.waitForTimeout(400);
    const estim = (await po.locator('#sheet .meta-grupo').innerText()).replace(/\n/g, ' ');
    await po.click('#sheet-rodape button');
    await po.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /Pacote ALM-07/.test(t.textContent)), null, { timeout: 90000 });
    let dpo = await dados(po);
    const pac = dpo.pacotes['ALM-07'];
    registrar('OFF-1', 'Pacote do alimentador: recorte leve de dados + mapa só do corredor', pac.bytesDados < 150 * 1024 && pac.tilesTotal <= 250 && pac.tilesOk > 0,
      `${pac.itens.ativos} ativos, ${pac.itens.inspecoes} inspeções, ${pac.itens.defeitos} defeitos · dados ${Math.round(pac.bytesDados / 1024)} KB (${Math.round((pac.bytesGzip || 0) / 1024)} KB gzip) · mapa ${pac.tilesOk}/${pac.tilesTotal} quadros`);
    console.log('   estimativa exibida:', estim);

    // Sem rede de verdade: recarrega e o mapa do corredor vem do pacote
    await ctxo.setOffline(true);
    await po.reload();
    await po.waitForSelector('.login__btn, .nav__btn', { timeout: 10000 });
    if (await po.locator('.login__btn').count()) await entrar(po, 'Equipe Inspeção 01');
    await po.fill('.busca__inp', 'P-07-010');
    await po.click('.busca__item');
    await po.waitForTimeout(2500);
    const quadros = await po.locator('.leaflet-tile-loaded').count();
    registrar('OFF-2', 'Sem internet, o mapa do corredor abre a partir do pacote', quadros > 0, `${quadros} quadros de mapa carregados offline`);

    // Mapa leve: zero quadros, rede continua visível
    await po.evaluate(async () => (await import('./js/offline.js')).definirMapaLeve(true));
    await po.waitForTimeout(300);
    const quadrosLeve = await po.locator('.leaflet-tile').count();
    const marcadores = await po.locator('.mk-wrap').count();
    registrar('OFF-3', 'Mapa leve mostra só a rede, sem baixar fundo', quadrosLeve === 0 && marcadores > 0, `${marcadores} ativos visíveis, ${quadrosLeve} quadros de fundo`);
    await po.evaluate(async () => (await import('./js/offline.js')).definirMapaLeve(false));

    // Rede móvel: registros sobem, fotos esperam o Wi-Fi
    await ctxo.setOffline(false);
    const filaRede = await po.evaluate(async () => {
      const st = await import('./js/store.js');
      st.estado.redeMovelSimulada = true;
      await st.salvarFoto(new Blob([new Uint8Array(40000)], { type: 'image/jpeg' }));
      st.registrar('TESTE_REGISTRO', 'teste', 'x');
      await new Promise((r) => setTimeout(r, 1200));
      const em4g = st.resumoFila();
      st.estado.redeMovelSimulada = false;
      st.sincronizar();
      await new Promise((r) => setTimeout(r, 1200));
      return { em4g, wifi: st.resumoFila() };
    });
    registrar('OFF-4', 'Na rede móvel os registros sobem e as fotos aguardam o Wi-Fi', filaRede.em4g.dados === 0 && filaRede.em4g.fotos >= 1 && filaRede.wifi.total === 0,
      `4G: ${filaRede.em4g.dados} registros / ${filaRede.em4g.fotos} foto(s) na fila → Wi-Fi: ${filaRede.wifi.total}`);
    await ctxo.close();

    // ================= Fase 8 — PWA, recarga sem rede, anti-iframe =================
    const ctx2 = await browser.newContext();
    const p2 = await ctx2.newPage();
    vigiar(p2);
    await p2.goto(BASE);
    await p2.waitForFunction(() => navigator.serviceWorker.controller || navigator.serviceWorker.ready.then(() => true));
    const arquivos = [];
    for (const f of ['manifest.webmanifest', 'sw.js', 'icon-192.png', 'icon-512.png', 'icon.svg']) arquivos.push(`${f}:${(await p2.request.get(BASE + f)).status()}`);
    registrar('8.4', 'PWA instalável: manifest, service worker e ícones', arquivos.every((a) => a.endsWith(':200')), arquivos.join(' '));
    await p2.waitForTimeout(800);
    await ctx2.setOffline(true);
    await p2.reload();
    await p2.waitForSelector('.login__btn', { timeout: 8000 }).catch(() => {});
    registrar('8.3b', 'App abre sem rede (service worker)', await p2.locator('.login__btn').count() > 0, 'recarregado com rede cortada');
    await ctx2.setOffline(false);
    await p2.setContent(`<iframe src="${BASE}" width="600" height="400"></iframe>`);
    await p2.waitForTimeout(1500);
    const txtFrame = await p2.frames()[1]?.locator('body').innerText().catch(() => '') || '';
    registrar('1.4', 'App se recusa a rodar dentro de iframe (clickjacking)', /não pode ser aberto dentro de outra página/.test(txtFrame), txtFrame.slice(0, 80));
    await ctx2.close();

    // ================= Fase 8 — 360 px e alvos de toque ≥ 48 px =================
    const ctx3 = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' });
    const m = await ctx3.newPage();
    vigiar(m);
    await m.goto(BASE);
    const estouros = [], pequenos = [];
    const medir = async (tela) => {
      await m.waitForTimeout(250);
      const sw = await m.evaluate(() => document.documentElement.scrollWidth);
      if (sw > 360) estouros.push(`${tela}:${sw}px`);
      const ruins = await m.evaluate(() => [...document.querySelectorAll('button, a.btn, input:not([type=file]):not([type=hidden]), select, textarea, summary')]
        .filter((n) => n.offsetParent !== null && !n.closest('.leaflet-control-attribution, .leaflet-marker-icon'))
        .map((n) => ({ n, r: n.getBoundingClientRect() }))
        .filter(({ n, r }) => (n.type === 'checkbox' ? Math.max(r.height, n.closest('label')?.getBoundingClientRect().height || 0) : r.height) < 47.5)
        .map(({ n, r }) => `${n.tagName.toLowerCase()}${n.className ? '.' + String(n.className).split(' ')[0] : ''}(${Math.round(r.height)}px "${(n.textContent || n.placeholder || n.type || '').trim().slice(0, 18)}")`));
      ruins.forEach((x) => pequenos.push(`${tela}: ${x}`));
      await m.screenshot({ path: path.join(SAIDA, `360-${tela}.png`) });
    };
    await medir('login');
    await m.click('.login__btn:has-text("Equipe Inspeção 02")');
    await medir('mapa');
    await m.click('#ctrl-mais'); await medir('mapa-mais'); await m.click('#ctrl-mais');
    await m.click('#ctrl-filtros'); await medir('filtros'); await m.click('#ctrl-filtros');
    const dm = await dados(m);
    const pm = dm.inspecoes.find((i) => i.status !== 'CONCLUIDA' && i.equipeId === 'INS-02');
    await m.fill('.busca__inp', dm.ativos.find((a) => a.id === pm.ativoId).codigo);
    await medir('busca');
    await m.locator('.busca__item').first().tap();
    await m.waitForTimeout(900);
    await medir('ficha');
    await m.click('#sheet-rodape button');
    await medir('form-etapa1');
    await m.click('#sheet-rodape button:has-text("Próximo")');
    await m.click('text=＋ Adicionar defeito / manutenção');
    await medir('form-etapa2');
    await m.goBack();
    await m.waitForTimeout(300);
    registrar('8.9', 'Botão voltar do celular fecha o painel sem sair do app', await m.locator('#sheet').isHidden() && m.url().includes('/app/'), m.url());
    await m.click('.nav__btn[data-view=defeitos]'); await medir('defeitos');
    await m.click('.nav__btn[data-view=producao]'); await medir('producao');
    await m.click('#btn-usuario'); await m.click('text=Trocar usuário');
    await m.click('.login__btn:has-text("Gestão de Planejamento")');
    await m.click('.nav__btn[data-view=painel]'); await medir('painel');
    await m.click('.nav__btn[data-view=plano]'); await medir('plano');
    registrar('8.1', 'Viewport 360 px sem rolagem horizontal', !estouros.length, estouros.join(', ') || '12 telas verificadas');
    registrar('8.2', 'Alvos de toque ≥ 48 px', !pequenos.length, pequenos.length ? `${pequenos.length} abaixo: ${pequenos.slice(0, 6).join('; ')}` : 'todos os controles visíveis ≥ 48 px');
    await ctx3.close();

    registrar('6.x', 'Sem erros de JavaScript nem violações de CSP no console', !erros.length, erros.slice(0, 3).join(' | ') || 'console limpo');
  } catch (e) {
    registrar('E2E', 'Execução do roteiro', false, e.message.split('\n')[0]);
  } finally {
    await browser.close();
    srv.close();
  }
  const falhas = resultados.filter((r) => !r.passou).length;
  fs.writeFileSync(path.join(SAIDA, 'resultado-e2e.json'), JSON.stringify({ quando: new Date().toISOString(), resultados }, null, 2));
  console.log(`\n${resultados.length - falhas}/${resultados.length} verificações aprovadas.`);
  process.exit(falhas ? 1 : 0);
})();
