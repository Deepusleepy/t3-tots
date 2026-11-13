---
name: t3-install-tools
description: >-
  Install, check or update T3 Tots: its helper scripts (t3q.py, t3ctl, t3listen, export/survey, t3ui, cleanup and report helpers) from the pinned, sha256-verified GitHub release onto the box and the user's T3 computers, and the live t3-* skills from the same release. Use for "update T3 Tots", "update T3 Tots tools", "update my T3 Tots skills", "what's new in T3 Tots", the T3 Tots weekly update routine, during setup, or when a skill says the tools are missing or differ. Not for updating T3 Code or dev tools (t3-update).
---

Follow the t3-tots-rules skill (skills/t3-tots-rules/SKILL.md). Steps that use the box, ListMachines, routines, cards or SendToUser are Grok Bot only; other agents follow t3-tots-rules "Grok Bot only". The scripts live in the repo github.com/Deepusleepy/t3-tots (MIT). This skill pins release `v1.4.34` by sha256, so a changed repo can't change what gets installed. Any mismatch installs nothing (`HASH_MISMATCH`). The same release also carries the t3-* skills, each listed with its sha256 in that tag's `manifest.json`; "Update T3 Tots" below brings scripts and live skills to one tag with one yes.

The box copy needs no approval. Writing to a user's computer needs their yes; the one setup yes in t3-getting-started covers it. If a computer's t3ctl or t3listen hashes differ from the manifest because someone updated them locally ahead of a release, report that and don't install over them until a release pins them. Never touch the `token` file, `listen.json` or the other data files in the tools folder. Skill sync only reads and writes on the box (`/workspace/t3-tots-skill-sync/`) and changes only skills whose id starts with `t3-`; every other skill is left alone.

## Box copy
Save the fetcher below to `/workspace/t3tots_fetch.py` exactly as written. If it already exists with a different `PIN` or hashes, overwrite it with this one. Then run `python3 /workspace/t3tots_fetch.py box`. It downloads every tool from the pinned tag, verifies each sha256, and puts them in `/workspace/t3-tots-tools/` with the same flat layout as a computer's tools folder (each file at its manifest `dest`, so `tools/windows/t3ctl.cmd` becomes `t3ctl.cmd`). It also writes `manifest.json`, the reference for every other check, and `VERSION`.

If it prints `REPO_PRIVATE_OR_MISSING`, the repo is private or the tag doesn't exist yet; follow "Private repo".

````python
#!/usr/bin/env python3
"""T3 Tots tools fetcher (runs on the box). Commands:
  box [--from DIR]          install the pinned release's tools into /workspace/t3-tots-tools, verify every sha256
  check                     compare with the latest GitHub release (read-only): changed files + notes
  update <tag> [--from DIR] install <tag> on the box, verified against that tag's manifest.json (only after the user's yes)
  skills [tag] [--write [--placeholders]] [--diff ID] [--base TAG] [--from DIR]  compare the tag's skills (default: latest
                            release) with the live Grok Bot skills: new / changed / placeholder / yours (edited by the owner, the
                            release didn't change it) / both (edited by the owner and changed by the release) / unchanged.
                            --write saves verified copies for UpdateSkill in /workspace/t3-tots-skill-sync/<tag>/ and backs up
                            every live copy it may replace; a "yours" skill is never prepared, a "both" skill only as choices
                            for the owner. --placeholders: only the template's short copies. --diff ID: one skill's diff, and
                            for a "both" skill the owner's edit and the release's change. --base TAG: the release the live
                            skills were last in step with, used when none is remembered in bases.json (else the box VERSION)
  rebase ID TAG             after saving a hand-merged skill: its owner's edit now sits on TAG
  hashes <macos|linux|windows>                  'sha256  file' lines for that OS's tools folder (with manifest.json)
  emit <macos|linux|windows> <tools dir> [--gh] print a one-shot install command for that computer (tools, manifest.json, VERSION)
--from DIR reads the files from a folder on the box (a CopyToBox of the release or a checkout at that tag)
instead of downloading; the same hashes are checked. --gh makes the install command download with the
GitHub CLI, which works for a private repo on a computer where `gh auth status` is signed in.
Installs tools only. Live Grok Bot skills are applied by the main agent with UpdateSkill from `skills --write`;
other agents install skills with `t3ctl skills install`. The tools folder stays flat: each file
goes to its manifest `dest` (tools/windows/t3ctl.cmd becomes t3ctl.cmd)."""
import difflib, hashlib, json, os, pathlib, re, shutil, sys, time, urllib.error, urllib.request
REPO = "Deepusleepy/t3-tots"; PIN = "v1.4.34"
PINNED = {
 "tools/t3q.py": ["t3q.py", "01ff4476b33f3623b4e7c36a696e1fcc89f3b6101ef11c464235bc29d1fadc1b"],
 "tools/thread-match.js": ["thread-match.js", "4127b89c1a4235c970e02bf450d227402ed4bf6d98b927e148463c1352918113"],
 "tools/t3ctl": ["t3ctl", "cafd839cb4275f9b69af6d1ab2d33ba158999a01320b9b47db256d36aeb63191"],
 "tools/windows/t3ctl.cmd": ["t3ctl.cmd", "b53d3a36313f6d78c4feeba028823c836b3e64e3b42a5b33ea4a6fe73be30d6e"],
 "tools/t3listen": ["t3listen", "0f1ca1c6f0266b950a451b5bf8120a1e1d969375584c8c804e70c203c5aef2e8"],
 "tools/windows/t3listen.cmd": ["t3listen.cmd", "2a818c7c0471268de6b065ac20e08ff849a6262d07752160ee651a29286abcf5"],
 "tools/export.js": ["export.js", "ac7aed7ed7dd23350b93997b7b1450e7197e4ac72eb50515332fa9054cae6aa0"],
 "tools/survey.js": ["survey.js", "7f9f6725612b20503dd52c8e1871db002ffc54045f0a4a26e70653ae4ad2f42f"],
 "tools/t3ui": ["t3ui", "221951527b7250375dc97ec63fababa09e693b3af0e5ae1132d42aee67f2b23f"],
 "tools/macos/ui-dump.applescript": ["ui-dump.applescript", "c27003dd85b3ff3a67163b598d4afad1c1d09629f8f6ff5370bd1d69f5f16db1"],
 "tools/macos/ui-menuitem.applescript": ["ui-menuitem.applescript", "58280f8b42140398d98481549abb1a99cd5d83457e41cd53553813687732b111"],
 "tools/macos/ui-model.applescript": ["ui-model.applescript", "518c532b196b75ac68268ac7276ce35bed22953958d27730fb61c12317a146ae"],
 "tools/macos/ui-press.applescript": ["ui-press.applescript", "2f53685d1eaac38d3e8b68e33d861d3c4297f57d8b30a56229392ed6a78ff858"],
 "tools/macos/ui-type.applescript": ["ui-type.applescript", "f1ca66a2352ad71fdcd213d11a5eb0ba8668f35511050d66901d542106e44125"],
 "tools/cleanup/scan.py": ["cleanup/scan.py", "a6b6c6d1acdab17a5c504f360423d1dc5196497a2c1fe335da5ce35df0c4eeb9"],
 "tools/cleanup/make_report.py": ["cleanup/make_report.py", "a43ec1beb22c61460df490da170403c755b11431d48dc81ad65d190def9f00ca"],
 "tools/report/report.py": ["report/report.py", "f36cce5f7a06c95a3c2e7ac66ecf06c9b8627c5c0ee803e12845308a2cada84a"]
}
DST = pathlib.Path(os.environ.get("T3TOTS_DST", "/workspace/t3-tots-tools"))
LIVE = pathlib.Path(os.environ.get("T3TOTS_LIVE_SKILLS", "/home" + "/box/agent-data/workflows"))
SYNC = pathlib.Path(os.environ.get("T3TOTS_SKILL_SYNC", "/workspace/t3-tots-skill-sync"))
raw = lambda tag, p: os.environ.get("T3TOTS_RAW_BASE", f"https://raw.githubusercontent.com/{REPO}/{tag}/") + p
sha = lambda b: hashlib.sha256(b).hexdigest()
args = [a for a in sys.argv[1:]]
SRC = None
if "--from" in args:
    i = args.index("--from"); SRC = pathlib.Path(args[i + 1]).expanduser(); del args[i:i + 2]
