#!/usr/bin/env python3
"""T3 Tots read-only query tool. Usage: python3 t3q.py <overview|waiting|thread|projects|health|usage>
Settings via env: T3_DAYS, T3_ALL=1, T3_Q (thread name), T3_LAST, T3_WEEK=1.
Data folder: T3CODE_HOME (T3 Code's own setting, default ~/.t3) + /userdata; T3_HOME may point at either folder.
Needs Python 3.8+. Opens statev2.sqlite read-only; never reads secrets/token/auth files."""
import sqlite3, os, json, sys, datetime as dt, difflib
if sys.version_info < (3, 8): print("PYTHON_TOO_OLD: t3q.py needs Python 3.8 or newer"); sys.exit(0)
try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # Windows consoles default to cp1252
except Exception: pass
def t3_dir():  # T3 Code stores state in <T3CODE_HOME or ~/.t3>/userdata (dev builds: /dev), same for stable and Nightly
    for v in (os.environ.get("T3_HOME"), os.environ.get("T3CODE_HOME")):
        v = (v or "").strip()
        if not v: continue
        v = os.path.expanduser(v)
        if os.path.exists(os.path.join(v, "statev2.sqlite")) or os.path.exists(os.path.join(v, "server-runtime.json")): return v
        return os.path.join(v, "userdata")
    base = os.path.join(os.path.expanduser("~"), ".t3")
    for sub in ("userdata", "dev"):
        if os.path.exists(os.path.join(base, sub, "statev2.sqlite")): return os.path.join(base, sub)
    return os.path.join(base, "userdata")
D = t3_dir()
P = os.path.join(D, "statev2.sqlite")
HOME = os.path.expanduser("~")
def tilde(p): return p.replace(HOME, "~", 1) if p.startswith(HOME) else p
def loc(s):
    try:
        t = dt.datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(); z = t.strftime("%Z")
        return t.strftime("%b %d %H:%M ") + (z if len(z) <= 5 else "UTC" + t.strftime("%z"))
    except Exception: return s or "-"
def ago_h(s):
    try: return (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(s.replace("Z", "+00:00"))).total_seconds() / 3600
    except Exception: return 0
