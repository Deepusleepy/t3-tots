# T3 Tots

**T3 Tots** is a set of agent skills plus small helper scripts for [T3 Code](https://github.com/pingdotgg/t3code). It tells you what your coding-agent threads are doing and what's waiting on you, starts threads and follow-ups, answers their questions, makes project reports and digests, watches long runs, and keeps your computers updated and tidy.

The repo is private for now. It is licensed under MIT ([LICENSE](LICENSE)). No accounts, no telemetry: the only thing that sends data off your computer is the optional `t3listen`, and only to a webhook you set up.

## What's here

| Path | What it is |
|---|---|
| `skills/` | The skills, one folder each (`t3-status`, `t3-watch`, `t3-new-thread`, ...). Start with `t3-getting-started`; `t3-tots-rules` holds the rules the others share. |
| `tools/` | The helper scripts. Installed flat into one tools folder per computer (`tools/windows/t3ctl.cmd` and `tools/macos/ui-*.applescript` sit next to `t3ctl`). |
| `manifest.json` | One version for everything: each file's repo path, installed path, size and SHA-256, and which computers get each tool. |
| `scripts/`, `tests/` | Checks, manifest builder and skill sync (see Developing). |

| Tool | Runs on | What it does |
|---|---|---|
| `t3q.py` | macOS, Linux, Windows | Read-only queries of T3 Code's local database: `overview`, `waiting`, `thread`, `projects`, `health`, `usage`. No token needed. |
| `t3ctl` | macOS, Linux, Windows | Client for T3 Code's local API: list, start, steer, queue, read, answer, settle, rename, fork and stop threads; `watch`, which prints what changed on a thread since the last check, for a routine to read; usage-limit recovery; scheduled `tasks`; PRs. Also `skills`, which installs the skills (no token needed). `node t3ctl` prints the full usage line. |
| `t3listen` | macOS, Linux, Windows | Optional. Pushes thread questions and run ends to your webhook so you can answer from your phone. |
| `export.js`, `survey.js` | macOS, Linux, Windows | Read-only, redacted project export and thread activity survey (feed the reports and digests). |
| `t3ui` + `ui-*.applescript` | macOS | Optional fallback that drives the T3 Code app when its local API is unavailable (needs Accessibility permission). |
| `cleanup/scan.py` | macOS, Linux, Windows | Read-only disk-usage scan. |
| `cleanup/make_report.py`, `report/report.py` | Grok Bot's box | Build the HTML cleanup report and project briefing. |
| `t3ctl.cmd`, `t3listen.cmd` | Windows | Wrappers for `cmd`; from PowerShell use `node t3ctl`. |

## Install

Some steps in the skills are Grok Bot only (the box, chat sends, routines, cards). `t3-tots-rules` "Grok Bot only" says what other agents do instead.

**Grok Bot.** The skills are built in. Say "set up T3 Tots": after your yes it installs the tools on each computer and checks every file against SHA-256 hashes pinned in `t3-install-tools`.

**Claude Code, Codex, Cursor, Hermes and other agents.** You need access to the repo while it's private, through a signed-in GitHub CLI (`gh auth status`).

1. Download the latest release, unpack it and go into its folder (`t3-tots-<version>`), then install the skills. macOS and Linux:

   ```sh
   gh release download -R Deepusleepy/t3-tots --archive tar.gz
   tar xzf t3-tots-*.tar.gz
   cd t3-tots-*/
   node tools/t3ctl skills install --to ~/.claude/skills --dry-run   # see what it would do
   node tools/t3ctl skills install --to ~/.claude/skills
   ```

   Windows PowerShell:

   ```powershell
   gh release download -R Deepusleepy/t3-tots --archive zip
   Expand-Archive (Get-Item t3-tots-*.zip).FullName -DestinationPath .
   Set-Location (Get-ChildItem -Directory -Filter 't3-tots-*' | Select-Object -First 1)
   node tools/t3ctl skills install --to "$env:USERPROFILE\.claude\skills" --dry-run
   node tools/t3ctl skills install --to "$env:USERPROFILE\.claude\skills"
   ```

   Use the folder your agent reads: Claude Code `~/.claude/skills`, Codex `~/.agents/skills`, Cursor `~/.cursor/skills`, Hermes `~/.hermes/skills` (on Windows the same folders under `%USERPROFILE%`). Install into one folder only. Cursor also loads `~/.claude/skills`, `~/.agents/skills` and `~/.codex/skills`, so a copy in a second folder is listed twice.
2. Ask your agent to set up T3 Tots. It follows [AGENTS.md](AGENTS.md) to install the tools, verified against `manifest.json`, and uses the stand-ins in `t3-tots-rules` "Grok Bot only" for Grok Bot steps.

Every file is checked against `manifest.json` first; any mismatch installs nothing. To update, get the new release and run the same commands. They copy only skills that are missing or changed, and keep any skill you edited (`--force` replaces it and moves your copy to `out/skills-backup/<timestamp>/` in the folder that holds the `t3ctl` you ran, here the release's `tools/`). `skills list --to <folder>` shows the state of each skill without changing anything.

## Answering questions from your phone (optional)

1. You need a webhook that accepts a POST with an `Authorization` header; Grok Bot makes one with a routine. T3 Tots then opens a Terminal (macOS) or PowerShell window (Windows) with `t3listen setup` already running. You paste two lines from the routine panel: line 1 the Webhook URL (`https://...`), line 2 the Authorization header (`Authorization: ...`). It saves them into `listen.json` in the tools folder. Only your user account can read that file, and it's never printed.
2. `node t3listen test` sends one test event. `node t3listen install` then starts the listener at login: a LaunchAgent on macOS, a hidden Task Scheduler logon task on Windows, or a systemd user unit on Linux. `t3listen status` and `t3listen uninstall` do what they say.
3. `t3listen` sends three kinds of event: `request.opened` when a thread asks something, `request.resolved` when it is answered (here or in T3), cancelled or expired, and `thread.finished`, `thread.failed` or `thread.cancelled` when a run ends and the thread is left idle. The fields are listed in `skills/t3-phone-answers/SKILL.md`, "How it works". T3 Tots answers with `t3ctl answer`, using only your exact choice unless you hand decisions over (`skills/t3-tots-rules/SKILL.md`, "Decisions").
4. When a run fails on a usage limit, `t3listen` turns on T3's own "Resume at reset" for the thread if its project is listed in `autoresume.json` (`{"enabled": true, "projects": ["My App"]}`, none by default) or `t3ctl new` started it (`started-here.json`). The `thread.failed` event then carries `usageLimit`, `autoResumeSet` and `resumeAt`.
5. Permission prompts (approvals) are sent only when `listen.json` has `"approvals": true` or the listener was installed with `node t3listen install --approvals`; `node t3listen status` shows which. Running `install` again without the flag turns the second switch off and leaves `listen.json` as it is. Questions older than `skipStaleMinutes` (default 1440) at startup are skipped. `node t3listen --dry-run` prints the payloads instead of sending them. If the webhook refuses an event, `listen.log` shows the status and the webhook's reply (URL and key redacted); rate limits, network errors and 5xx are retried every minute for up to 24 hours, and anything still undelivered is resent when the listener restarts.

## Developing

- `scripts/check.sh` runs every check: syntax, the Node and Python tests, manifest freshness, CRLF in the Windows wrappers, and a scan for private details. Put words that must never ship (your name, private project names) one per line in `~/.config/t3-tots/private-words.txt`; never commit that file. With no list the check fails; set `T3TOTS_NO_PRIVATE_WORDS=1` only if you mean to skip it.
- After changing a tool, add new tools to `TOOLS` in `scripts/make-manifest.py` and run it. It rewrites `manifest.json` from `VERSION`.
- `scripts/sync-skills --from <folder>` (or `T3TOTS_SKILLS_SRC=<folder>`) copies the live skills into `skills/`, scans them for private details, and updates the manifest. It changes only line endings, and copies nothing if the scan finds anything; fix the live skill, then run it again.
- Release only from a tag. Installers download by tag and check every hash.

## Requirements

- **Python 3.8+** for `t3q.py` and `cleanup/scan.py` (3.9+ for `report/report.py`). Windows: use `py -3`.
- **Node 22+** for `t3ctl` and `t3listen` (Node 18+ for `export.js` and `survey.js`).
- **T3 Code** installed and opened at least once.

## Security

- `t3q.py` opens T3 Code's `statev2.sqlite` **read-only**. From `server-runtime.json` it reads only `host`, `port` and `pid`.
- The scripts never open T3's `secrets/` folder or any auth or credential file. The one file they read is the `token` **next to themselves**, created only after your yes with T3 Code's own CLI (the command is in `skills/t3-tots-rules/SKILL.md`, "Token"). It expires after 90 days, is never printed, and you can revoke it any time with `t3 auth session list` and `t3 auth session revoke <id>`.
- Everything talks only to T3 Code on `127.0.0.1`, except `t3listen`, which posts the events described above to the webhook in your `listen.json`. Exports redact common API-key patterns and your home path.
- Without a token, T3 Tots stays read-only. With one, `t3ctl answer` sends only the answer you chose.
- `t3ctl skills` writes only into the `--to` folder and its own `out/` folder.

To report a problem, see [SECURITY.md](SECURITY.md).