GH = "--gh" in args
if GH: args.remove("--gh")
def get(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "t3-tots"}), timeout=30) as r: return r.read()
    except urllib.error.HTTPError as e:
        if e.code == 404: sys.exit(f"REPO_PRIVATE_OR_MISSING {url}: HTTP 404 - nothing installed. If the repo is private, "
                                   "use --from <folder> with a copy of the release, or emit --gh")
        sys.exit(f"DOWNLOAD_FAILED {url}: {e} - nothing installed")
    except Exception as e: sys.exit(f"DOWNLOAD_FAILED {url}: {e} - nothing installed")
def fetch(tag, p):
    if SRC is None: return get(raw(tag, p))
    f = SRC / p
    if not f.is_file(): sys.exit(f"MISSING_IN_FROM {f} - nothing installed")
    return f.read_bytes()
def tools(m):  # tool entries with dest; manifests before v1.4.0 have no kind or dest (path is the installed path)
    return [{**f, "dest": f.get("dest", f["path"])} for f in m["files"] if f.get("kind", "tool") == "tool"]
def install_box(tag, mb):
    m = json.loads(mb)
    if m.get("version") != tag: sys.exit(f"MANIFEST_MISMATCH: {tag} manifest says {m.get('version')} - nothing installed")
    want = {f["path"]: [f["dest"], f["sha256"]] for f in tools(m)}
    if tag == PIN and want != PINNED: sys.exit(f"HASH_MISMATCH manifest.json differs from the pinned {PIN} tools - nothing installed")
    got, bad = {}, []
    for p, (d, h) in want.items():
        got[d] = fetch(tag, p)
        if sha(got[d]) != h: bad.append(p)
    if bad: sys.exit("HASH_MISMATCH " + " ".join(bad) + " - nothing installed")
    for d, b in list(got.items()) + [("manifest.json", mb)]:
        f = DST / d; f.parent.mkdir(parents=True, exist_ok=True); t = f.with_name(f.name + ".part"); t.write_bytes(b); os.replace(t, f)
    for d in ("t3ctl", "t3listen", "t3ui"):
        if (DST / d).exists(): os.chmod(DST / d, 0o755)
    (DST / "VERSION").write_text(tag + "\n")
    print(f"OK {tag}: {len(got)} files verified in {DST}" + (f" (from {SRC})" if SRC else ""))
    print('NEXT: open the t3-install-tools skill as it is now (it may have just been updated) and do every check under "After an update". Do not skip this: it holds the changes that are made on the bot side.')
def files(os_):  # this OS's tools, then manifest.json itself (verified by `box`), so computers get it next to VERSION
    if not (DST / "manifest.json").exists(): sys.exit("NO_BOX_COPY: run `box` first")
    mb = (DST / "manifest.json").read_bytes(); m = json.loads(mb)
    return m["version"], [f for f in tools(m) if os_ in f["targets"]] + [{"path": "manifest.json", "dest": "manifest.json", "sha256": sha(mb)}]
def front(t):  # (name, description, body) from a SKILL.md with YAML frontmatter
    m = re.match(r"---\n(.*?)\n---\n?(.*)", t, re.S)
    if not m: return "", "", t
    head, body, name, desc = m.group(1), m.group(2).lstrip("\n"), "", []
    lines = head.split("\n")
    for i, l in enumerate(lines):
        if l.startswith("name:"): name = l[5:].strip().strip("'\"")
        if l.startswith("description:"):
            v = l[12:].strip()
            if v in (">-", ">", "|", "|-"):
                for x in lines[i + 1:]:
                    if x and not x.startswith(" "): break
                    desc.append(x.strip())
            else: desc.append(v.strip("'\""))
    return name, " ".join(w for w in " ".join(desc).split()), body