def flat(s, n): s = " ".join((s or "").replace(os.path.expanduser("~"), "~").split()); return s if len(s) <= n else s[:n] + "…"
def since(days): return (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%S")
LIVE = ("queued", "preparing", "starting", "running")
TH = "orchestration_v2_projection_threads"; RU = "orchestration_v2_projection_runs"
RQ = "orchestration_v2_projection_runtime_requests"; MS = "orchestration_v2_projection_messages"
# a queued run whose queue was stopped on purpose is not running: it waits for someone to resume or cancel it
RUNST = "case when r.status='queued' and json_extract(r.payload_json,'$.queueHeld') then 'queue held' else r.status end"
SPAWNED = ("mcp", "provider")  # threads created by agents, not by the user
def asks_q(text):
    tail = [l.strip(" *_>`)") for l in (text or "").splitlines() if l.strip()][-2:]
    return any(l.endswith("?") for l in tail)
CLOSERS = ("when you say so", "your call", "your go-ahead", "need your", "ready when you", "decisions for you", "up to you")
def asks_you(text):  # a question at the end, or hand-back phrases anywhere in the last reply
    body = " ".join((text or "").split()).lower()
    return asks_q(text) or any(c in body for c in CLOSERS)
CMD = sys.argv[1] if len(sys.argv) > 1 else "overview"
if CMD not in ("overview", "waiting", "thread", "projects", "health", "usage"): print("usage: python3 t3q.py overview|waiting|thread|projects|health|usage   (Windows: py -3 or python)"); sys.exit(0)
if CMD != "usage":
    if not os.path.exists(P): print("NO_T3_DATA at", tilde(D), "- T3 Code has not run on this computer yet (or T3CODE_HOME points elsewhere)."); sys.exit(0)
    db = sqlite3.connect("file:" + P.replace("\\", "/") + "?mode=ro", uri=True)
q = lambda s, a=(): db.execute(s, a).fetchall()
# Older T3 builds kept approvals in their own table; newer ones keep them in runtime_requests (already counted)
APPROVALS = "(select count(*) from projection_pending_approvals a where a.thread_id=t.thread_id and a.status='pending')" \
    if CMD != "usage" and q("select 1 from sqlite_master where type='table' and name='projection_pending_approvals'") else "0"

def overview():
    DAYS = int(os.environ.get("T3_DAYS", "7")); ALL = os.environ.get("T3_ALL") == "1"
    rows = q(f"""select t.thread_id, coalesce(p.title,'(no project)'), t.title, t.updated_at,
     coalesce(json_extract(t.payload_json,'$.creationSource'),'?'),
     (select {RUNST} from {RU} r where r.thread_id=t.thread_id order by ordinal desc limit 1),
     (select count(*) from {RQ} x where x.thread_id=t.thread_id and x.status='pending'),
     (select role||char(31)||coalesce(json_extract(payload_json,'$.text'),'') from {MS} m where m.thread_id=t.thread_id order by created_at desc limit 1)
     from {TH} t left join projection_projects p on p.project_id=t.project_id
     where t.archived_at is null and t.deleted_at is null and t.updated_at >= ? order by t.updated_at desc""", (since(DAYS),))
    mine = [r for r in rows if ALL or r[4] not in SPAWNED]
    print(f"T3 threads active in last {DAYS} days: {len(mine)} shown, {len(rows)-len(mine)} agent-spawned hidden (T3_ALL=1 shows them)")
    for tid, proj, title, upd, src, run, pend, last in mine:
        role, _, text = (last or "\x1f").partition("\x1f")
        st = "running" if run in LIVE else "needs you" if pend or run in ("waiting", "queue held") or (role == "assistant" and asks_you(text)) else (run or "idle")
        print(f"- [{proj}] {title} | {st} | {loc(upd)} | {role or '-'}: {flat(text,140)}")
    spawned = {}
    for r in rows:
        if r not in mine: spawned[r[1]] = spawned.get(r[1], 0) + 1
    if spawned: print("agent-spawned by project:", ", ".join(f"{k} {v}" for k, v in spawned.items()))

def waiting():
    DAYS = int(os.environ.get("T3_DAYS", "14"))
    rows = q(f"""select t.thread_id, coalesce(p.title,'(no project)'), t.title, t.updated_at,
     (select {RUNST} from {RU} r where r.thread_id=t.thread_id order by ordinal desc limit 1),
     (select group_concat(kind||'@'||created_at) from {RQ} x where x.thread_id=t.thread_id and x.status='pending'),
     {APPROVALS},
     coalesce(json_extract(t.payload_json,'$.creationSource'),'?'),
     (select role||char(31)||coalesce(json_extract(payload_json,'$.text'),'') from {MS} m where m.thread_id=t.thread_id order by created_at desc limit 1)
     from {TH} t left join projection_projects p on p.project_id=t.project_id
     where t.archived_at is null and t.deleted_at is null and t.updated_at >= ? order by t.updated_at desc""", (since(DAYS),))
    n = 0
    ALL = os.environ.get("T3_ALL") == "1"
    for tid, proj, title, upd, run, pend, appr, src, last in rows:
        if src in SPAWNED and not ALL and not (pend or appr): continue
        role, _, text = (last or "\x1f").partition("\x1f")
        asks = role == "assistant" and asks_you(text)
        if run in LIVE or not (pend or appr or run in ("waiting", "queue held") or asks): continue
        n += 1
        why = []
        if pend:
            for k in pend.split(","):
                kind, _, at = k.partition("@"); why.append(f"pending {kind} since {loc(at)}" + (" (stale >24h)" if ago_h(at) > 24 else ""))
        if appr: why.append(f"{appr} pending approval(s)")
        if run == "queue held": why.append(f"queue held: a message waits to start (resume: t3ctl queue --thread '{tid}' --resume, or cancel it)")
        if asks and not why: why.append("last reply asks you a question or hands a decision back")
        print(f"\n## [{proj}] {title}\nid {tid} | {loc(upd)} | " + "; ".join(why))
        msg = " ".join((text or "").split())
        if msg: print("last assistant message:", flat(msg, 900) if len(msg) <= 900 else flat(msg[:400], 400) + " … " + flat(msg[-500:], 500))
    print(f"\n{n} thread(s) waiting on you (last {DAYS} days)" if n else f"Nothing waiting on you (last {DAYS} days)")

def thread():  # fuzzy match a user thread; prints state, git context, goal, last N messages
    import subprocess
    Q = os.environ.get("T3_Q", "").strip().lower()
    th = q(f"select t.thread_id, t.title, coalesce(p.title,'(no project)'), p.workspace_root, t.payload_json, t.created_at, t.updated_at, coalesce(json_extract(t.payload_json,'$.creationSource'),'') from {TH} t left join projection_projects p on p.project_id=t.project_id where t.deleted_at is null order by t.updated_at desc")
    if not Q: th = [r for r in th if r[7] not in SPAWNED]
    if not th: print("no threads"); return
    def score(r):
        t = r[1].lower()
        return (1.0 if Q and Q in t else 0) + difflib.SequenceMatcher(None, Q, t).ratio() + 0.15 * sum(w in t for w in Q.split())
    ranked = sorted(th, key=score, reverse=True) if Q else th
    print("matches:", " | ".join(f"{r[1]} [{r[2]}] {score(r):.2f}" for r in ranked[:4]))
    tid, title, proj, root, pj, c, u, _ = ranked[0]; pj = json.loads(pj or "{}")
    runs = q(f"select status, count(*) from {RU} where thread_id=? group by 1", (tid,))
    last_run = q(f"select status from {RU} where thread_id=? order by ordinal desc limit 1", (tid,))
    pend = q(f"select count(*) from {RQ} where thread_id=? and status='pending'", (tid,))[0][0]
    print(f"\nTHREAD {title} [{proj}] id {tid}\ncreated {loc(c)} | updated {loc(u)} | last run {last_run[0][0] if last_run else '-'} | runs {dict(runs)} | pending requests {pend}")
    wt = pj.get("worktreePath") or root
    def git(*a):
        try: return subprocess.run(["git", "-C", wt, *a], capture_output=True, text=True, timeout=15).stdout.strip()
        except Exception: return ""
    if wt and os.path.isdir(wt):
        st = git("status", "--porcelain")
        print(f"workdir {flat(wt, 200)}\nbranch {pj.get('branch') or git('rev-parse','--abbrev-ref','HEAD')} | remote {git('remote','get-url','origin') or 'none'} | head {git('log','-1','--format=%h %s')} | uncommitted files {len(st.splitlines()) if st else 0}")
        for n in ("AGENTS.md", "CLAUDE.md"):
            f = os.path.join(wt, n); print(f"{n}: {'exists, ' + str(os.path.getsize(f)) + ' bytes' if os.path.exists(f) else 'missing'}")
    first = q(f"select coalesce(json_extract(payload_json,'$.text'),'') from {MS} where thread_id=? and role='user' order by created_at limit 1", (tid,))
    print("\nGOAL (first user message):", flat(first[0][0] if first else "", 1500))
    for role, at, text in reversed(q(f"select role, created_at, coalesce(json_extract(payload_json,'$.text'),'') from {MS} where thread_id=? order by created_at desc limit ?", (tid, int(os.environ.get("T3_LAST", "8"))))):
        print(f"\n[{role} {loc(at)}] {flat(text, 900)}")

def projects():  # T3 projects with folder, thread count and last activity; also guesses the common projects folder
    rows = q(f"""select p.title, p.workspace_root, count(t.thread_id), max(t.updated_at) from projection_projects p
     left join {TH} t on t.project_id=p.project_id and t.deleted_at is null where p.deleted_at is null group by p.project_id order by max(t.updated_at) desc""")
    print(f"{len(rows)} T3 project(s)")
    for title, root, n, last in rows: print(f"- {title} | {tilde(root or '-')} | {n} thread(s) | last {loc(last) if last else '-'}")
    parents = {}
    for _, root, _, _ in rows:
        if root: par = os.path.dirname(os.path.normpath(root)); parents[par] = parents.get(par, 0) + 1
    if parents:
        top = max(parents.items(), key=lambda x: x[1])
        if top[1] >= 2 or len(rows) == 1: print("projects folder guess:", tilde(top[0]))

def health():
    import socket, subprocess, shutil, platform
    OS = platform.system()
    def sh(cmd):
        try: return subprocess.run(cmd, capture_output=True, text=True, timeout=20, shell=isinstance(cmd, str)).stdout
        except Exception as e: return ""
    rt = {}
    try: rt = json.load(open(os.path.join(D, "server-runtime.json"), encoding="utf-8"))
    except Exception: pass
    host, port, pid = rt.get("host"), rt.get("port"), rt.get("pid")   # only these keys are read
    alive = False
    if pid:
        alive = str(pid) in sh(["tasklist", "/FI", f"PID eq {pid}", "/NH"]) if OS == "Windows" else bool(sh(["ps", "-p", str(pid), "-o", "pid="]).strip())
    listen = False
    if port:
        try: socket.create_connection(("127.0.0.1", int(port)), 1).close(); listen = True
        except Exception: pass
    binds = set()
    if port:
        out = sh(["netstat", "-ano", "-p", "TCP"]) if OS == "Windows" else sh(f"lsof -nP -iTCP:{port} -sTCP:LISTEN 2>/dev/null || ss -ltn 2>/dev/null || netstat -an 2>/dev/null")
        for line in out.splitlines():
            if f":{port}" in line and "LISTEN" in line.upper():
                for tok in line.split():
                    if tok.endswith(f":{port}") or tok.endswith(f".{port}"): binds.add(tok)
    state = "running" if listen else "process alive but port not reachable" if alive else "not running"
    print(f"T3 server: {state} (pid {pid}) | port {port} reachable: {listen} | runtime file host {host}")
    print("listening on:", ", ".join(sorted(binds)) or "none found")
    if any(b.startswith(("0.0.0.0", "*", "[::]", "::")) for b in binds) or host in ("0.0.0.0", "::"):
        print("WARNING: T3 is bound to all interfaces, so anyone on the same network can reach it. Bind to 127.0.0.1 unless you need remote access.")
    for tid, title, st, at, upd in q(f"select r.thread_id, t.title, {RUNST}, r.requested_at, t.updated_at from {RU} r join {TH} t using(thread_id) where r.status in ('queued','preparing','starting','running','waiting') order by r.requested_at"):
        h = ago_h(at); quiet = ago_h(upd)
        if st == "queue held": print(f"queue held: {title} | a message has waited {h:.1f}h for someone to resume or cancel it"); continue  # stuck = live over 1h AND no thread activity for 30+ min
        print(f"{'STUCK? ' if h > 1 and quiet > 0.5 else ''}live run: {title} | {st} for {h:.1f}h, last activity {quiet*60:.0f} min ago")
    for title, kind, at in q(f"select t.title, x.kind, x.created_at from {RQ} x join {TH} t using(thread_id) where x.status='pending'"):
        print(f"pending {kind}: {title} since {loc(at)}" + (" (stale >24h)" if ago_h(at) > 24 else ""))
    tot = 0
    for root, dirs, files in os.walk(D):
        dirs[:] = [d for d in dirs if d != "secrets" and not any(k in d.lower() for k in ("token", "auth"))]
        for f in files:
            if any(k in f.lower() for k in ("token", "auth")): continue
            try: tot += os.path.getsize(os.path.join(root, f))
            except OSError: pass
    print(f"T3 data folder: {tot/1e9:.2f} GB (secret and token files skipped)")
    du = shutil.disk_usage(os.path.expanduser("~")); print(f"disk: {du.free/1e9:.0f} GB free of {du.total/1e9:.0f} GB ({du.used/du.total*100:.0f}% used; on macOS trust Settings/diskutil for total used)")
    if OS == "Darwin":
        mem = int(sh(["sysctl", "-n", "hw.memsize"]).strip() or 0); vm = sh(["vm_stat"]); pg = 16384 if "16384" in (vm.splitlines() or [""])[0] else 4096
        g = lambda k: int(next((l.split(":")[1].strip(" .") for l in vm.splitlines() if l.startswith(k)), "0") or 0)
        avail = (g("Pages free") + g("Pages inactive") + g("Pages speculative") + g("Pages purgeable")) * pg
        print(f"memory: ~{avail/1e9:.1f} GB available of {mem/1e9:.0f} GB | pressure: {sh('memory_pressure 2>/dev/null | tail -1').strip()}")
        print("load avg:", os.getloadavg(), "cores", os.cpu_count())
    elif OS == "Windows":
        import ctypes
        class M(ctypes.Structure): _fields_ = [("l", ctypes.c_ulong), ("load", ctypes.c_ulong)] + [(n, ctypes.c_ulonglong) for n in ("tot", "av", "tp", "ap", "tv", "avv", "ext")]
        m = M(); m.l = ctypes.sizeof(M); ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))
        print(f"memory: {m.av/1e9:.1f} GB available of {m.tot/1e9:.0f} GB ({m.load}% used)")
        print("cpu load %:", sh(["powershell", "-NoProfile", "-Command", "(Get-CimInstance Win32_Processor | Measure-Object LoadPercentage -Average).Average"]).strip(), "| cores", os.cpu_count())
    else:
        mi = dict(l.split(":", 1) for l in open("/proc/meminfo")); kb = lambda k: int(mi[k].split()[0]) * 1024
        print(f"memory: {kb('MemAvailable')/1e9:.1f} GB available of {kb('MemTotal')/1e9:.0f} GB"); print("load avg:", os.getloadavg(), "cores", os.cpu_count())

