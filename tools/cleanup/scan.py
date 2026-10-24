#!/usr/bin/env python3
"""Cross-platform breadth-then-depth disk scan. Read-only. Outputs JSON.
Usage: scan.py ROOT [--min-gb 1] [--share 0.05] [--max-depth 8] [--stale-days 90]
       [--dupes] [--dupe-min-mb 50] [--big-mb 1000] [--old-days 365] [--jobs N] [--out f.json]
"""
import os, sys, json, time, stat, hashlib, argparse, shutil, platform
if sys.version_info < (3, 8): sys.exit("scan.py needs Python 3.8 or newer")
from concurrent.futures import ThreadPoolExecutor

ARTIFACTS = {"node_modules","target",".venv","venv","__pycache__",".next",".nuxt","dist","build",
             ".gradle",".dart_tool","Pods","DerivedData",".turbo",".parcel-cache",".pytest_cache",
             ".mypy_cache",".tox","cmake-build-debug","Library"}  # Library only counts under Unity proj
MARKERS = {"node_modules":"package.json","target":("Cargo.toml","pom.xml"),".venv":None,"venv":None,
           ".next":"package.json",".nuxt":"package.json","dist":"package.json","build":None,
           ".gradle":None,"Pods":"Podfile","Library":"ProjectSettings"}
CATEGORIES = [  # substring (lowercased, '/'-normalized) -> category
 ("docker","Docker/containers"),("containerd","Docker/containers"),("ext4.vhdx","WSL disk"),
 (".ollama","Ollama models"),("huggingface","HuggingFace cache"),("lm-studio","LM Studio models"),(".lmstudio","LM Studio models"),
 ("/.cache/pip","pip cache"),("/pip/cache","pip cache"),("/.cache/uv","uv cache"),("/uv/cache","uv cache"),
 ("conda/pkgs","conda pkgs"),("/.npm/_cacache","npm cache"),("npm-cache","npm cache"),("pnpm/store","pnpm store"),
 ("/.bun/install/cache","bun cache"),("yarn/berry/cache","yarn cache"),("/yarn/cache","yarn cache"),
 ("/.cargo/registry","cargo registry"),("/.gradle/caches","gradle cache"),("/.m2/repository","maven repo"),
 ("xcode/deriveddata","Xcode DerivedData"),("xcode/archives","Xcode archives"),("coresimulator","iOS simulators"),
 ("ios devicesupport","Xcode device support"),("android/sdk","Android SDK"),("/.android/avd","Android AVDs"),
 ("unity/cache","Unity cache"),("mobilesync/backup","iOS backups"),("apple computer/mobilesync","iOS backups"),
 ("/cache/","app cache"),("/caches/","app cache"),("code cache","Electron cache"),("gpucache","Electron cache"),
 ("service worker/cachestorage","browser/Electron cache"),("/logs/","logs"),("/var/log","logs"),
 ("windows/installer","Windows Installer cache (Never)"),("winsxs","WinSxS (use DISM)"),
 ("softwaredistribution/download","Windows Update cache"),("/var/lib/snapd","snaps"),("/var/lib/flatpak","flatpaks"),
 ("/.local/share/flatpak","flatpaks"),("/.local/share/trash","Trash"),("$recycle.bin","Recycle Bin"),("/.trash","Trash"),
 ("/.cursor/","Cursor data"),("/.codex/","Codex data"),("/.claude/","Claude data"),("worktrees","agent worktrees"),
]
SYSTEM_SKIP = {"/proc","/sys","/dev","/run","/System/Volumes/VM"}

def onsize(st):
    # allocated bytes (handles sparse/compressed); Windows lacks st_blocks
    b = getattr(st, "st_blocks", None)
    return b*512 if b is not None else st.st_size

class Scanner:
    def __init__(s, a):
        s.a=a; s.seen=set(); s.errors=0; s.symlinks=0; s.hardlink_dupes=0; s.sparse={}
        s.big={}; s.stale=[]; s.files_for_dupes={}; s.now=time.time()  # re-walks of subtrees revisit files: keep these keyed by path
    def walk(s, path, dev):
        """Return (alloc_bytes, apparent_bytes, newest_mtime, child_sizes dict)."""
        tot=app=0; newest=0; kids={}
        try: it=os.scandir(path)
        except OSError: s.errors+=1; return 0,0,0,{}
        with it:
            for e in it:
                try:
                    if e.is_symlink(): s.symlinks+=1; continue
                    st=e.stat(follow_symlinks=False)
                except OSError: s.errors+=1; continue
                if getattr(st,"st_file_attributes",0) & 0x400: s.symlinks+=1; continue  # Windows junction/reparse point
                if stat.S_ISDIR(st.st_mode):
                    # Windows scandir leaves st_dev at 0, so only compare devices when both are known
                    if (st.st_dev and dev and st.st_dev!=dev) or e.path in SYSTEM_SKIP: continue
                    t,ap,nw,_=s.walk(e.path, dev); kids[e.path]=(t,nw)
                    tot+=t; app+=ap; newest=max(newest,nw)
                elif stat.S_ISREG(st.st_mode):
                    key=(st.st_dev,st.st_ino)
                    if st.st_nlink>1 and st.st_ino:
                        if key in s.seen: s.hardlink_dupes+=1; continue
                        s.seen.add(key)
                    al=onsize(st); tot+=al; app+=st.st_size; newest=max(newest,st.st_mtime)
                    if st.st_size>4*al+(1<<20): s.sparse[e.path]=(st.st_size,al)
                    if st.st_size>=s.a.big_mb*1e6 and s.now-st.st_mtime>s.a.old_days*86400:
                        s.big[e.path]={"path":e.path,"gb":round(st.st_size/1e9,2),"age_days":int((s.now-st.st_mtime)/86400)}
                    if s.a.dupes and st.st_size>=s.a.dupe_min_mb*1e6:
                        s.files_for_dupes.setdefault(st.st_size,set()).add(e.path)
        if not newest:
            try: newest=os.stat(path).st_mtime
            except OSError: pass
        return tot,app,newest,kids