norm = lambda t: (lambda n, d, b: (n, d, b.strip()))(*front(t))
def latest():
    try:
        with urllib.request.urlopen(urllib.request.Request(f"https://api.github.com/repos/{REPO}/releases/latest", headers={"User-Agent": "t3-tots"}), timeout=30) as r: return json.loads(r.read())
    except urllib.error.HTTPError as e:
        if e.code != 404: sys.exit(f"DOWNLOAD_FAILED releases/latest: {e}")
        sys.exit(f"REPO_PRIVATE_OR_MISSING: the box can't see releases. On a computer where gh is signed in run: "
                 f"gh release view -R {REPO} --json tagName,publishedAt,body")
def pin_fix(t, m, tag):  # make t3-install-tools pin <tag> and its manifest hashes, so the synced skill matches the box
    rows = ",\n".join(f' "{f["path"]}": ["{f["dest"]}", "{f["sha256"]}"]' for f in tools(m))
    t2 = re.sub(r'PIN = "[^"]*"', f'PIN = "{tag}"', t, count=1)
    t2 = re.sub(r"PINNED = \{\n.*?\n\}", lambda _: "PINNED = {\n" + rows + "\n}", t2, count=1, flags=re.S)
    t2 = re.sub(r"pins release `v[0-9][^`]*`", f"pins release `{tag}`", t2)
    return t2
BASES = SYNC / "bases.json"  # which release each live skill was last in step with: {"default": tag, "skills": {id: tag}, "merged": {id: [sha, tag]}}
def bases():
    try: b = json.loads(BASES.read_text("utf-8"))
    except Exception: b = {}
    return {"default": b.get("default"), "skills": dict(b.get("skills") or {}), "merged": dict(b.get("merged") or {})}
def save_bases(b):
    BASES.parent.mkdir(parents=True, exist_ok=True); BASES.write_text(json.dumps(b, indent=1), "utf-8")
def merge3(base, yours, theirs):  # your edit and the release's change in one text, or None when they touch the same lines
    hunks = lambda new: [(i1, i2, new[j1:j2]) for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, base, new, autojunk=False).get_opcodes() if op != "equal"]
    hy, ht = hunks(yours), hunks(theirs)
    if any(a[0] <= c[1] and c[0] <= a[1] for a in hy for c in ht): return None
    out, pos = [], 0
    for i1, i2, new in sorted(hy + ht, key=lambda h: (h[0], h[1])): out += base[pos:i1] + new; pos = i2
    return out + base[pos:]
def rel_skills(tag, src=None):  # the tag's t3-* skills, each verified against that tag's manifest.json, with t3-install-tools pinned to the tag
    rd = (lambda p: (src / p).read_bytes()) if src else (lambda p: fetch(tag, p))
    m = json.loads(rd("manifest.json"))
    if m.get("version") != tag: sys.exit(f"MANIFEST_MISMATCH: {tag} manifest says {m.get('version')} - nothing written")
    rel, bad = {}, []
    for f in [f for f in m["files"] if f.get("kind") == "skill"]:
        sid = f["dest"].split("/")[0]
        if not sid.startswith("t3-") or f["dest"] != sid + "/SKILL.md": continue
        b = rd(f["path"])
        if sha(b) != f["sha256"]: bad.append(f["path"])
        rel[sid] = b.decode("utf-8")
    if bad: sys.exit("HASH_MISMATCH " + " ".join(bad) + " - nothing written")
    return m, rel
