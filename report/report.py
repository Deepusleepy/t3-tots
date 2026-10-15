#!/usr/bin/env python3
"""report.py <export.json> <out.html> [--tz <IANA zone, e.g. Europe/London>] : self-contained HTML report from t3-tots export.js output."""
import json, sys, html, re, collections, datetime as dt
if len(sys.argv) < 3: sys.exit("usage: report.py <export.json> <out.html> [--tz <IANA zone>]  (Python 3.9+)")
src, dst = sys.argv[1], sys.argv[2]
try:
    from zoneinfo import ZoneInfo
    tz = ZoneInfo(sys.argv[sys.argv.index("--tz")+1]) if "--tz" in sys.argv else dt.timezone.utc
except Exception as e:  # Python <3.9, unknown zone, or no tz database (Windows without the tzdata package)
    print("note: timezone unavailable (", e, ") - using UTC"); tz = dt.timezone.utc
d = json.load(open(src, encoding="utf-8"))
E = lambda s: html.escape(str(s or ""))
def T(s, f="%b %d, %H:%M"):
    try: return dt.datetime.fromisoformat(s.replace("Z","+00:00")).astimezone(tz).strftime(f)
    except Exception: return s or "-"
def md(s):  # tiny, safe markdown-ish: code, bold, line breaks
    s = E(s); s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s); s = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", s)
    return s.replace("\n", "<br>")
ths = d["threads"]; user = [t for t in ths if not t["spawned"]]; spawned = [t for t in ths if t["spawned"]]
user.sort(key=lambda t: t["updatedAt"], reverse=True)
def asks(t):
    a = [m for m in t["conversation"] if m["role"]=="assistant"]
    return bool(a) and a[-1]["text"].rstrip(" *_`)").endswith("?")
waiting = [t for t in user if t["pendingRequest"] or t["actionablePlan"] or t["lastError"] or (not t["settled"] and asks(t))]
running = [t for t in ths if t["status"] in ("running","starting","queued","preparing")]
open_ = [t for t in user if not t["settled"] and t not in waiting]
files = collections.Counter()
for t in ths:
    for f in t["files"]: files[f["file"]] += f["edits"]
models = collections.Counter(f'{t["model"]}{" · "+t["effort"] if t["effort"] else ""}' for t in user)
byday = collections.defaultdict(list)
for t in user: byday[T(t["updatedAt"], "%a %b %d")].append(t)
proj = ", ".join(p["title"] for p in d["projects"])
tz_label = dt.datetime.now(tz).strftime("%Z") or "local"
def badge(t):
    b = []
    if t["status"] in ("running","starting","queued"): b.append('<span class="b run">running</span>')
    if t["pendingRequest"]: b.append('<span class="b warn">needs approval</span>')
    if t["actionablePlan"]: b.append('<span class="b warn">plan ready</span>')
    if t["lastError"]: b.append('<span class="b err">error</span>')
    if t in waiting and not b: b.append('<span class="b warn">asked you</span>')
    b.append('<span class="b ok">settled</span>' if t["settled"] else '<span class="b">open</span>')
    return " ".join(b)
