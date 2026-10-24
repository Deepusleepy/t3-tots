#!/usr/bin/env python3
"""Interactive, offline cleanup report generator.

usage: make_report.py plan.json out.html

Plan JSON schema:
{
  "title": str, "machine": str, "date": "YYYY-MM-DD",
  "drives": [{"machine": str, "name": "C:", "total_bytes": int, "used_bytes": int}],
  "notes": [str],                       # optional, shown at the top
  "items": [{
    "id": str (unique, short, e.g. "a1"), "name": str, "path": str, "machine": str,
    "size_bytes": int, "category": str,
    "risk": "safe"|"probably-safe"|"ask"|"keep",
    "confidence": int 0-100,
    "what_it_is": str, "where_from": str, "what_to_know": str,
    "command": str,
    "action": str (optional, default "delete"; e.g. prune, move-to-E, uninstall, run-as-admin, keep),
    "status": "done" (optional: already cleared, shown greyed and not selectable),
    "drive": str (optional; else guessed from path: "E:\\.." -> E:, "/Volumes/X" etc. -> first drive)
  }]
}

Copy output (parse with the regex in SKILL.md):
  Cleanup picks for <machine>, <date>, total <X.XX> GB
  - <id> | <path> | <X.XX> GB | <action>
  END PICKS (<n> items)
"""
import json, sys, html, re

RISK = {"safe": ("Safe", "#22c55e"), "probably-safe": ("Probably safe", "#eab308"),
        "ask": ("Ask me first", "#f97316"), "keep": ("Keep", "#9ca3af")}

def guess_drive(item, drives):
    if item.get("drive"):
        return item["drive"]
    m = re.match(r"^([A-Za-z]:)", item.get("path", ""))
    names = [d["name"] for d in drives if d.get("machine", item.get("machine")) == item.get("machine")] or [d["name"] for d in drives]
    if m and m.group(1).upper() in [n.upper() for n in names]:
        return m.group(1).upper()
    for n in names:  # unix mount prefixes
        if n.startswith("/") and item.get("path", "").startswith(n.rstrip("/") + "/"):
            return n
    return names[0] if names else ""

def main(src, out):
    plan = json.load(open(src, encoding="utf-8"))
    drives = plan.get("drives", [])
    ids = set()
    for it in plan["items"]:
        assert it["id"] not in ids, "duplicate id " + it["id"]; ids.add(it["id"])
        assert it["risk"] in RISK, it["risk"]
        it.setdefault("action", "keep" if it["risk"] == "keep" else "delete")
        it["drive"] = guess_drive(it, drives)
    for d in drives:
        d["reclaimable_bytes"] = sum(i["size_bytes"] for i in plan["items"]
            if i["drive"] == d["name"] and i.get("machine") == d.get("machine", i.get("machine"))
            and i["risk"] != "keep" and i.get("status") != "done")
    data = json.dumps(plan).replace("</", "<\\/")
    page = TEMPLATE.replace("__TITLE__", html.escape(plan.get("title", "Cleanup plan"))).replace("__DATA__", data)
    open(out, "w", encoding="utf-8").write(page)
    print("wrote", out, len(plan["items"]), "items")