def skills(tag, write=False, show=None, placeholders=False, base=None, base_src=None):
    if not LIVE.is_dir():
        print(f"skills: no live skills folder at {LIVE} (not Grok Bot). Other agents: node t3ctl skills install --to <dir>"); return
    m, rel = rel_skills(tag, SRC)
    if not rel: print(f"skills: {tag} manifest lists no skills (before v1.4.0) - skill sync skipped"); return
    if "t3-install-tools" in rel:
        t = rel["t3-install-tools"]
        lv = LIVE / "t3-install-tools" / "SKILL.md"
        if 'cmd == "skills"' not in t and lv.is_file():
            print("skills: this release's t3-install-tools has no skill sync, keeping the live one (pin moved to the tag)"); t = lv.read_text("utf-8")
        rel["t3-install-tools"] = pin_fix(t, m, tag)
    live = {p.name: p / "SKILL.md" for p in LIVE.iterdir() if p.name.startswith("t3-") and (p / "SKILL.md").is_file()}
    # The base is the release the live skills were last in step with. A live skill that differs from its base was edited by the
    # owner; one that equals it was not, so the new release can replace it without asking.
    bs = bases(); dflt = bs["default"] or base or ((DST / "VERSION").read_text().strip() if (DST / "VERSION").exists() else None)
    for sid, (h, t) in list(bs["merged"].items()):  # a merged copy the owner took: their edit now sits on that release
        if sid in live and sha(json.dumps(norm(live[sid].read_text("utf-8"))).encode()) == h: bs["skills"][sid] = t
        if sid not in live or sid in bs["skills"] and bs["skills"][sid] == t: bs["merged"].pop(sid, None)
    cache = {tag: rel}
    def base_of(sid):
        bt = bs["skills"].get(sid) or dflt
        if not bt: return None, None
        if bt not in cache:
            try:
                bm, br = rel_skills(bt, base_src if bt == dflt and base_src else None)
                if "t3-install-tools" in br: br["t3-install-tools"] = pin_fix(br["t3-install-tools"], bm, bt)
                cache[bt] = br
            except SystemExit: cache[bt] = {}  # that release can't be read (too old, private, offline): no base, as before
        return bt, cache[bt].get(sid)
    diffn = lambda x, y: [l for l in difflib.unified_diff(x.splitlines(), y.splitlines(), lineterm="", n=0) if l[:1] in "+-" and l[:3] not in ("+++", "---")]
    count = lambda d: f"+{sum(l[0] == '+' for l in d)}/-{sum(l[0] == '-' for l in d)} lines"
    st, both = {}, {}
    for sid, t in sorted(rel.items()):
        if sid not in live: st[sid] = "new"; continue
        a, b = norm(live[sid].read_text("utf-8")), norm(t)
        if a == b: st[sid] = "unchanged"; bs["skills"].pop(sid, None); continue
        # the bot template ships short copies that point at the full skill on GitHub and download it on every use
        if len(a[2]) * 2 < len(b[2]) and f"skills/{sid}/SKILL.md" in a[2]: st[sid] = f"placeholder (full copy is {len(b[2])} characters)"; continue
        bt, braw = base_of(sid); o = norm(braw) if braw is not None else None
        if o is None or a == o: st[sid] = f"changed ({count(diffn(a[2], b[2]))}" + (", description" if a[1] != b[1] else "") + ")"; continue
        if o == b: st[sid] = f"yours ({count(diffn(o[2], a[2]))} by you; the release didn't change it)"; continue
        mg = merge3(o[2].split("\n"), a[2].split("\n"), b[2].split("\n"))
        if mg is not None and a[1] != o[1] and b[1] != o[1] and a[1] != b[1]: mg = None  # both rewrote the description
        both[sid] = {"base": bt, "o": o, "a": a, "b": b, "merged": None if mg is None else (b[0], a[1] if b[1] == o[1] else b[1], "\n".join(mg))}
        st[sid] = f"both ({count(diffn(o[2], a[2]))} by you, {count(diffn(o[2], b[2]))} by the release since {bt}; " + ("they don't overlap" if mg is not None else "they overlap") + ")"
    gone = sorted(set(live) - set(rel))
    if show:
        if show not in rel: sys.exit(f"NO_SUCH_SKILL {show} in {tag}")
        if show in both:
            x = both[show]
            print(f"--- your edit of {show} (compared with {x['base']}) ---\n" + "\n".join(difflib.unified_diff(x["o"][2].splitlines(), x["a"][2].splitlines(), f"{x['base']}/{show}", f"live/{show}", lineterm="")))
            print(f"--- what the release changed in {show} ({x['base']} -> {tag}) ---\n" + "\n".join(difflib.unified_diff(x["o"][2].splitlines(), x["b"][2].splitlines(), f"{x['base']}/{show}", f"{tag}/{show}", lineterm=""))); return
        old = live[show].read_text("utf-8").splitlines() if show in live else []
        print("\n".join(difflib.unified_diff(old, rel[show].splitlines(), f"live/{show}", f"{tag}/{show}", lineterm=""))); return
    c = lambda k: sum(v.startswith(k) for v in st.values())
    print(f"skills vs {tag}: {c('new')} new, {c('changed')} changed, {c('placeholder')} placeholders, {c('yours')} yours, {c('both')} both, {c('unchanged')} unchanged, {len(gone)} not in release")
    for sid, v in st.items():
        if v != "unchanged": print(f"skill {v.split(' ')[0]}: {sid} {v[len(v.split(' ')[0]):].strip()}".rstrip())
    for sid in gone: print(f"skill not in release (kept unless the user says delete): {sid}")
    if c("both"): print(f"ASK: {c('both')} skill(s) were edited by the owner and also changed by the release. Never replace one without the owner's choice: keep mine, take the new one, or update and keep my edit (t3-install-tools \"Skills you edited\").")
    if c("placeholder") and not write:
        print(f"NEXT: {c('placeholder')} skill(s) are still template placeholders, downloaded from GitHub every time they are used. Save the full copies now: "
              f"python3 {pathlib.Path(sys.argv[0]).as_posix()} skills {tag} --write --placeholders, then UpdateSkill each entry of PLAN.json in order. Needs no yes: they are this bot's own skills.")
    # remember the bases, so the next check still knows which lines are the owner's
    for sid, x in both.items(): bs["skills"].setdefault(sid, x["base"])
    if not (c("new") or c("changed") or c("placeholder") or c("both")): bs["default"] = tag; bs["skills"] = {s: t for s, t in bs["skills"].items() if t != tag}
    elif not bs["default"] and dflt: bs["default"] = dflt
    if bs["default"] or bs["skills"] or bs["merged"]: save_bases(bs)
    if not write: return
    out = SYNC / tag
    if out.exists(): shutil.rmtree(out)
    out.mkdir(parents=True)
    todo = sorted((s for s, v in st.items() if v.startswith("placeholder" if placeholders else ("new", "changed", "placeholder"))), key=lambda s: (s != "t3-tots-rules", s == "t3-install-tools", s))
    back = SYNC / "backups" / f"{tag}-{time.strftime('%Y%m%d-%H%M%S')}"
    for sid in todo + ([] if placeholders else sorted(both)):  # the live copy of everything this run may replace
        if sid in live: back.mkdir(parents=True, exist_ok=True); shutil.copy(live[sid], back / f"{sid}.SKILL.md")
    put = lambda name, sid, n, d, b, new=False: (out / name).write_text(json.dumps({"id": sid, "new": new, "name": n or sid, "description": d, "body": b}, indent=1), "utf-8")
    for sid in todo:
        n, d, b = front(rel[sid])
        (out / f"{sid}.SKILL.md").write_text(rel[sid], "utf-8"); put(f"{sid}.json", sid, n, d, b, st[sid] == "new")
    ask = []
    for sid, x in ([] if placeholders else sorted(both.items())):
        n, d, b = front(rel[sid]); put(f"{sid}.new.json", sid, n, d, b)
        (out / f"{sid}.yours.diff").write_text("\n".join(difflib.unified_diff(x["o"][2].splitlines(), x["a"][2].splitlines(), f"{x['base']}/{sid}", f"live/{sid}", lineterm="")), "utf-8")
        (out / f"{sid}.release.diff").write_text("\n".join(difflib.unified_diff(x["o"][2].splitlines(), x["b"][2].splitlines(), f"{x['base']}/{sid}", f"{tag}/{sid}", lineterm="")), "utf-8")
        e = {"id": sid, "base": x["base"], "overlap": x["merged"] is None, "your_edit": f"{sid}.yours.diff", "release_change": f"{sid}.release.diff", "take_new": f"{sid}.new.json"}
        if x["merged"] is not None:
            put(f"{sid}.merged.json", sid, *x["merged"]); e["keep_my_edit"] = f"{sid}.merged.json"
            bs["merged"][sid] = [sha(json.dumps([x["merged"][0], x["merged"][1], x["merged"][2].strip()]).encode()), tag]
        ask.append(e)
    if ask: save_bases(bs)
    if "t3-install-tools" in todo:
        q = "`" * 4; f = re.search(q + r"python\n(.*?)" + q, rel["t3-install-tools"], re.S)
        if f: (out / "t3tots_fetch.py").write_text(f.group(1), "utf-8")
    (out / "PLAN.json").write_text(json.dumps({"tag": tag, "apply_in_order": [{"id": s, "new": json.loads((out / f"{s}.json").read_text())["new"],
        "file": f"{s}.json"} for s in todo], "ask_the_owner": ask, "yours_kept": sorted(s for s, v in st.items() if v.startswith("yours")),
        "backups": back.as_posix() if back.exists() else None, "not_in_release_ask_default_keep": gone}, indent=1), "utf-8")
    print(f"OK skills {tag}: {len(todo)} prepared in {out} (apply in PLAN.json order, t3-install-tools last)" + (f"; {len(ask)} to ask the owner about (ask_the_owner in PLAN.json)" if ask else "") + (f"; live copies backed up in {back}" if back.exists() else ""))
