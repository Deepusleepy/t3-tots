---
name: t3-install-tools
description: >-
  Install, check or update T3 Tots' helper scripts (t3q.py, t3ctl, t3listen,
  export/survey, t3ui, cleanup and report helpers) from the pinned, sha256-verified GitHub release
  onto the box and the user's T3 computers. Use during setup, when a skill says the
  tools are missing or differ, or for "update T3 Tots tools".
---
Follow the t3-tots-rules skill (skills/t3-tots-rules/SKILL.md). Steps that use the box, ListMachines, routines, cards or SendToUser are Grok Bot only; other agents follow t3-tots-rules "Grok Bot only". The scripts live in the repo github.com/Deepusleepy/t3-tots (MIT). This skill pins release `v1.4.24` by sha256, so a changed repo can't change what gets installed. Any mismatch installs nothing (`HASH_MISMATCH`).

The box copy needs no approval. Writing to a user's computer needs their yes; the one setup yes in t3-getting-started covers it. If a computer's t3ctl or t3listen hashes differ from the manifest because someone updated them locally ahead of a release, report that and don't install over them until a release pins them. Never touch the `token` file, `listen.json` or the other data files in the tools folder.

## Box copy
Save the fetcher below to `/workspace/t3tots_fetch.py` exactly as written. If it already exists with a different `PIN` or hashes, overwrite it with this one. Then run `python3 /workspace/t3tots_fetch.py box`. It downloads every tool from the pinned tag, verifies each sha256, and puts them in `/workspace/t3-tots-tools/` with the same flat layout as a computer's tools folder (each file at its manifest `dest`, so `tools/windows/t3ctl.cmd` becomes `t3ctl.cmd`). It also writes `manifest.json`, the reference for every other check, and `VERSION`.

If it prints `REPO_PRIVATE_OR_MISSING`, the repo is private or the tag doesn't exist yet; follow "Private repo".

