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
| `t3ctl` | macOS, Linux, Windows | Client for T3 Code's local API: list, start, steer, queue, read, answer, settle, rename, fork and stop threads; `watch` for routines; usage-limit recovery; scheduled `tasks`; PRs. Also `skills`, which installs the skills (no token needed). `node t3ctl` prints the full usage line. |
| `t3listen` | macOS, Linux, Windows | Optional. Pushes thread questions and run ends to your webhook so you can answer from your phone. |
| `export.js`, `survey.js` | macOS, Linux, Windows | Read-only, redacted project export and thread activity survey (feed the reports and digests). |
| `t3ui` + `ui-*.applescript` | macOS | Optional fallback that drives the T3 Code app when its local API is unavailable (needs Accessibility permission). |
| `cleanup/scan.py` | macOS, Linux, Windows | Read-only disk-usage scan. |
| `cleanup/make_report.py`, `report/report.py` | Grok Bot's box | Build the HTML cleanup report and project briefing. |
| `t3ctl.cmd`, `t3listen.cmd` | Windows | Wrappers for `cmd`; from PowerShell use `node t3ctl`. |

## Install

Some steps in the skills are Grok Bot only (chat sends, routines, draft cards); non-Grok agents skip them.

**Grok Bot.** The skills are built in. Say "set up T3 Tots": after your yes it installs the tools on each computer and checks every file against SHA-256 hashes pinned in `t3-install-tools`.

**Claude Code, Codex, Cursor, Hermes and other agents.** You need access to the repo while it's private.

1. Download the latest release and unpack it: `gh release download -R Deepusleepy/t3-tots --archive tar.gz`, then `tar xzf t3-tots-*.tar.gz`.
2. From the unpacked folder, install the skills:

   ```sh
   node tools/t3ctl skills install --to ~/.claude/skills --dry-run   # see what it would do
   node tools/t3ctl skills install --to ~/.claude/skills
   ```

   Pick the folder your agent reads: Claude Code `~/.claude/skills`, Codex `~/.agents/skills`, Cursor `~/.cursor/skills`, Hermes `~/.hermes/skills`. Use one folder per agent: Cursor also reads `~/.claude/skills` and `~/.agents/skills`, so a second copy shows up twice.
3. Ask your agent to set up T3 Tots. It follows [AGENTS.md](AGENTS.md) to install the tools, verified against `manifest.json`.

Every file is checked against `manifest.json` first; any mismatch installs nothing. To update, get the new release and run the same command. It copies only skills that are missing or changed, and keeps any skill you edited (`--force` replaces it and moves your copy to `out/skills-backup/` in the folder you ran `t3ctl` from). `skills list --to <folder>` shows the state of each skill without changing anything.

## Answering questions from your phone (optional)