cmd = args[0] if args else "box"
if cmd == "box": install_box(PIN, fetch(PIN, "manifest.json"))
elif cmd == "check":
    rel = latest(); tag = rel["tag_name"]
    cur = (DST / "VERSION").read_text().strip() if (DST / "VERSION").exists() else "none"
    print(f"installed {cur} | latest {tag} ({rel.get('published_at', '')[:10]})")
    if tag != cur:
        old = {f["dest"]: f["sha256"] for f in files("box")[1][:-1]} if (DST / "manifest.json").exists() else {}
        new = {f["dest"]: f["sha256"] for f in tools(json.loads(get(raw(tag, "manifest.json"))))}
        for p in sorted(set(old) | set(new)):
            if old.get(p) != new.get(p): print("new:" if p not in old else "removed:" if p not in new else "changed:", p)
        print("release notes:\n" + (rel.get("body") or "(none)"))
    skills(tag)
elif cmd == "update":
    tag = args[1]; install_box(tag, fetch(tag, "manifest.json"))
elif cmd == "skills":
    show = None
    if "--diff" in args: i = args.index("--diff"); show = args[i + 1]; del args[i:i + 2]
    w = "--write" in args
    if w: args.remove("--write")
    ph = "--placeholders" in args
    if ph: args.remove("--placeholders")
    base = bsrc = None
    if "--base" in args: i = args.index("--base"); base = args[i + 1]; del args[i:i + 2]
    if "--base-from" in args: i = args.index("--base-from"); bsrc = pathlib.Path(args[i + 1]).expanduser(); del args[i:i + 2]
    skills(args[1] if len(args) > 1 else latest()["tag_name"], w, show, ph, base, bsrc)
elif cmd == "rebase":  # the owner's edit of this skill now sits on <tag> (after a merged copy written by hand was saved)
    b = bases(); b["skills"][args[1]] = args[2]; b["merged"].pop(args[1], None); save_bases(b); print(f"OK {args[1]} is now compared with {args[2]}")
elif cmd == "hashes":
    for f in files(args[1])[1]: print(f"{f['sha256']}  {f['dest']}")
elif cmd == "emit":
    os_, d = args[1], args[2]
    if any(c in d for c in "'\"`$;\n"): sys.exit("tools dir must not contain quotes, $, ` or ;")
    tag, fl = files(os_); base = raw(tag, "")
    api = f"repos/{REPO}/contents/"
    if os_ == "windows":
        d = d.replace("%USERPROFILE%", "$env:USERPROFILE"); d = "$env:USERPROFILE" + d[1:] if d.startswith("~") else d
        rows = "\n".join(f"@('{f['path']}','{f['dest']}','{f['sha256']}')," for f in fl).rstrip(",")
        dl = (f"cmd /c \"gh api `\"{api}$($x[0])?ref={tag}`\" -H `\"Accept: application/vnd.github.raw`\" > `\"$o`\"\"; if ($LASTEXITCODE) {{ throw \"DOWNLOAD_FAILED $($x[0])\" }}"
              if GH else "Invoke-WebRequest -UseBasicParsing ($B+$x[0]) -OutFile $o")
        print(f"""& ([scriptblock]::Create(@'
$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
$D="{d}"; $B='{base}'; $T=Join-Path $D '.t3tots-staging'
if (Test-Path $T) {{ Remove-Item -Recurse -Force $T }}
$L=@(
{rows}
)
foreach ($x in $L) {{ $o=Join-Path $T $x[1]; New-Item -ItemType Directory -Force (Split-Path $o) | Out-Null
  {dl}
  if ((Get-FileHash -Algorithm SHA256 $o).Hash.ToLower() -ne $x[2]) {{ Remove-Item -Recurse -Force $T; throw "HASH_MISMATCH $($x[0]) - nothing installed" }} }}
foreach ($x in $L) {{ $o=Join-Path $D $x[1]; New-Item -ItemType Directory -Force (Split-Path $o) | Out-Null; Move-Item -Force (Join-Path $T $x[1]) $o }}
Remove-Item -Recurse -Force $T; Set-Content -Encoding ascii (Join-Path $D 'VERSION') '{tag}'
"OK {tag}: $($L.Count) files verified in $D"
'@))""")
    else:
        d = f"\"$HOME\"'{d[1:]}'" if d.startswith("~") else f"'{d}'"
        rows = "\n".join(f"get {f['path']} {f['dest']} {f['sha256']}" for f in fl)
        ex = " ".join(f'"$D/{p}"' for p in ("t3ctl", "t3listen", "t3ui") if any(f["dest"] == p for f in fl))
        mv = " ".join(f["dest"] for f in fl)
        dl = (f'gh api "{api}$1?ref={tag}" -H "Accept: application/vnd.github.raw" > "$T/$2"' if GH else
              'if command -v curl >/dev/null 2>&1; then curl -fsSL "$B$1" -o "$T/$2"; else wget -qO "$T/$2" "$B$1"; fi')
        print(f"""sh -s <<'T3TOTS_EOF'
set -eu
D={d}; B='{base}'; T="$D/.t3tots-staging"; rm -rf "$T"; mkdir -p "$T"
if command -v sha256sum >/dev/null 2>&1; then H='sha256sum'; else H='shasum -a 256'; fi
get() {{ mkdir -p "$T/$(dirname "$2")"
  {dl}
  [ "$($H "$T/$2" | cut -d' ' -f1)" = "$3" ] || {{ echo "HASH_MISMATCH $1 - nothing installed"; rm -rf "$T"; exit 1; }}; }}
{rows}
for f in {mv}; do mkdir -p "$D/$(dirname "$f")"; mv -f "$T/$f" "$D/$f"; done
chmod +x {ex}; rm -rf "$T"; echo '{tag}' > "$D/VERSION"
echo "OK {tag}: {len(fl)} files verified in $D"
T3TOTS_EOF""")
else: print(__doc__)
````

