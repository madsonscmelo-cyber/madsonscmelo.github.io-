// Carga da base real no Supabase, a partir dos mesmos CSV da tela Dados (mesma validação: alimentadores/js/importar.js).
// Uso (na máquina de quem tem a chave; a chave NUNCA vai para o repositório nem para o chat):
//   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
//   node supabase/carregar.mjs postes.csv [ocorrencias.csv] [compensacoes.csv] [--substituir]
// --substituir apaga a base anterior antes de carregar. Sem ele, a carga faz upsert (atualiza o que já existe).
import { readFileSync } from 'node:fs';
import { montarBase } from '../alimentadores/js/importar.js';

const URL_BASE = process.env.SUPABASE_URL, CHAVE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const args = process.argv.slice(2), substituir = args.includes('--substituir');
const [arqPostes, arqOc, arqComp] = args.filter((a) => !a.startsWith('--'));
if (!URL_BASE || !CHAVE || !arqPostes) {
  console.error('Uso: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node supabase/carregar.mjs postes.csv [ocorrencias.csv] [compensacoes.csv] [--substituir]');
  process.exit(2);
}
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(URL_BASE)) { console.error('SUPABASE_URL inválida (esperado https://<projeto>.supabase.co).'); process.exit(2); }

const ler = (f) => (f ? readFileSync(f, 'utf8') : '');
const { rede, rel } = montarBase({ postes: ler(arqPostes), ocorrencias: ler(arqOc), compensacoes: ler(arqComp) });
console.log(`Validação: ${rel.aceitas} linha(s) aceitas, ${rel.recusadas} recusada(s).`);
rel.avisos.forEach((a) => console.log(`  ⚠ ${a}`));
rel.recusas.slice(0, 20).forEach((r) => console.log(`  ✗ ${r.arquivo} linha ${r.linha}: ${r.motivo}`));
if (!rede) { console.error('Nada para carregar.'); process.exit(1); }

const cab = { apikey: CHAVE, Authorization: `Bearer ${CHAVE}`, 'Content-Type': 'application/json' };
async function rest(metodo, caminho, corpo, extra = {}) {
  const r = await fetch(`${URL_BASE}/rest/v1/${caminho}`, { method: metodo, headers: { ...cab, ...extra }, body: corpo ? JSON.stringify(corpo) : undefined });
  if (!r.ok) throw new Error(`${metodo} ${caminho.split('?')[0]}: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
}
async function lotes(tabela, linhas, conflito) {
  for (let i = 0; i < linhas.length; i += 1000) {
    await rest('POST', `${tabela}${conflito ? `?on_conflict=${conflito}` : ''}`, linhas.slice(i, i + 1000), { Prefer: `resolution=merge-duplicates,return=minimal` });
    process.stdout.write(`\r  ${tabela}: ${Math.min(i + 1000, linhas.length)}/${linhas.length}`);
  }
  if (linhas.length) process.stdout.write('\n');
}

// Pai antes do filho: cada lote é uma transação, então a ordem garante a chave estrangeira poste → pai.
function ordemTopologica(postes) {
  const porId = new Map(postes.map((p) => [p.id, p])), feitos = new Set(), out = [];
  for (const p of postes) {
    const cadeia = [];
    let q = p;
    while (q && !feitos.has(q.id)) { cadeia.push(q); feitos.add(q.id); q = q.pai ? porId.get(q.pai) : null; }
    out.push(...cadeia.reverse());
  }
  return out;
}

if (substituir) {
  console.log('Apagando a base anterior…');
  for (const t of ['compensacoes', 'ocorrencias', 'postes', 'alimentadores']) await rest('DELETE', `${t}?${t === 'compensacoes' ? 'id=gt.0' : 'id=neq.__nada__'}`);
}
await lotes('alimentadores', rede.alimentadores, 'id');
await lotes('postes', ordemTopologica(rede.postes).map((p) => ({ id: p.id, cod: p.cod, al: p.al, pai: p.pai || null, lat: p.lat, lon: p.lon, veg: p.veg, acesso: p.acesso, acesso_motivo: p.acessoMotivo, chave: p.chave, trafo: p.trafo, ucs: p.ucs })), 'id');
await lotes('ocorrencias', rede.ocorrencias.map((o) => ({ id: `${o.al}|${o.id}`, al: o.al, poste: o.poste, data: o.data, causa: o.causa, ucs: o.ucs, dur: o.dur, chi: o.chi, disp: o.disp || null })), 'id');
if (substituir) await lotes('compensacoes', rede.compensacoes.map((c) => ({ poste: c.poste, mes: c.mes, valor: c.valor })));
else if (rede.compensacoes.length) console.log('  compensacoes: use --substituir para recarregar (lançamentos não têm chave natural e duplicariam).');
await rest('POST', 'auditoria', { acao: 'BASE_CARREGADA', user_id: null, detalhe: { alimentadores: rede.alimentadores.length, postes: rede.postes.length, ocorrencias: rede.ocorrencias.length, compensacoes: rede.compensacoes.length, substituir } }, { Prefer: 'return=minimal' });
console.log('Carga concluída.');