def card(t):
    conv = "".join(f'<div class="m {m["role"]}"><span class="who">{"You" if m["role"]=="user" else ("" if m["role"]=="gap" else "Agent")}</span>{md(m["text"])}</div>' for m in t["conversation"])
    fl = "".join(f"<li><code>{E(f['file'])}</code></li>" for f in t["files"][:15]) + (f"<li>… {len(t['files'])-15} more</li>" if len(t["files"])>15 else "")
    return f'''<details class="card"><summary><span class="t">{E(t["title"])}</span> {badge(t)}<span class="meta">{T(t["updatedAt"])} · {E(t["model"])}{" · "+E(t["effort"]) if t["effort"] else ""} · {t["runs"]} turns · {t["commands"]} cmds · {len(t["files"])} files</span></summary>
<div class="body">{f'<p class="err">Last error: {E(t["lastError"])}</p>' if t["lastError"] else ""}{conv}{f"<h4>Files changed</h4><ul>{fl}</ul>" if fl else ""}</div></details>'''
def lst(ts, empty): return "".join(f'<li><b>{E(t["title"])}</b> {badge(t)} <span class="meta">{T(t["updatedAt"])}</span></li>' for t in ts) or f"<li class='meta'>{empty}</li>"
stat = lambda n, l: f'<div class="stat"><div class="n">{n}</div><div class="l">{l}</div></div>'
page = f'''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{E(proj)} · T3 report</title>
<style>
:root{{--bg:#0f1115;--card:#171a21;--line:#262a33;--fg:#e7e9ee;--mut:#8b93a3;--acc:#7aa2ff;--ok:#3fb27f;--warn:#e0a63a;--err:#e5534b}}
@media (prefers-color-scheme:light){{:root{{--bg:#f6f7f9;--card:#fff;--line:#e3e6eb;--fg:#1b1f27;--mut:#6a7282}}}}
*{{box-sizing:border-box}}body{{margin:0;font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;background:var(--bg);color:var(--fg)}}
main{{max-width:960px;margin:0 auto;padding:32px 20px 60px}}h1{{margin:0 0 4px;font-size:28px}}h2{{margin:34px 0 12px;font-size:18px}}h4{{margin:14px 0 6px;font-size:13px;color:var(--mut)}}
.meta{{color:var(--mut);font-size:13px}}.stats{{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:20px 0}}
.stat{{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px}}.n{{font-size:24px;font-weight:700}}.l{{color:var(--mut);font-size:12px}}
.card{{background:var(--card);border:1px solid var(--line);border-radius:12px;margin:8px 0}}summary{{cursor:pointer;padding:12px 14px;list-style:none}}summary::-webkit-details-marker{{display:none}}
summary .t{{font-weight:600;margin-right:6px}}summary .meta{{display:block;margin-top:2px}}.body{{padding:0 14px 14px;border-top:1px solid var(--line)}}
.m{{margin:10px 0;padding:10px 12px;border-radius:10px;background:rgba(127,127,127,.08);overflow-wrap:anywhere}}.m.user{{border-left:3px solid var(--acc)}}.m.gap{{background:none;color:var(--mut);text-align:center;font-size:12px}}
.who{{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);margin-bottom:2px}}
.b{{display:inline-block;font-size:11px;padding:1px 7px;border-radius:99px;border:1px solid var(--line);color:var(--mut);vertical-align:middle}}
.b.ok{{color:var(--ok);border-color:var(--ok)}}.b.warn{{color:var(--warn);border-color:var(--warn)}}.b.err,.err{{color:var(--err);border-color:var(--err)}}.b.run{{color:var(--acc);border-color:var(--acc)}}
code{{font:12.5px ui-monospace,Menlo,monospace;background:rgba(127,127,127,.15);padding:1px 4px;border-radius:4px}}ul{{padding-left:20px}}li{{margin:4px 0}}
.bars div{{display:flex;align-items:center;gap:8px;margin:4px 0;font-size:13px}}.bars span.bar{{height:8px;background:var(--acc);border-radius:4px}}
</style></head><body><main>
<h1>What's going on in {E(proj)}</h1><div class="meta">Last {d["days"]} days · {E(d["computer"])} · generated {T(d["generatedAt"])} {tz_label} · by T3 Tots</div>
<div class="stats">{stat(len(user),"threads you started")}{stat(len(spawned),"subagent threads")}{stat(sum(t["runs"] for t in ths),"turns")}{stat(len(files),"files touched")}{stat(len(waiting),"waiting on you")}{stat(len(running),"running now")}</div>
<h2>Needs you</h2><ul>{lst(waiting,"Nothing is waiting on you.")}</ul>
<h2>Running now</h2><ul>{lst(running,"Nothing is running.")}</ul>
<h2>Still open (not settled)</h2><ul>{lst(open_,"Everything is settled.")}</ul>
<h2>Timeline</h2>{"".join(f"<h4>{E(day)}</h4>"+"".join(card(t) for t in ts) for day, ts in byday.items())}
<h2>Most-edited files</h2><ul>{"".join(f"<li><code>{E(f)}</code> <span class='meta'>×{n}</span></li>" for f,n in files.most_common(20)) or "<li class='meta'>No file edits recorded (non-git projects only show edits made with the edit tool).</li>"}</ul>
<h2>Models used</h2><div class="bars">{"".join(f'<div><span class="bar" style="width:{max(6,int(220*n/max(models.values())))}px"></span>{E(m)} <span class="meta">{n}</span></div>' for m,n in models.most_common(10))}</div>
</main></body></html>'''
open(dst, "w", encoding="utf-8").write(page); print("wrote", dst, len(user), "threads,", len(waiting), "waiting")
