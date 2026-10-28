# Monta a base do Raio-X a partir dos arquivos tratados (topologia real, trafos, ocorrências, compensações)
# + postes classificados (coordenadas e atributos) + camada de chaves do SIG. Saída: 3 CSV por UTD no formato do app.
import csv, sys, collections, math, unicodedata
import numpy as np
from scipy.spatial import cKDTree

RAW, RX, CHAVES, SAIDA = sys.argv[1:5]
ler = lambda p: list(csv.DictReader(open(p, encoding='utf-8-sig'), delimiter=';'))
norm = lambda t: unicodedata.normalize('NFKD', str(t)).encode('ascii', 'ignore').decode().upper()
PRIO = {'DJ': 5, 'RL': 4, 'NA': 3, 'CS': 2, 'CF': 1}
est = collections.Counter()

# 1. Postes classificados (coordenada + atributos)
attr, utd_al = {}, {}
with open(RAW, encoding='utf-8') as f:
    rd = csv.reader(f); cab = next(rd); ix = {c: i for i, c in enumerate(cab)}
    for r in rd:
        al, b = r[ix['Alimentador']], r[ix['Barramento']]
        if b in ('', 'None'): continue
        attr[(al, b)] = r
        if r[ix['UTD']]: utd_al.setdefault(al, r[ix['UTD']])
ch = ler(CHAVES)
for c in ch: utd_al.setdefault(c['alimentador'], c['conjunto'])
utd_nome = lambda u: {'SENHOR DO BONFIM': 'S. Bonfim'}.get(u.upper(), u.title()) if u else 'Sem UTD'

# 2. Topologia real; poste sem coordenada é contraído (filhos sobem para o ancestral com coordenada)
top = ler(f'{RX}/topologia.csv')
pai = {(r['alimentador'], r['poste']): r['poste_pai'] for r in top}
def pai_efetivo(al, p):
    q, passos = pai.get((al, p)), 0
    while q and (al, q) not in attr and passos < 10000:
        q = pai.get((al, q)); passos += 1
    return q or ''
postes = collections.defaultdict(list)
for r in top:
    k = (r['alimentador'], r['poste'])
    if k not in attr: est['poste_sem_coord'] += 1; continue
    postes[r['alimentador']].append(r['poste'])
est['poste_classificado_fora_topologia'] = len(set(attr) - set(pai))

# índices espaciais por alimentador
def xy(lat, lon, c): return np.column_stack([np.asarray(lon) * 111320 * c, np.asarray(lat) * 110540])
idx = {}
for al, ps in postes.items():
    la = np.array([float(attr[(al, p)][ix['lat']]) for p in ps]); lo = np.array([float(attr[(al, p)][ix['lon']]) for p in ps])
    c = math.cos(math.radians(la.mean())); idx[al] = (cKDTree(xy(la, lo, c)), ps, c)
def mais_proximo(al, lat, lon, lim):
    if al not in idx: return None
    t, ps, c = idx[al]
    d, k = t.query(xy([lat], [lon], c)[0])
    return ps[k] if d <= lim else None

# 3. Trafos → poste; UCs somadas por poste
ucs, trafo_cod, trafo_poste = collections.Counter(), {}, {}
for r in ler(f'{RX}/trafos.csv'):
    al = r['alimentador']
    p = r['poste'] if r['poste'] and (al, r['poste']) in attr else None
    if not p and r['latitude']:
        p = mais_proximo(al, float(r['latitude']), float(r['longitude']), 200); est['trafo_por_coordenada' if p else 'trafo_sem_poste'] += 1
    if not p: continue
    ucs[(al, p)] += int(float(r['ucs'] or 0)); trafo_cod.setdefault((al, p), r['trafo']); trafo_poste[r['trafo']] = (al, p)
    est['trafo_ligado'] += 1
# 4. Chaves → poste (até 60 m)
chave, chave_poste = {}, {}
for c in ch:
    al = c['alimentador']; p = mais_proximo(al, float(c['latitude']), float(c['longitude']), 60)
    if not p: est['chave_sem_poste'] += 1; continue
    k = (al, p); chave_poste[c['poste']] = k
    if PRIO[c['chave']] > PRIO.get(chave.get(k, ''), 0): chave[k] = c['chave']
    est['chave_ligada'] += 1

# 5. Saída por UTD
arqs = {}
def w(utd, tipo, cab):
    if (utd, tipo) not in arqs:
        f = open(f"{SAIDA}/{tipo}_{norm(utd).replace(' ', '_').replace('.', '')}.csv", 'w', newline='', encoding='utf-8-sig')
        wr = csv.writer(f, delimiter=';'); wr.writerow(cab); arqs[(utd, tipo)] = (f, wr)
    return arqs[(utd, tipo)][1]
for al, ps in postes.items():
    utd = utd_nome(utd_al.get(al, ''))
    wr = w(utd, 'postes', ['alimentador', 'conjunto', 'nome_alimentador', 'poste', 'poste_pai', 'latitude', 'longitude', 'arvore', 'acesso', 'acesso_motivo', 'chave', 'trafo', 'ucs', 'score'])
    for p in ps:
        r = attr[(al, p)]
        poda, acc, roc, dec = r[ix['2-Poda']], r[ix['1-Acesso']], r[ix['3-Roçado']], r[ix['4-Declive classe']]
        mot = [m for m, ok in (('rural', acc == 'Rural'), ('relevo ' + dec[2:].split(' ')[0].lower(), dec[:1] in ('B', 'C', 'D')), ('capoeira alta', roc.startswith('C-'))) if ok]
        wr.writerow([al, utd, utd, p, pai_efetivo(al, p), r[ix['lat']], r[ix['lon']], 'S' if poda.startswith('A-') else 'N', 'S' if mot else 'N', ', '.join(mot),
                     chave.get((al, p), ''), trafo_cod.get((al, p), ''), ucs.get((al, p), '') or '', r[ix['Score']]])
        est['poste_saida'] += 1
def local(al, eq):
    if not eq: return ''
    for m in (trafo_poste, chave_poste):
        if eq in m and m[eq][0] == al: return m[eq][1]
    return eq if (al, eq) in attr and al in postes else ''
for r in ler(f'{RX}/ocorrencias.csv'):
    al = r['alimentador']; p = local(al, r['equipamento'])
    est['oc_com_local' if p else 'oc_sem_local'] += 1
    w(utd_nome(utd_al.get(al, '')), 'ocorrencias', ['data_hora', 'alimentador', 'poste', 'causa', 'ucs', 'duracao_h', 'equipamento']).writerow([r['data_hora'], al, p, r['causa'], r['ucs'], r['duracao_h'], r['equipamento']])
for r in ler(f'{RX}/compensacoes.csv'):
    al = r['alimentador']; p = trafo_poste[r['trafo']][1] if r['trafo'] in trafo_poste and trafo_poste[r['trafo']][0] == al else ''
    est['comp_com_poste' if p else 'comp_sem_poste'] += 1
    w(utd_nome(utd_al.get(al, '')), 'compensacoes', ['alimentador', 'poste', 'mes', 'valor', 'trafo']).writerow([al, p, r['mes'], r['valor'], r['trafo']])
for f, _ in arqs.values(): f.close()
print(dict(est))