1. You need a webhook that accepts a POST with an `Authorization` header; Grok Bot makes one with a routine. T3 Tots then opens a Terminal (macOS) or PowerShell window (Windows) with `t3listen setup` already running. You paste two lines from the routine panel: line 1 the Webhook URL (`https://...`), line 2 the Authorization header (`Authorization: ...`). It saves them into `listen.json` in the tools folder. Only your user account can read that file, and it's never printed.
2. `node t3listen test` sends one test event. `node t3listen install` then starts the listener at login: a LaunchAgent on macOS, a hidden Task Scheduler logon task on Windows, or a systemd user unit on Linux. `t3listen status` and `t3listen uninstall` do what they say.
3. When a thread asks a question, `t3listen` POSTs `{"event":"request.opened", "machine", "threadId", "title", "project", "requestId", "kind", "createdAt", "questions":[{"id","header","question","options":[{"label","description"}],"multiSelect","allowCustomAnswer","required"}], "context", "text"}`. `context` is a short, redacted excerpt of what the thread said just before asking (up to 400 characters). When it's answered (here or in T3), cancelled or expired, it POSTs `{"event":"request.resolved", ..., "status", "answers", "answeredHere"}`. `answeredHere` is true when it was answered with `t3ctl answer` on that computer (tracked for 7 days in `answered-here.json` in the tools folder). T3 Tots answers with `t3ctl answer --thread <id> --request <id> --pick "<your choice>"`, using only your exact choice.
4. When a thread run ends and the thread is left idle, `t3listen` POSTs `{"event":"thread.finished"|"thread.failed"|"thread.cancelled", "kind":"thread-finished"|..., "machine", "threadId", "title", "project", "delegated", "runId", "status", "threadStatus", "startedAt", "completedAt", "completedAtLocal", "durationSec", "lastReply", "error", "text"}`. `lastReply` is the thread's last reply, redacted and trimmed to 600 characters; `error` appears only on `thread.failed`. Each run is reported once (run ids are kept for 14 days in `listen-state.json`), a queued message starting next is not reported as an end, and sub-task threads (`thread:delegated-task:...`) are reported only when they fail. Runs that ended while the listener was down (up to an hour) are reported when it starts again. `node t3listen preview-finish --thread <id>` prints the event for a thread's latest ended run without sending it.
5. When a run fails on a usage limit, `t3listen` turns on T3's own "Resume at reset" for the thread if its project is listed in `autoresume.json` (`{"enabled": true, "projects": ["My App"]}`, none by default) or `t3ctl new` started it (`started-here.json`). The `thread.failed` event then carries `usageLimit`, `autoResumeSet` and `resumeAt`.
6. Permission prompts (approvals) are never sent unless you add `"approvals": true` to `listen.json`. Questions older than `skipStaleMinutes` (default 1440) at startup are skipped. `node t3listen --dry-run` prints the payloads instead of sending them. If the webhook refuses an event, `listen.log` shows the status and the webhook's reply (URL and key redacted); rate limits, network errors and 5xx are retried every minute for up to 24 hours, and anything still undelivered is resent when the listener restarts.

## Developing

- `scripts/check.sh` runs every check: syntax, the Node and Python tests, manifest freshness, CRLF in the Windows wrappers, and a scan for private details. Put words that must never ship (your name, private project names) one per line in `~/.config/t3-tots/private-words.txt`; never commit that file.
- After changing a tool, add new tools to `TOOLS` in `scripts/make-manifest.py` and run it. It rewrites `manifest.json` from `VERSION`.
- `scripts/sync-skills` copies the live skills from Grok Bot's box into `skills/`, scans them for private details, and updates the manifest. It changes only line endings, and copies nothing if the scan finds anything; fix the live skill, then run it again.
- Release only from a tag. Installers download by tag and check every hash.

## Requirements

- **Python 3.8+** for `t3q.py` and `cleanup/scan.py` (3.9+ for `report/report.py`). Windows: use `py -3`.
- **Node 22+** for `t3ctl` and `t3listen` (Node 18+ for `export.js` and `survey.js`).
- **T3 Code** installed and opened at least once.

## Security

- `t3q.py` opens T3 Code's `statev2.sqlite` **read-only**. From `server-runtime.json` it reads only `host`, `port` and `pid`.
- The scripts never open T3's `secrets/` folder or any auth or credential file. The one file they read is the `token` **next to themselves**, created only after your yes with T3 Code's own CLI (`t3 auth session issue --scope orchestration:read --scope orchestration:operate --ttl 90d --label t3-tots`). It expires after 90 days, is never printed, and you can revoke it any time with `t3 auth session list` and `t3 auth session revoke <id>`.
- Everything talks only to T3 Code on `127.0.0.1`, except `t3listen`, which posts the events described above to the webhook in your `listen.json`. Exports redact common API-key patterns and your home path.
- Without a token, T3 Tots stays read-only. With one, `t3ctl answer` sends only the answer you chose.
- `t3ctl skills` writes only into the `--to` folder and its own `out/` folder.

To report a problem, see [SECURITY.md](SECURITY.md).