TEMPLATE = r"""<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>__TITLE__</title>
<style>
:root{--bg:#0f1115;--card:#181b22;--card2:#1f232c;--fg:#e8eaf0;--mut:#9aa1b1;--bd:#2a2f3a;--acc:#6366f1;
--safe:#22c55e;--prob:#eab308;--ask:#f97316;--keep:#9ca3af;--used:#64748b;--free:#334155}
[data-theme=light]{--bg:#f5f6f8;--card:#fff;--card2:#f0f2f5;--fg:#111827;--mut:#5b6474;--bd:#e3e6ec;--used:#94a3b8;--free:#e2e8f0}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg)}
header{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(8px);border-bottom:1px solid var(--bd);padding:12px 24px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
header h1{font-size:18px;margin:0;flex:1}#counter{font-weight:600}#counter b{color:var(--acc)}
button{font:inherit;border:1px solid var(--bd);background:var(--card2);color:var(--fg);border-radius:8px;padding:6px 12px;cursor:pointer}
button:hover{border-color:var(--acc)}#copy{background:var(--acc);color:#fff;border:0;padding:10px 20px;font-weight:700;font-size:16px}
main{max-width:1100px;margin:0 auto;padding:20px 24px 80px}
.panel{background:var(--card);border:1px solid var(--bd);border-radius:14px;padding:16px 18px;margin-bottom:18px}
.panel h2{margin:0 0 10px;font-size:16px}.mut{color:var(--mut);font-size:13px}
.bar{display:flex;height:22px;border-radius:6px;overflow:hidden;background:var(--free);margin:6px 0}
.bar>div{height:100%}.legend{display:flex;gap:14px;flex-wrap:wrap;font-size:13px;color:var(--mut)}
.dot{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:middle}
.catrow{display:grid;grid-template-columns:200px 1fr 80px;gap:10px;align-items:center;margin:5px 0;font-size:14px}
.catrow .bar{height:18px;margin:0;background:transparent}
.filters{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.filters .on{background:var(--acc);color:#fff;border-color:var(--acc)}
details.sec{background:var(--card);border:1px solid var(--bd);border-radius:14px;margin-bottom:14px}
details.sec>summary{cursor:pointer;padding:14px 18px;font-weight:700;display:flex;gap:10px;align-items:center;list-style:none}
details.sec>summary::before{content:"▸";transition:.2s}details.sec[open]>summary::before{transform:rotate(90deg)}
summary .sz{margin-left:auto;color:var(--mut);font-weight:500}
.cards{padding:0 14px 14px;display:grid;gap:10px}
.card{background:var(--card2);border:1px solid var(--bd);border-left:5px solid var(--c);border-radius:10px;padding:12px 14px;display:grid;grid-template-columns:28px 1fr auto;gap:4px 12px}
.card.sel{outline:2px solid var(--acc)}.card.done,.card.keep{opacity:.6}
.card input{width:20px;height:20px;margin-top:2px;accent-color:var(--acc)}
.card .t{font-weight:650}.card .size{font-weight:700;font-size:17px;text-align:right}
.pill{display:inline-block;font-size:12px;font-weight:700;padding:1px 9px;border-radius:999px;color:#111;background:var(--c);margin-left:8px;vertical-align:middle}
.pill.done{background:var(--acc);color:#fff}
.body{grid-column:2/4;font-size:14px}.body p{margin:3px 0}.body .lab{color:var(--mut);font-weight:600}
.path{font-family:ui-monospace,Consolas,monospace;font-size:12px;color:var(--mut);word-break:break-all}
.meter{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--mut)}.meter i{display:block;width:80px;height:6px;border-radius:3px;background:var(--bd);overflow:hidden}.meter i b{display:block;height:100%;background:var(--acc)}
details.cmd summary{cursor:pointer;color:var(--acc);font-size:13px}details.cmd pre{background:var(--bg);border:1px solid var(--bd);border-radius:8px;padding:8px;white-space:pre-wrap;font-size:12px;margin:6px 0 0}
#toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--safe);color:#04210f;font-weight:700;padding:10px 22px;border-radius:999px;opacity:0;transition:.3s;pointer-events:none}#toast.show{opacity:1}
textarea{width:100%;min-height:140px;background:var(--bg);color:var(--fg);border:1px solid var(--bd);border-radius:8px;font:12px ui-monospace,Consolas,monospace;padding:8px}
.hidden{display:none!important}
</style></head><body>
<header><h1 id="ttl"></h1><span id="counter">Selected: <b>0 items, 0.00 GB</b></span>
<button id="theme" title="Switch dark/light">◐ Theme</button><button id="copy">Copy my picks</button></header>
<main>
<div class="panel"><h2>Your drives</h2><div id="drives"></div>
<div class="legend"><span><span class="dot" style="background:var(--used)"></span>Used</span><span><span class="dot" style="background:var(--safe)"></span>Could be freed</span><span><span class="dot" style="background:var(--free)"></span>Free</span></div>
<div id="notes" class="mut"></div></div>
<div class="panel"><h2>Where the space is, by area</h2><div id="cats"></div>
<div class="legend" id="rlegend"></div></div>
<div class="panel"><div class="filters"><span class="mut">Show:</span><span id="fr"></span><span id="fm"></span>
<span class="mut" style="margin-left:auto">Sort:</span><button id="sort">Biggest first</button><button id="clear">Clear picks</button></div>
<p class="mut" style="margin:10px 0 0">Tick what you want gone, then press <b>Copy my picks</b> and paste it back in chat. Nothing is deleted until you do. Grey "Keep" items can't be picked.</p></div>
<div id="secs"></div>
<div class="panel"><h2>Your picks (copy from here if the button doesn't work)</h2><textarea id="out" readonly></textarea></div>
</main><div id="toast">Copied!</div>
<script>
const P=__DATA__;const RISK={"safe":["Safe","var(--safe)"],"probably-safe":["Probably safe","var(--prob)"],"ask":["Ask me first","var(--ask)"],"keep":["Keep","var(--keep)"]};
const GB=b=>(b/1e9).toFixed(2);const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const sel=new Set();let fRisk=new Set(Object.keys(RISK)),fMach=new Set(P.items.map(i=>i.machine)),desc=true;
const pickable=i=>i.risk!=="keep"&&i.status!=="done";
document.getElementById("ttl").textContent=P.title+" · "+P.date;
document.getElementById("drives").innerHTML=(P.drives||[]).map(d=>{const t=d.total_bytes,u=d.used_bytes,r=Math.min(d.reclaimable_bytes||0,u);
return `<div style="margin:8px 0"><b>${esc(d.machine)} ${esc(d.name)}</b> <span class="mut">${GB(u)} GB used of ${GB(t)} GB · ${GB(t-u)} GB free · up to ${GB(r)} GB could be freed</span>
<div class="bar"><div style="width:${(u-r)/t*100}%;background:var(--used)"></div><div style="width:${r/t*100}%;background:var(--safe)" title="could be freed"></div></div></div>`}).join("");
document.getElementById("notes").innerHTML=(P.notes||[]).map(n=>"• "+esc(n)).join("<br>");
const cats=[...new Set(P.items.map(i=>i.category))];
const catSize=c=>P.items.filter(i=>i.category===c).reduce((a,i)=>a+i.size_bytes,0);const maxC=Math.max(...cats.map(catSize),1);
document.getElementById("cats").innerHTML=cats.map(c=>{const segs=Object.keys(RISK).map(r=>{const s=P.items.filter(i=>i.category===c&&i.risk===r&&i.status!=="done").reduce((a,i)=>a+i.size_bytes,0);
return s?`<div title="${RISK[r][0]}: ${GB(s)} GB" style="width:${s/maxC*100}%;background:${RISK[r][1]}"></div>`:""}).join("");
const dn=P.items.filter(i=>i.category===c&&i.status==="done").reduce((a,i)=>a+i.size_bytes,0);
return `<div class="catrow"><span>${esc(c)}</span><div class="bar">${segs}${dn?`<div title="Already done: ${GB(dn)} GB" style="width:${dn/maxC*100}%;background:var(--acc)"></div>`:""}</div><span class="mut">${GB(catSize(c))} GB</span></div>`}).join("");
document.getElementById("rlegend").innerHTML=Object.values(RISK).map(r=>`<span><span class="dot" style="background:${r[1]}"></span>${r[0]}</span>`).join("")+`<span><span class="dot" style="background:var(--acc)"></span>Already done</span>`;
const fb=(el,vals,set,lab)=>{document.getElementById(el).innerHTML=vals.map(v=>`<button data-v="${esc(v)}" class="on">${esc(lab(v))}</button>`).join(" ");
document.querySelectorAll("#"+el+" button").forEach(b=>b.onclick=()=>{const v=b.dataset.v;set.has(v)?set.delete(v):set.add(v);b.classList.toggle("on");render()})};
fb("fr",Object.keys(RISK),fRisk,v=>RISK[v][0]);fb("fm",[...fMach],fMach,v=>v);
function card(i){const[rl,rc]=RISK[i.risk];const done=i.status==="done";
return `<div class="card ${done?"done":""} ${i.risk==="keep"?"keep":""} ${sel.has(i.id)?"sel":""}" style="--c:${done?"var(--acc)":rc}">
<input type="checkbox" data-id="${esc(i.id)}" ${sel.has(i.id)?"checked":""} ${pickable(i)?"":"disabled"} aria-label="pick ${esc(i.name)}">
<div><span class="t">${esc(i.name)}</span>${done?'<span class="pill done">Done ✓</span>':`<span class="pill">${rl}</span>`}
<div class="path">${esc(i.machine)} · ${esc(i.path)}</div></div>
<div class="size">${GB(i.size_bytes)} GB<br><span class="meter" title="How sure I am">sure <i><b style="width:${i.confidence}%"></b></i>${i.confidence}%</span></div>
<div class="body"><p>${esc(i.what_it_is)}</p><p><span class="lab">Came from:</span> ${esc(i.where_from)}</p>
<p><span class="lab">Know before deleting:</span> ${esc(i.what_to_know)}</p>
${i.command?`<details class="cmd"><summary>Show the command (${esc(i.action)})</summary><pre>${esc(i.command)}</pre></details>`:""}</div></div>`}
function render(){const h=cats.map(c=>{let its=P.items.filter(i=>i.category===c&&fRisk.has(i.risk)&&fMach.has(i.machine));
its.sort((a,b)=>desc?b.size_bytes-a.size_bytes:a.size_bytes-b.size_bytes);if(!its.length)return"";
const open=document.querySelector(`details.sec[data-c="${CSS.escape(c)}"]`);const isOpen=open?open.open:true;
return `<details class="sec" data-c="${esc(c)}" ${isOpen?"open":""}><summary>${esc(c)} <button class="sa" data-c="${esc(c)}">Select all safe</button><span class="sz">${GB(its.reduce((a,i)=>a+i.size_bytes,0))} GB · ${its.length} items</span></summary><div class="cards">${its.map(card).join("")}</div></details>`}).join("");
document.getElementById("secs").innerHTML=h;
document.querySelectorAll(".card input").forEach(x=>x.onchange=()=>{x.checked?sel.add(x.dataset.id):sel.delete(x.dataset.id);render()});
document.querySelectorAll(".sa").forEach(b=>b.onclick=e=>{e.preventDefault();P.items.filter(i=>i.category===b.dataset.c&&i.risk==="safe"&&pickable(i)&&fMach.has(i.machine)).forEach(i=>sel.add(i.id));render()});
update()}
function picksText(){const its=P.items.filter(i=>sel.has(i.id));const tot=its.reduce((a,i)=>a+i.size_bytes,0);
const ms=[...new Set(its.map(i=>i.machine))].join(" + ")||P.machine;
return [`Cleanup picks for ${ms}, ${P.date}, total ${GB(tot)} GB`,...its.map(i=>`- ${i.id} | ${i.path} | ${GB(i.size_bytes)} GB | ${i.action}`),`END PICKS (${its.length} items)`].join("\n")}
function update(){const its=P.items.filter(i=>sel.has(i.id));document.querySelector("#counter b").textContent=`${its.length} items, ${GB(its.reduce((a,i)=>a+i.size_bytes,0))} GB`;document.getElementById("out").value=picksText()}
document.getElementById("sort").onclick=e=>{desc=!desc;e.target.textContent=desc?"Biggest first":"Smallest first";render()};
document.getElementById("clear").onclick=()=>{sel.clear();render()};
document.getElementById("theme").onclick=()=>{const r=document.documentElement;r.dataset.theme=r.dataset.theme==="dark"?"light":"dark"};
if(matchMedia("(prefers-color-scheme: light)").matches)document.documentElement.dataset.theme="light";
function toast(t){const e=document.getElementById("toast");e.textContent=t;e.classList.add("show");setTimeout(()=>e.classList.remove("show"),1800)}
document.getElementById("copy").onclick=async()=>{const t=picksText();const ta=document.getElementById("out");ta.value=t;
try{await navigator.clipboard.writeText(t);toast("Copied!")}catch(_){ta.focus();ta.select();let ok=false;try{ok=document.execCommand("copy")}catch(_){}
toast(ok?"Copied!":"Select the text box below and copy it");ta.scrollIntoView({behavior:"smooth"})}};
window.__picksText=picksText;window.__select=ids=>{ids.forEach(i=>{const it=P.items.find(x=>x.id===i);if(it&&pickable(it))sel.add(i)});render()};
render();
</script></body></html>"""

if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