def category(p):
    q=p.replace("\\","/").lower()+"/"
    for k,c in CATEGORIES:
        if k in q: return c
    return None

def is_stale_artifact(p, newest, days, now):
    n=os.path.basename(p); par=os.path.dirname(p)
    if n not in ARTIFACTS: return False
    m=MARKERS.get(n)
    if m:
        ms=m if isinstance(m,tuple) else (m,)
        if not any(os.path.exists(os.path.join(par,x)) for x in ms): return False
    if n=="Library" and not os.path.exists(os.path.join(par,"ProjectSettings")): return False
    return now-newest>days*86400

def depth(sc, path, dev, d, root_total, out, a):
    sc.seen=set()  # hardlinks count once per subtree, so each node's size is complete
    t,ap,nw,kids=sc.walk(path,dev)
    node={"path":path,"gb":round(t/1e9,2),"apparent_gb":round(ap/1e9,2),
          "newest_days":int((sc.now-nw)/86400) if nw else None,"category":category(path),"children":[]}
    for k,(kt,knw) in sorted(kids.items(), key=lambda x:-x[1][0]):
        if is_stale_artifact(k,knw,a.stale_days,sc.now):
            sc.stale.append({"path":k,"gb":round(kt/1e9,2),"idle_days":int((sc.now-knw)/86400)})
        if d<a.max_depth and (kt>=a.min_gb*1e9 or (root_total and kt>=a.share*root_total and kt>=0.2e9)):
            node["children"].append(depth(sc,k,dev,d+1,root_total,out,a))
        elif kt>=0.1e9:
            node["children"].append({"path":k,"gb":round(kt/1e9,2),"category":category(k),"leaf":True})
    return node

def hash_file(p, n=None):
    h=hashlib.blake2b(digest_size=16)
    try:
        with open(p,"rb") as f:
            if n: h.update(f.read(n))
            else:
                for b in iter(lambda:f.read(1<<20),b""): h.update(b)
    except OSError: return None
    return h.hexdigest()

def dupes(sc):
    groups=[]
    for size,ps in sc.files_for_dupes.items():
        if len(ps)<2: continue
        by={}
        for p in sorted(ps): by.setdefault(hash_file(p,1<<16),[]).append(p)   # partial hash first
        for k,g in by.items():
            if k is None or len(g)<2: continue
            full={}
            for p in g: full.setdefault(hash_file(p),[]).append(p)
            for fk,fg in full.items():
                if fk and len(fg)>1: groups.append({"size_gb":round(size/1e9,2),"wasted_gb":round(size*(len(fg)-1)/1e9,2),"paths":fg})
    return sorted(groups,key=lambda g:-g["wasted_gb"])

def scan_one(root,a):
    root=os.path.abspath(os.path.expanduser(root))
    if not os.path.isdir(root): return {"root":root,"error":"not a folder or not reachable"}
    sc=Scanner(a); dev=os.stat(root).st_dev
    du=shutil.disk_usage(root)
    t0=time.time()
    # quick breadth pass for total, then adaptive depth (re-walks only big subtrees)
    br=Scanner(a); total,_,_,_=br.walk(root,dev)
    tree=depth(sc,root,dev,0,total,None,a)
    res={"root":root,"disk_total_gb":round(du.total/1e9,1),"disk_used_gb":round(du.used/1e9,1),
         "disk_free_gb":round(du.free/1e9,1),"scanned_gb":round(total/1e9,1),
         "unaccounted_gb":round((du.used-total)/1e9,1),
         "note":"unaccounted = other dirs on same volume, permission-denied, snapshots, system-managed (pagefile/hiberfil/APFS/VM), other mounts",
         "seconds":round(time.time()-t0,1),"errors":br.errors,"symlinks_skipped":br.symlinks,
         "hardlinks_counted_once":br.hardlink_dupes,
         "sparse_files":[{"path":p,"apparent_gb":round(x/1e9,2),"alloc_gb":round(y/1e9,2)} for p,(x,y) in list(sc.sparse.items())[:20]],
         "tree":tree,"stale_artifacts":sorted(sc.stale,key=lambda x:-x["gb"])[:200],
         "big_old_files":sorted(sc.big.values(),key=lambda x:-x["gb"])[:100]}
    if a.dupes: res["duplicates"]=dupes(sc)[:100]
    return res

def main():
    p=argparse.ArgumentParser(); p.add_argument("roots",nargs="*")
    p.add_argument("--min-gb",type=float,default=1); p.add_argument("--share",type=float,default=0.05)
    p.add_argument("--max-depth",type=int,default=8); p.add_argument("--stale-days",type=int,default=90)
    p.add_argument("--dupes",action="store_true"); p.add_argument("--dupe-min-mb",type=float,default=50)
    p.add_argument("--big-mb",type=float,default=1000); p.add_argument("--old-days",type=int,default=365)
    p.add_argument("--jobs",type=int,default=4); p.add_argument("--out")
    a=p.parse_args()
    roots=a.roots or [os.path.expanduser("~")]
    with ThreadPoolExecutor(a.jobs) as ex: results=list(ex.map(lambda r:scan_one(r,a),roots))
    out={"os":platform.system(),"generated":time.strftime("%Y-%m-%dT%H:%M:%S%z"),"results":results}
    s=json.dumps(out,indent=1)
    if a.out: open(a.out,"w",encoding="utf-8").write(s)
    else: print(s)
main()
