---
name: t3-update
description: >-
  Update tools on the user's computers, by level or by name, with a project-safety
  check first. Use for "update T3/AI/dev/everything", "update gh", "update claude and
  codex", "update just T3 on <computer>", "what's out of date", "change my update levels".
---
Follow the t3-tots-rules skill (skills/t3-tots-rules/SKILL.md). Steps that use the box, ListMachines, routines, cards or SendToUser are Grok Bot only; other agents follow t3-tots-rules "Grok Bot only". Updating is approved only for the items resolved this turn, or a saved level as its "Writes" section allows. Never touch a project's own lockfile or dependencies unless asked.

## 1. Resolve what to update
- **By name (first-class):** "update gh", "update claude and codex", "update node on the Mac", "update just T3 on <computer>". Map words to item ids below; a computer name narrows the scope. Named items run even if they aren't in any level, and even if they're in `skip` (the user named them).
- **By level:** match the phrase to a key in `levels` (small wording drift is fine). Item set = that level minus `skip`.
- **"what's out of date":** survey only, grouped by level; change nothing.
- **"change my update levels":** show `levels`, let the user rename, add or remove triggers and items, save. Don't update in that turn unless asked. Custom levels ("make 'update editors' mean VS Code + Cursor") don't have to nest.
- Any other phrase: ask which item or level.

Item ids (survey and offer only what is installed on that computer): `t3-code`, `claude`, `codex`, `opencode`, `gemini`, `cursor-agent`, `gh`, `node`, `npm`, `pnpm`, `python`, `go`, `rust`, `npm-global:<pkg>|all`, `brew:<formula>|all`, `winget:<Id>|all`, plus any user-registered long-running tool from `protect` (only when named). Personal tools (a local proxy, an in-house CLI) aren't built in: they come from memory or from items the user added under "change my update levels", with the survey and update commands saved there too.

## Prefs
`<tools folder>/update-prefs.json` on each computer; the main computer's copy wins, keep them in sync after edits. First use with no file: seed the defaults, ask whether any long-running jobs (benchmarks, training, servers) must never be disturbed and record them in `protect` (empty if none), show the survey grouped by level, ask what to run, save after they answer.
```json
{"version":1,"updated":"<ISO>","main":"<label>",
 "levels":{
  "update T3":["t3-code"],
  "update AI":["t3-code","claude","codex","opencode","gemini","cursor-agent"],
  "update dev":["t3-code","claude","codex","opencode","gemini","cursor-agent","gh","node","npm","npm-global:all"],
  "update everything":["t3-code","claude","codex","opencode","gemini","cursor-agent","gh","node","npm","npm-global:all","brew:all","winget:all"]},
 "skip":["winget:Microsoft.WSL"],
 "protect":[{"name":"<long-running job, e.g. a benchmark runner>","process":"<pgrep pattern>","log":"<log path>","uses":["node"]}]}
```

## 2. Survey (read-only, every computer in scope, in parallel)
- T3 Code: Mac `defaults read "/Applications/<app>.app/Contents/Info" CFBundleShortVersionString` where `<app>` is `T3 Code (Alpha)` (stable) or `T3 Code (Nightly)`; check which exists (both can). Windows: the `T3 Code*` entry under the Uninstall registry keys (HKCU and HKLM). Linux: the AppImage/package version.
- CLIs: `<tool> --version` for codex, claude, opencode, cursor-agent, gemini, gh, node, npm, pnpm; latest via `npm view <pkg> version` or the tool's channel.
- Mac: `export PATH=/opt/homebrew/bin:$PATH; brew outdated --verbose`. Global npm: `npm -g outdated`. Windows: `winget upgrade --accept-source-agreements`.
- `protect` and personal tools: version only, read from their own package/version file; never start them to check.
Show only outdated items in scope: computer, item, current version, latest version, major jump (yes or no), and how to update.

## 3. Project-safety check (before applying)
1. **Active projects** per computer: T3 projects with threads updated in the last 14 days (`t3q.py overview`, `T3_DAYS=14`), git repos under the user's projects folder (from memory) with commits or uncommitted changes in 14 days (`git -C <repo> log -1 --format=%cr`, `status -s`), running T3 threads, and live `protect` jobs (`pgrep -fl <process>`, its log updated <30 min ago).
2. **Who depends on what** (read only these files): `.nvmrc`, `.node-version`, `.tool-versions`, `package.json` `engines` and `packageManager`, `volta`, `.python-version`, `pyproject.toml` `requires-python`, `go.mod` `go`/`toolchain`, `rust-toolchain(.toml)`, and global CLIs called in `package.json` scripts, Makefiles or CI.
3. **Classify** each item:
   - **Block (skip, report):** a live run or running T3 thread uses it (for a live `protect` job, skip the job and everything in its `uses` list. For a running thread, skip T3 Code and that thread's provider CLI). Never kill anything; offer to retry later or t3-watch until idle.
   - **Ask:** major version jump (node 24 to 26, npm 11 to 12, python 3.12 to 3.13), or the new version breaks a pin or range in an active project (`engines.node` "<25", `packageManager: pnpm@9`, `.nvmrc 22`). Name the project and the pin.
   - **Go:** minor/patch with no conflicts.
   Show the plan (go / ask / blocked) and wait for answers on "ask" items.

## 4. Apply
Record each item's current version first (it's the rollback).
- T3 Code: in-app updater or the latest download for the user's channel (stable or Nightly); quit only when no thread runs.
- Codex `npm i -g @openai/codex@latest`. Claude `claude update`. Gemini `npm i -g @google/gemini-cli@latest`. Cursor agent `cursor-agent update`.
- OpenCode: the way it was installed: `brew upgrade opencode`, `npm i -g opencode-ai@latest`, or `opencode upgrade`.
- gh `brew upgrade gh` / `winget upgrade GitHub.cli`. node `brew upgrade node` (or the installed `node@<major>` formula) / `winget upgrade OpenJS.NodeJS.LTS` / nvm `nvm install --lts`. npm/pnpm/global pkgs `npm i -g <pkg>@latest`.
- Linux: the distro's package manager (`apt`, `dnf`, `pacman`) needs sudo; give the exact command and let the user run it, or ask first. `npm`-installed CLIs as above.
- `brew:all` runs `brew upgrade` minus skip. `winget:all` runs `winget upgrade --all --silent` minus skip (exclude the WSL entry).

## 5. Smoke check
- `<tool> --version` for every updated item; for T3, the app starts and `t3q.py health` shows it listening.
- For each active project that depends on an updated runtime or package manager, run its cheapest check if one exists and takes under ~2 min: `typecheck`, then `test`, then `build` script (use the project's package manager; `go build ./...`, `cargo check`, `python -m compileall -q .`). Don't install deps, don't touch lockfiles; if `node_modules` is missing, skip and say so.

## 6. Report
Per computer: the version before and after, what was skipped and why, smoke results. For anything that broke: the error in one line and the rollback, e.g. `npm i -g @openai/codex@<old>`, `brew install node@24` + `brew pin`, `winget install --id <Id> --version <old>`; T3 Code: previous build for that channel from the releases page. Offer to roll back; do it only on a yes.