````python
#!/usr/bin/env python3
"""T3 Tots tools fetcher (runs on the box). Commands:
  box [--from DIR]          install the pinned release's tools into /workspace/t3-tots-tools, verify every sha256
  check                     compare with the latest GitHub release (read-only): changed files + notes
  update <tag> [--from DIR] install <tag> on the box, verified against that tag's manifest.json (only after the user's yes)
  hashes <macos|linux|windows>                  'sha256  file' lines for that OS's tools folder (with manifest.json)
  emit <macos|linux|windows> <tools dir> [--gh] print a one-shot install command for that computer (tools, manifest.json, VERSION)
--from DIR reads the files from a folder on the box (a CopyToBox of the release or a checkout at that tag)
instead of downloading; the same hashes are checked. --gh makes the install command download with the
GitHub CLI, which works for a private repo on a computer where `gh auth status` is signed in.
Installs tools only; skills install with `t3ctl skills install`. The tools folder stays flat: each file
goes to its manifest `dest` (tools/windows/t3ctl.cmd becomes t3ctl.cmd)."""
import hashlib, json, os, pathlib, sys, urllib.error, urllib.request
REPO = "Deepusleepy/t3-tots"; PIN = "v1.4.24"
PINNED = {
 "tools/t3q.py": ["t3q.py", "ab0af56893860552d5b7163d25a0463d1b167ee31cbea0462aa6371098306365"],
 "tools/t3ctl": ["t3ctl", "0b5859a01701dd40c19d629e3b198d8837af473540344e403ec73748b6a29038"],
 "tools/windows/t3ctl.cmd": ["t3ctl.cmd", "b53d3a36313f6d78c4feeba028823c836b3e64e3b42a5b33ea4a6fe73be30d6e"],
 "tools/t3listen": ["t3listen", "e230edeebb42f0b9aed481e4e868f2f20f5f76d0e107224d4e6dae05f7b8a655"],
 "tools/windows/t3listen.cmd": ["t3listen.cmd", "2a818c7c0471268de6b065ac20e08ff849a6262d07752160ee651a29286abcf5"],
 "tools/export.js": ["export.js", "c25e93bc3515d554de7086adec3b79b32f58f6b869b220b015899b4d6253a3eb"],
 "tools/survey.js": ["survey.js", "206fff36b57e111fd061417f2c21eb7ee09fa5dfe1537843a81242d47e5d6052"],
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
def files(os_):  # this OS's tools, then manifest.json itself (verified by `box`), so computers get it next to VERSION
    if not (DST / "manifest.json").exists(): sys.exit("NO_BOX_COPY: run `box` first")
    mb = (DST / "manifest.json").read_bytes(); m = json.loads(mb)
    return m["version"], [f for f in tools(m) if os_ in f["targets"]] + [{"path": "manifest.json", "dest": "manifest.json", "sha256": sha(mb)}]
cmd = args[0] if args else "box"
if cmd == "box": install_box(PIN, fetch(PIN, "manifest.json"))
elif cmd == "check":
    try:
        with urllib.request.urlopen(urllib.request.Request(f"https://api.github.com/repos/{REPO}/releases/latest", headers={"User-Agent": "t3-tots"}), timeout=30) as r: rel = json.loads(r.read())
    except urllib.error.HTTPError as e:
        if e.code != 404: sys.exit(f"DOWNLOAD_FAILED releases/latest: {e}")
        sys.exit(f"REPO_PRIVATE_OR_MISSING: the box can't see releases. On a computer where gh is signed in run: "
                 f"gh release view -R {REPO} --json tagName,publishedAt,body")
    tag = rel["tag_name"]
    cur = (DST / "VERSION").read_text().strip() if (DST / "VERSION").exists() else "none"
    print(f"installed {cur} | latest {tag} ({rel.get('published_at', '')[:10]})")
    if tag != cur:
        old = {f["dest"]: f["sha256"] for f in files("box")[1][:-1]} if (DST / "manifest.json").exists() else {}
        new = {f["dest"]: f["sha256"] for f in tools(json.loads(get(raw(tag, "manifest.json"))))}
        for p in sorted(set(old) | set(new)):
            if old.get(p) != new.get(p): print("new:" if p not in old else "removed:" if p not in new else "changed:", p)
        print("release notes:\n" + (rel.get("body") or "(none)"))
elif cmd == "update":
    tag = args[1]; install_box(tag, fetch(tag, "manifest.json"))
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
Files per OS come from `manifest.json` (`targets`; names below are installed names): every computer gets `t3q.py`, `t3ctl`, `t3listen`, `export.js`, `survey.js`, `cleanup/scan.py`; Windows also `t3ctl.cmd` and `t3listen.cmd`; macOS also `t3ui` + `ui-*.applescript`. `make_report.py` and `report.py` stay on the box.
1. On the box: `python3 /workspace/t3tots_fetch.py emit <macos|linux|windows> '<tools folder>'` (e.g. `~/t3-tots`, Windows `~\t3-tots`). It prints one command.
2. Run that command unchanged on the computer (zsh/bash on macOS/Linux, PowerShell on Windows). It downloads from the pinned tag, checks every sha256 there, and only then moves the files into the tools folder (flat, as on the box), including `manifest.json`, and writes `VERSION`. Expect `OK <tag>: <n> files verified in <folder>`.
3. No internet on the computer or no curl/wget: CopyFromBox each file listed by `python3 /workspace/t3tots_fetch.py hashes <os>` (`manifest.json` included) from `/workspace/t3-tots-tools/<file>` to `<tools folder>/<file>` (CopyFromBox is byte-exact), compare hashes on the computer (macOS `shasum -a 256`, Linux `sha256sum`, Windows `Get-FileHash -Algorithm SHA256`), run `chmod +x t3ctl t3listen` on macOS and Linux (on macOS also `chmod +x t3ui`), and write the tag to `VERSION`.
4. Check: `t3q.py health` prints the T3 server state (or `NO_T3_DATA`); `node t3ctl` with no args and `node t3listen help` print usage (or `NODE_TOO_OLD`). Installing the files doesn't start `t3listen`; that's t3-phone-answers, after the user opts in.

## Skills
Grok Bot already has these skills. Another agent on a computer (Claude Code, Codex, Cursor and so on) gets them with `node t3ctl skills install --to <its skills folder>`, run from a repo checkout or an unpacked release (see the repo README).

## README
Create `README.md` in the tools folder if it's missing (keep the user's edits otherwise). Write it for that computer's OS only: what the folder is (T3 Tots helper scripts from github.com/Deepusleepy/t3-tots), the installed version, token issued yes/no with date and 90-day expiry, how to revoke, and that deleting the folder removes T3 Tots from this computer. On updates, change only the version line.
- macOS/Linux: commands as `./t3ctl` and `python3 t3q.py`; revoke with `~/.t3/bin/t3 auth session list`, then `~/.t3/bin/t3 auth session revoke <id>`; remove by moving the folder to the Trash. Mention `t3ui` only on macOS.
- Windows: commands as `node t3ctl` and `py -3 t3q.py` (the `.cmd` wrappers drop double quotes); revoke with `%USERPROFILE%\.t3\bin\t3.cmd auth session list`, then `... revoke <id>`; remove by deleting the folder to the Recycle Bin in Explorer. No `chmod`, no `t3ui`, no Mac test threads.

## Checking a computer
Hash its files (step 3 commands) and compare with `python3 /workspace/t3tots_fetch.py hashes <os>`; any difference or missing file = offer to reinstall (steps 1 and 2) after the user's yes. Never "fix" a script by hand on a user's computer.

## Updating (only when the user asks, e.g. "update T3 Tots tools", or when a script prints `T3_SCHEMA_CHANGED`)
1. `python3 /workspace/t3tots_fetch.py check` (read-only): installed vs latest release, changed files, release notes.
2. Show the user the version, a summary of 2 to 4 lines of the notes and the changed files. Ask "Update to <tag>?".
3. On yes: `python3 /workspace/t3tots_fetch.py update <tag>` (verifies against that tag's `manifest.json` and replaces the box manifest), then "Install on a computer" on each computer, update `README.md` and the version in memory. If `t3listen` runs on a computer (`node t3listen status`), run `node t3listen install` again there so it restarts on the new version. Add `--approvals` only if `node t3listen status` showed "installed with --approvals" before the update (tools before v1.4.1 don't print that line, so use memory or ask); `listen.json` is kept.
4. Rollback: `update <previous tag>` the same way. Older tags stay on GitHub.
