import json, math
from mendeleev import element
from mendeleev.fetch import fetch_table
from american import american
from discoverers import tidy
iso = fetch_table('isotopes')
U={'Yyear':3.156e31,'usec':1e-6,'minute':60,'nsec':1e-9,'asec':1e-18,'Gyear':3.156e16,'Eyear':3.156e25,'Zyear':3.156e28,'zsec':1e-21,'kyear':3.156e10,'Myear':3.156e13,'sec':1,'ysec':1e-24,'hour':3600,'msec':1e-3,'day':86400,'Pyear':3.156e22,'year':3.156e7,'Tyear':3.156e19,'psec':1e-12}
STABLE="H2 He2 Li2 Be1 B2 C2 N2 O3 F1 Ne3 Na1 Mg3 Al1 Si3 P1 S4 Cl2 Ar3 K2 Ca5 Sc1 Ti5 V1 Cr4 Mn1 Fe4 Co1 Ni5 Cu2 Zn5 Ga2 Ge4 As1 Se5 Br2 Kr5 Rb1 Sr4 Y1 Zr4 Nb1 Mo6 Ru7 Rh1 Pd6 Ag2 Cd6 In1 Sn10 Sb2 Te6 I1 Xe7 Cs1 Ba6 La1 Ce4 Pr1 Nd5 Sm5 Eu1 Gd6 Tb1 Dy7 Ho1 Er6 Tm1 Yb7 Lu1 Hf5 Ta2 W4 Re1 Os6 Ir2 Pt5 Au1 Hg7 Tl2 Pb4"
import re
STAB={re.match(r'[A-Z][a-z]?',x).group():int(re.sub(r'[A-Za-z]','',x)) for x in STABLE.split()}
# Observationally stable: take the N most abundant non-radioactive-flagged isotopes; mendeleev flags more as stable than convention.
def num(v):
    try:
        if v is None: return None
        f=float(v)
        return None if math.isnan(f) else (round(f,4) if abs(f)<1e6 else f)
    except: return None
out=[]; isos=[]
for z in range(1,119):
    e=element(z)
    conf=e.ec.conf
    subs=[f"{n}{l}{c}" for (n,l),c in conf.items()]
    I=iso[iso.atomic_number==z].sort_values('mass_number')
    rows=[]
    for _,r in I.iterrows():
        hl=None
        if r.half_life==r.half_life and r.half_life_unit in U: hl=r.half_life*U[r.half_life_unit]
        rows.append(dict(A=int(r.mass_number),m=num(r.mass),ab=num(r.abundance),hl=hl,sp=None if r.spin!=r.spin else str(r.spin),rad=bool(r.is_radioactive)))
    want=STAB.get(e.symbol,0)
    cands=sorted([r for r in rows if not r['rad']],key=lambda r:-(r['ab'] or 0))
    stable=set(r['A'] for r in cands[:want])
    for r in rows:
        r['st']=r['A'] in stable
        if not r['st'] and r['hl'] is None and not r['rad']: r['hl']=None  # unknown
    A=max(stable,key=lambda a:next(r['ab'] or 0 for r in rows if r['A']==a)) if stable else None
    if A is None:
        live=[r for r in rows if r['hl']]
        A=max(live,key=lambda r:r['hl'])['A'] if live else round(e.atomic_weight or 2.5*z)
    vd=num(e.vdw_radius)
    ion=e.ionenergies or {}
    out.append(dict(z=z,s=e.symbol,n=e.name,w=num(e.atomic_weight),p=e.period,g=e.group_id,b=e.block,ser=e.series,
        subs=subs,A=A,
        vdw=vd,vdwEst=vd is None,cov=num(e.covalent_radius_pyykko),
        dens=num(e.density),mp=num(e.melting_point),bp=num(e.boiling_point),
        en=num(e.en_pauling),ea=num(e.electron_affinity),ie=num(ion.get(1)),
        ox=e.oxistates or [],cpk=e.cpk_color,crust=num(e.abundance_crust),sea=num(e.abundance_sea),
        geo=e.geochemical_class,phase=None,
        year=e.discovery_year,who=tidy(z,american(e.discoverers)),where=american(e.discovery_location),origin=american(e.name_origin),
        desc=american(e.description),uses=american(e.uses),src=american(e.sources),
        stab=len(stable),nIso=len(rows)))
    isos.append([[r['A'],r['m'],r['ab'],r['hl'],r['sp'],r['st']] for r in rows])
# fill vdw estimates from element one period above
for o in out:
    if o['vdw'] is None: o['vdw']=out[o['z']-33]['vdw']
json.dump(out,open('elements-full.json','w'),separators=(',',':'),ensure_ascii=False)
json.dump(isos,open('isotopes-full.json','w'),separators=(',',':'))
import os; print(os.path.getsize('elements-full.json'),os.path.getsize('isotopes-full.json'))
print(sum(o['stab'] for o in out), out[0], out[54]['vdw'], out[85]['vdw'], out[117])
print([ (o['s'],o['A']) for o in out if o['stab']==0][:10])