## Private repo
The box can't download from a private repo. Pick the first option that works:
1. A computer where `gh auth status` shows a signed-in account with access: run `gh release download <tag> -R Deepusleepy/t3-tots --archive tar.gz -D <temp folder>` there and unpack it. It holds one folder named for the tag without its leading `v` (`v1.4.1` unpacks to `t3-tots-1.4.1`). CopyToBox that folder with `box_path` set to `/workspace/uploads/<folder>` (for `v1.4.1`, `/workspace/uploads/t3-tots-1.4.1`), then run `python3 /workspace/t3tots_fetch.py box --from /workspace/uploads/<folder>`. The pinned hashes still decide what gets installed.
2. A local checkout of the repo at that tag: CopyToBox it the same way and use `--from`.
3. For computers: `python3 /workspace/t3tots_fetch.py emit <os> '<tools folder>' --gh` prints an install command that downloads with `gh api` instead of the public URL. It needs `gh` signed in on that computer. Otherwise use step 3 of "Install on a computer".

`check` can't see a private repo's releases from the box. Run `gh release view -R Deepusleepy/t3-tots --json tagName,publishedAt,body` on a computer with `gh` instead.

## Install on a computer
Files per OS come from `manifest.json` (`targets`; names below are installed names): every computer gets `t3q.py`, `t3ctl`, `t3listen`, `thread-match.js`, `export.js`, `survey.js`, `cleanup/scan.py`; Windows also `t3ctl.cmd` and `t3listen.cmd`; macOS also `t3ui` + `ui-*.applescript`. `make_report.py` and `report.py` stay on the box.
1. On the box: `python3 /workspace/t3tots_fetch.py emit <macos|linux|windows> '<tools folder>'` (e.g. `~/t3-tots`, Windows `~\t3-tots`). It prints one command.
2. Run that command unchanged on the computer (zsh/bash on macOS/Linux, PowerShell on Windows). It downloads from the pinned tag, checks every sha256 there, and only then moves the files into the tools folder (flat, as on the box), including `manifest.json`, and writes `VERSION`. Expect `OK <tag>: <n> files verified in <folder>`.
3. No internet on the computer or no curl/wget: CopyFromBox each file listed by `python3 /workspace/t3tots_fetch.py hashes <os>` (`manifest.json` included) from `/workspace/t3-tots-tools/<file>` to `<tools folder>/<file>` (CopyFromBox is byte-exact), compare hashes on the computer (macOS `shasum -a 256`, Linux `sha256sum`, Windows `Get-FileHash -Algorithm SHA256`), run `chmod +x t3ctl t3listen` on macOS and Linux (on macOS also `chmod +x t3ui`), and write the tag to `VERSION`.
4. Check: `t3q.py health` prints the T3 server state (or `NO_T3_DATA`); `node t3ctl` with no args and `node t3listen help` print usage (or `NODE_TOO_OLD`). Installing the files doesn't start `t3listen`; that's t3-phone-answers, after the user opts in.

## Skills
Grok Bot keeps the t3-* skills as live skills; "Update T3 Tots" below keeps them on the same release as the scripts. `python3 /workspace/t3tots_fetch.py skills [tag]` compares them read-only (default tag: latest release). Another agent on a computer (Claude Code, Codex, Cursor and so on) gets them with `node t3ctl skills install --to <its skills folder>`, run from a repo checkout or an unpacked release (see the repo README).

## README
Create `README.md` in the tools folder if it's missing (keep the user's edits otherwise). Write it for that computer's OS only: what the folder is (T3 Tots helper scripts from github.com/Deepusleepy/t3-tots), the installed version, token issued yes/no with date and 90-day expiry, how to revoke, and that deleting the folder removes T3 Tots from this computer. On updates, change only the version line.
- macOS/Linux: commands as `./t3ctl` and `python3 t3q.py`; revoke with `~/.t3/bin/t3 auth session list`, then `~/.t3/bin/t3 auth session revoke <id>`; remove by moving the folder to the Trash. Mention `t3ui` only on macOS.
- Windows: commands as `node t3ctl` and `py -3 t3q.py` (the `.cmd` wrappers drop double quotes); revoke with `%USERPROFILE%\.t3\bin\t3.cmd auth session list`, then `... revoke <id>`; remove by deleting the folder to the Recycle Bin in Explorer. No `chmod`, no `t3ui`, no Mac test threads.

## Checking a computer
Hash its files (step 3 commands) and compare with `python3 /workspace/t3tots_fetch.py hashes <os>`; any difference or missing file = offer to reinstall (steps 1 and 2) after the user's yes. Never "fix" a script by hand on a user's computer.