def usage():
    import glob, collections
    DAYS = int(os.environ.get("T3_DAYS", "7"))
    caches = sorted(glob.glob(os.path.join(D, "usage-scan-cache*.json")), key=lambda p: int("".join(c for c in os.path.basename(p) if c.isdigit()) or 0))  # v5 > v4 > unversioned
    if not caches: print("NO_USAGE_CACHE in", tilde(D), "- open T3's Usage view once so it builds the cache."); sys.exit(0)
    src = caches[-1]; u = json.load(open(src, encoding="utf-8"))
    try: rates = json.load(open(os.path.join(D, "usage-model-rates.json"), encoding="utf-8")).get("document", {})
    except Exception: rates = {}
    print("cache updated", dt.datetime.fromtimestamp(os.path.getmtime(src)).strftime("%b %d %H:%M"), "| files:", os.path.basename(src), "+", "usage-model-rates.json" if rates else "(no rates file - costs unavailable)")
    models = u.get("models", []); cut = (dt.datetime.now() - dt.timedelta(days=DAYS)).timestamp() * 1000
    if os.environ.get("T3_WEEK") == "1":  # calendar week, Monday 00:00 local
        n = dt.datetime.now(); cut = (n - dt.timedelta(days=n.weekday())).replace(hour=0, minute=0, second=0, microsecond=0).timestamp() * 1000; DAYS = "this week,"
    def rate(m, prov):
        for k in (m, f"{prov}/{m}", m.split("@")[0], "-".join(m.split("-")[:-1])):
            if k in rates and "input_cost_per_token" in rates[k]: return rates[k]
    seen = set(); agg = {k: collections.defaultdict(lambda: [0, 0, 0, 0, 0.0]) for k in ("model", "provider", "day")}; unpriced = collections.Counter()
    for path, f in u.get("files", {}).items():
        prov = f.get("p", "?")
        for r in (f.get("r") or []) + (f.get("t") or []):
            ts, mi, _, inp, cr, cw, out = r[:7]; key = r[8] if len(r) > 8 else None
            if ts < cut: continue
            if key:
                if key in seen: continue
                seen.add(key)
            m = models[mi] if isinstance(mi, int) and mi < len(models) else str(mi)
            if m == "<synthetic>": continue
            rep = r[9] if len(r) > 9 else None; spd = r[10] if len(r) > 10 else 0
            rt = rate(m, prov); cost = 0.0
            if isinstance(rep, (int, float)): cost = rep
            elif rt:
                cost = inp * rt.get("input_cost_per_token", 0) + cr * rt.get("cache_read_input_token_cost", rt.get("input_cost_per_token", 0)) + cw * rt.get("cache_creation_input_token_cost", rt.get("input_cost_per_token", 0)) + out * rt.get("output_cost_per_token", 0)
                if spd == 1: cost *= (rt.get("provider_specific_entry") or {}).get("fast", 1)
            else: unpriced[m] += inp + cr + cw + out
            day = dt.datetime.fromtimestamp(ts / 1000).strftime("%Y-%m-%d %a")
            for k, v in (("model", m), ("provider", prov), ("day", day)):
                a = agg[k][v]; a[0] += inp; a[1] += cr; a[2] += cw; a[3] += out; a[4] += cost
    T = lambda n: f"{n/1e6:.1f}M"
    tot = [sum(a[i] for a in agg["provider"].values()) for i in range(5)]
    print(f"{DAYS if isinstance(DAYS, str) else f'last {DAYS} days,'} all figures ESTIMATES: {T(sum(tot[:4]))} tokens (input {T(tot[0])}, cache read {T(tot[1])}, cache write {T(tot[2])}, output {T(tot[3])}) ≈ ${tot[4]:,.2f}")
    for k in ("provider", "model", "day"):
        items = sorted(agg[k].items(), key=(lambda x: x[0]) if k == "day" else (lambda x: -x[1][4]))
        print(f"\nby {k}:"); [print(f"  {n}: {T(sum(a[:4]))} tok ≈ ${a[4]:,.2f}") for n, a in items[:15]]
    if unpriced: print("\nunpriced models (tokens, no rate found):", ", ".join(f"{m} {T(n)}" for m, n in unpriced.most_common(8)))
    print("\nnote: API-list-price estimate; subscriptions (Max/Pro/Plus) do not bill per token.")

CMDS = {"overview": overview, "waiting": waiting, "thread": thread, "projects": projects, "health": health, "usage": usage}
try: CMDS[CMD]()
except sqlite3.OperationalError as e:
    msg = str(e)
    if "locked" in msg or "busy" in msg: print("T3_DB_BUSY: T3's database is busy; try again in a few seconds.")
    else: print("T3_SCHEMA_CHANGED:", msg, "- this T3 Code version stores data differently; update the T3 Tots tools or report it.")
except KeyboardInterrupt: pass
