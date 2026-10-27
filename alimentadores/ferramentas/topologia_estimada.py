# Topologia ESTIMADA por proximidade: árvore geradora mínima (MST) dos postes de cada alimentador,
# só com ligações de até LIM metros, enraizada no poste mais perto do disjuntor (DJ) do alimentador.
# Depois liga cada chave do SIG ao poste mais próximo (até 60 m). Gera um postes.csv por UTD no formato do app.
import csv, sys, collections, math, time, unicodedata
import numpy as np
from scipy.spatial import cKDTree
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import minimum_spanning_tree, breadth_first_order, connected_components

RAW, CHAVES, SAIDA = sys.argv[1], sys.argv[2], sys.argv[3]
LIM, K, LIM_CHAVE = 400.0, 10, 60.0
t0 = time.time()

def norm(t): return unicodedata.normalize('NFKD', str(t).replace('\x8d', '')).encode('ascii', 'ignore').decode().upper()
def tipo_chave(tipo, estado):
    t = norm(tipo)
    if estado == 'Aberto' and any(k in t for k in ('CHAVE', 'RELIGADOR', 'SECCION', 'DISJUNTOR')): return 'NA'
    if 'DISJUNTOR' in t: return 'DJ'
    if 'RELIGADOR DE LINHA' in t or 'RELIGADORA' in t: return 'RL'
    if 'FUSIVEL' in t: return 'CF'
    if 'LAMINA' in t or 'SECCION' in t: return 'CS'
    return None
PRIO = {'DJ': 5, 'RL': 4, 'NA': 3, 'CS': 2, 'CF': 1}

# Chaves por alimentador
ch = collections.defaultdict(list); utd_chave = {}
with open(CHAVES, encoding='utf-8-sig') as f:
    for r in csv.DictReader(f, delimiter=';'):
        utd_chave[r['alimentador']] = r['conjunto']
        ch[r['alimentador']].append((float(r['latitude']), float(r['longitude']), r['chave'], r['poste']))

# Postes por alimentador
por = collections.defaultdict(list)
with open(RAW, encoding='utf-8') as f:
    rd = csv.reader(f); cab = next(rd); ix = {c: i for i, c in enumerate(cab)}
    for r in rd: por[r[ix['Alimentador']]].append(r)

utd_nome = lambda u: {'SENHOR DO BONFIM': 'S. Bonfim'}.get(u, u.title())
saidas, est = {}, collections.Counter()
comp_por_al, ligacao = [], []
for al, rs in por.items():
    lat = np.array([float(r[ix['lat']]) for r in rs]); lon = np.array([float(r[ix['lon']]) for r in rs])
    c = math.cos(math.radians(lat.mean()))
    xy = np.column_stack([lon * 111320 * c, lat * 110540])
    n = len(rs)
    pai = np.full(n, -1)
    if n > 1:
        tree = cKDTree(xy)
        d, j = tree.query(xy, k=min(K, n), distance_upper_bound=LIM)
        lin, col, val = [], [], []
        for a in range(n):
            for dd, b in zip(d[a][1:], j[a][1:]):
                if np.isfinite(dd) and b < n: lin.append(a); col.append(b); val.append(max(dd, 0.01))
        g = coo_matrix((val, (lin, col)), shape=(n, n)).tocsr()
        g = g.maximum(g.T)
        mst = minimum_spanning_tree(g); mst = mst + mst.T
        ncomp, rot = connected_components(mst, directed=False)
        comp_por_al.append((al, n, ncomp))
        # raiz de cada componente: poste mais perto do DJ do alimentador (ou o 1º, se não houver DJ)
        dj = [x for x in ch.get(al, []) if x[2] == 'DJ']
        alvo = np.array([dj[0][1] * 111320 * c, dj[0][0] * 110540]) if dj else xy[0]
        dist_alvo = np.hypot(*(xy - alvo).T)
        for k in range(ncomp):
            membros = np.where(rot == k)[0]
            raiz = membros[np.argmin(dist_alvo[membros])]
            ordem, pred = breadth_first_order(mst, raiz, directed=False, return_predecessors=True)
            for v in ordem:
                if v != raiz: pai[v] = pred[v]
        el = np.hypot(*(xy[pai >= 0] - xy[pai[pai >= 0]]).T); ligacao.extend(el.tolist())
    else:
        comp_por_al.append((al, n, 1))
    # chaves → poste mais próximo
    chave = [''] * n
    if ch.get(al) and n:
        tree = tree if n > 1 else cKDTree(xy)
        for (la, lo, tp, placa) in ch[al]:
            dd, k = tree.query([lo * 111320 * c, la * 110540])
            if dd <= LIM_CHAVE:
                if PRIO[tp] > PRIO.get(chave[k], 0): chave[k] = tp
                est['chave_ligada'] += 1
            else: est['chave_longe'] += 1
    # códigos únicos
    vistos = collections.Counter(); cod = []
    for i0, r in enumerate(rs):
        b = r[ix['Barramento']] if r[ix['Barramento']] not in ('', 'None') else f'{al}-SP{i0 + 1:05d}'  # sem placa no SIG
        vistos[b] += 1
        cod.append(b if vistos[b] == 1 else f'{b}#{vistos[b]}')
    utd = utd_nome(rs[0][ix['UTD']] or '') or utd_chave.get(al, '') or 'Sem UTD'  # UTD vazia na base de postes: usa a da camada de chaves
    if utd not in saidas:
        fh = open(f"{SAIDA}/postes_{norm(utd).replace(' ', '_').replace('.', '')}.csv", 'w', newline='', encoding='utf-8-sig')
        w = csv.writer(fh, delimiter=';')
        w.writerow(['alimentador', 'conjunto', 'nome_alimentador', 'poste', 'poste_pai', 'latitude', 'longitude', 'arvore', 'acesso', 'acesso_motivo', 'chave', 'trafo', 'ucs', 'score'])
        saidas[utd] = (fh, w)
    w = saidas[utd][1]
    for i, r in enumerate(rs):
        poda, acc, roc, dec = r[ix['2-Poda']], r[ix['1-Acesso']], r[ix['3-Roçado']], r[ix['4-Declive classe']]
        mot = [m for m, ok in (('rural', acc == 'Rural'), ('relevo ' + dec[2:].split(' ')[0].lower(), dec[:1] in 'BCD' and dec[:1] != ''), ('capoeira alta', roc.startswith('C-'))) if ok]
        veg = poda.startswith('A-')
        est['arvore'] += veg; est['acesso'] += bool(mot)
        w.writerow([al, utd, utd, cod[i], cod[pai[i]] if pai[i] >= 0 else '', f'{lat[i]:.7f}', f'{lon[i]:.7f}', 'S' if veg else 'N', 'S' if mot else 'N', ', '.join(mot), chave[i], '', '', r[ix['Score']]])
    est['postes'] += n
for fh, _ in saidas.values(): fh.close()
L = np.array(ligacao)
print('postes', est['postes'], 'alimentadores', len(por), 'seg', round(time.time() - t0))
print('ligacoes: mediana %.0f m, p95 %.0f m, max %.0f m' % (np.median(L), np.percentile(L, 95), L.max()))
cc = sorted(comp_por_al, key=lambda x: -x[2])
print('alimentadores com 1 componente:', sum(1 for x in comp_por_al if x[2] == 1), '| mais fragmentados:', cc[:6])
print('chaves ligadas a poste (<=60 m):', est['chave_ligada'], '| longe:', est['chave_longe'])
print('postes arvore (poda A):', est['arvore'], '| acesso dificil:', est['acesso'])