## Update T3 Tots (scripts and skills)
Use only when the user asks ("update T3 Tots", "update T3 Tots tools", "update my T3 Tots skills", "what's new in T3 Tots") or when a script prints `T3_SCHEMA_CHANGED`. The T3 Tots weekly update routine runs it without asking ("Weekly update run"). "Update T3" or "update gh" means T3 Code or dev tools: that's t3-update. One check and one yes cover the box, every T3 computer and the live skills.
1. **Check** (read-only, no approval). Save the fetcher from "Box copy" if `/workspace/t3tots_fetch.py` is missing or differs, then run `python3 /workspace/t3tots_fetch.py check`. It prints installed vs latest tag, the changed tool files, the release notes, then one skills line (`new`, `changed (+a/-b lines, description)`, `placeholder`, `yours`, `both`, `unchanged`, `not in release`) and one line per skill that isn't unchanged. Only `t3-*` skills are compared; frontmatter is compared by name and description text, so reflowed YAML doesn't count as a change. If the user asks what changed in one skill, run `skills <tag> --diff <id>` and summarize it.
2. **Show and ask once.** One short message: installed and latest tag, 2 to 4 lines of the notes, changed scripts, new and changed skills, and any live t3-* skill the release no longer has. Nothing changed in scripts or skills: say it's up to date and stop. A skill listed as `yours` was edited by the user and the release didn't change it: name it as "your edit, kept" and never offer to replace it; they can say "reset <skill>" to take the release copy. A skill listed as `both` was edited by the user and also changed by the release: name it and say it is handled one by one ("Skills you edited"). Scripts current but skills differ: still offer the skills. Skills the check calls `placeholder` are the short copies a bot template ships: don't ask about those, save the full copies ("After an update") and say "saved the full copies of N skills". Ask "Update to <tag>?". The user can answer "yes, but skip <skill>"; leave that skill out.
3. **On yes**, in this order:
   a. Box: `python3 /workspace/t3tots_fetch.py update <tag>` (skip if `VERSION` already says that tag). It verifies against that tag's `manifest.json` and replaces the box manifest.
   b. Computers: for each T3 computer in memory (ListMachines; offline ones are listed and offered later), run "Install on a computer" steps 1 and 2 with its OS and tools folder. Update the version line in its `README.md`. If `node t3listen status` there shows it running, run `node t3listen install` again so it restarts on the new version; add `--approvals` only if status showed "installed with --approvals" before the update (tools before v1.4.1 don't print that line, so use memory or ask). `listen.json` is kept.
   c. Skills: `python3 /workspace/t3tots_fetch.py skills <tag> --write --base <the tag that was installed before step a>`. It downloads each `skills/<id>/SKILL.md` of the tag (or reads it with `--from`), checks its sha256 against the tag's `manifest.json` (any mismatch writes nothing), and fills `/workspace/t3-tots-skill-sync/<tag>/` with `PLAN.json` (apply order, t3-tots-rules first and t3-install-tools last), one `<id>.json` per new or changed skill (`id`, `new` true|false, `name`, `description`, `body` without frontmatter), the full verified `<id>.SKILL.md`, and `t3tots_fetch.py` when t3-install-tools changed.
   d. Apply: the main Grok Bot agent goes through `apply_in_order` in `PLAN.json` and calls UpdateSkill once per entry with that json's name, description and body. Skills under `ask_the_owner` are not in that list: handle each as "Skills you edited" says, after the rest. Skills under `yours_kept` stay as they are. For each `apply_in_order` entry: UpdateSkill with that json's name, description and body (action write; pass id to rewrite an existing skill, omit id to create a new one). Skip skills the user excluded. A subagent can't call UpdateSkill: it stops after step c and hands the main agent the folder path and the plan.
   e. t3-install-tools goes last. Its prepared body already pins `<tag>` and that tag's tool hashes (the fetcher rewrites `PIN` and `PINNED` from the manifest, and keeps the live body if that release's copy has no skill sync). After its UpdateSkill, copy the folder's `t3tots_fetch.py` over `/workspace/t3tots_fetch.py` (or save the fetcher from the updated skill), then run `python3 /workspace/t3tots_fetch.py box`. It must print `OK <tag>`; a `HASH_MISMATCH` means the pin and the box disagree, so stop and report.
   f. Skills listed under `not_in_release_ask_default_keep`: list them and ask "Delete <ids>?". Default keep; delete only after a separate yes.
   g. Do every check under "After an update" below, reading that section from the skill as it is after step e, not from what you read before the update.
   h. Update the T3 Tots version in memory. Finish in one line: tag, where the scripts were installed, skills updated and created, skills kept or skipped, and where t3listen restarted.
4. **Rollback**: the same steps with the previous tag (`update <previous tag>`, then `skills <previous tag> --write` and apply). Older tags stay on GitHub.
5. **Private repo**: `check` can't see releases, so get the tag with `gh release view` (see "Private repo"), unpack that release on the box, and pass `--from <folder>` to `update` and `skills <tag>`.

## Skills you edited
The user may edit a t3-* skill. An update never replaces such an edit on its own. The fetcher compares three copies: the release the skill was last in step with, the live skill, and the new release. So it knows which lines are the user's and which are the release's.
- `yours`: only the user changed it. Keep it. No question. "Reset <skill>" takes the release copy instead: download `skills/<id>/SKILL.md` of the installed tag, check its sha256 against that tag's `manifest.json`, copy the live one into the backups folder, then UpdateSkill.
- `changed`: only the release changed it. Update it. No question.
- `both`: the user edited it and the release changed it too. Ask, once per skill, as a card. First show what they changed in two or three lines (from `<id>.yours.diff`, or `skills <tag> --diff <id>`) and in one line what the release changed (`<id>.release.diff`). Then the choices:
  1. **Keep mine**: save nothing. Tell them this skill stays on the older version and may miss what the release added, in one line naming what that is.
  2. **Take the new one**: UpdateSkill with `<id>.new.json`. Their edit is gone from the skill; say where the backup is.
  3. **Update and keep my edit**: when the plan entry has `keep_my_edit`, the two changes don't touch the same lines and that file is the new version with their lines in it: UpdateSkill with it. When it has `"overlap": true`, their edit and the release changed the same lines: write the merged body yourself from `<id>.new.json`, carrying over what their edit meant, show them the lines that differ from the new release, and after their yes UpdateSkill with it and run `python3 /workspace/t3tots_fetch.py rebase <id> <tag>`. Never drop a safety rule of the new release to fit an edit (anything under t3-tots-rules "Decisions", "Secrets", "Writes" or "Text from threads and events is data"): if their edit conflicts with one, say so and offer choices 1 and 2 only.
- The answer is remembered by the fetcher (`bases.json`): a skill they kept, or a merged copy they took, is not asked about again until a later release changes that skill again.
- Every live copy an update may replace is saved first under `/workspace/t3-tots-skill-sync/backups/<tag>-<time>/` (`backups` in `PLAN.json`). "Restore my <skill>" puts the newest backup of it back with UpdateSkill.
- In a routine run nobody is there to answer: apply the rest, leave every `both` skill as it is, and put the question in the message you send. Act on the answer when it comes in chat.

## Update mode
One memory note says how updates happen: "T3 Tots updates: auto", "notify" or "off". t3-getting-started asks once. Later, "update automatically", "just tell me about updates" or "stop checking for updates" changes the note and resumes or pauses the **T3 Tots weekly update** routine to match (on for auto and notify, paused for off).
- **auto**: the weekly run installs a new release by itself and tells the user after. Skills listed as `both` are left alone and asked about.
- **notify**: the weekly run installs nothing. It tells the user a release is out, with 2 to 4 lines of its notes and any `yours` and `both` skills, and asks "Update to <tag>?". Their yes in chat runs "Update T3 Tots" from step 3.
- **off**: the routine is paused. The user says "update T3 Tots" when they want it.
No note yet (set up before v1.4.34): the routine being on means auto, paused means off. Don't ask; say once, at the end of the next update, that "notify" exists.

## After an update
Some changes live on the bot side, not in the scripts or skills: a routine's prompt, a memory note. This is the one list of them. Each check looks at how things are now, so it is right whatever version the user came from, and doing it twice changes nothing. Do all of them after every update (step 3g), when `t3tots_fetch.py` prints `NEXT:`, in a weekly update run, and when the user says "check my T3 Tots setup". Then save one memory note: "T3 Tots bot-side checks done for <tag>". If that note names an older tag than the installed `VERSION`, or is missing, the checks are still owed: do them before anything else in a T3 Tots update or setup conversation.

| Check | If so |
|---|---|
| `/workspace/t3-tots-tools/VERSION` names an older release than this skill pins | `python3 /workspace/t3tots_fetch.py box`, so the box tools match the skills |
| The **T3 Tots weekly update** routine's prompt doesn't start with the text under "Weekly update run" | Replace the prompt with that text (UpdateRoutine). Keep its schedule and whether it is on or paused |
| First save the fetcher from "Box copy" to `/workspace/t3tots_fetch.py` if that file is missing or differs (an older one can't see placeholders). Then: `python3 /workspace/t3tots_fetch.py skills <installed tag>` lists a skill as `placeholder` (the bot template ships short copies that download the full skill from GitHub on every use) | `python3 /workspace/t3tots_fetch.py skills <installed tag> --write --placeholders`, then UpdateSkill for each entry of `PLAN.json` in order, t3-install-tools last ("Update T3 Tots" step 3d and 3e). Then run the check again: it must list no placeholder. It needs no yes, since these are this bot's own skills, and a skill edited by hand is never touched. One line to the user: "Saved the full copies of N skills." |
| Phone answers are on (memory, or a routine named **T3 questions to chat** exists) and that routine's prompt doesn't start with "T3 Tots event routine v2." | Replace the prompt with the text under t3-phone-answers "Routine prompt" (UpdateRoutine; the webhook URL and key stay, nothing is pasted again). Do the same for any other bot's event routine you can change. Tell the user in one line: each notification now reads far less |

A check you can't carry out (no access to that routine, the user said no): say so in the finish line and leave the memory note at the older tag, so it is tried again.

## Weekly update run
The **T3 Tots weekly update** routine (t3-getting-started section 6) runs this, in the mode the "T3 Tots updates" memory note names ("Update mode"). In auto mode, choosing it was the user's yes for each later run, so don't ask before installing. In notify mode, do step 1, then tell the user what is out and ask; install nothing in that run.
1. Run "Update T3 Tots" step 1. If the latest tag is the installed tag, do the "After an update" checks when the check printed `NEXT:` or the memory note "T3 Tots bot-side checks done for <tag>" is missing or names an older tag, and say what they changed in one line. Otherwise send nothing and stop. A skill the check calls `yours` is the user's edit and stays.
2. If a newer tag exists (auto mode), run step 3 a to e, g and h for it. Skills under `ask_the_owner` are never replaced in this run: name them in the message with the three choices ("Skills you edited"). Skip step f: a routine run never deletes a skill. List offline computers instead of retrying them. If neither `t3listen status` nor memory says whether a listener used `--approvals`, don't restart it; it runs the new version from its next login.
3. Send one short message: the old and new tag, 2 to 4 lines of the notes, what was updated where, and anything left for the user (offline computers, listeners not restarted yet, skills the release no longer has, skills they edited that are waiting for their choice).
4. `HASH_MISMATCH`, `REPO_PRIVATE_OR_MISSING` or a failed step installs nothing more. Say what was and wasn't updated, once per tag and error, and note it in memory so later runs stay quiet until the tag or the error changes.

It updates only T3 Tots scripts and t3-* skills. Never update T3 Code, Node, gh or other tools (t3-update), and never change this bot's picture, description or publish settings.

The routine's prompt starts with this text. A template may add reminders after it, as long as they repeat this section and change nothing:

> T3 Tots weekly update. Follow t3-install-tools "Weekly update run" and t3-tots-rules. Send nothing when T3 Tots is already on the latest release and nothing changed.
