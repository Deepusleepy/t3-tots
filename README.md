# T3 Tots tools

Helper scripts for **T3 Tots**, a chat companion for [T3 Code](https://github.com/pingdotgg/t3code). T3 Tots tells you what your coding-agent threads are doing and what's waiting on you, starts threads and follow-ups, makes project reports and digests, watches long runs, and keeps your computers updated and tidy.

Free and open source (MIT). No accounts, no telemetry, nothing phones home. The only thing that ever sends data off your computer is the optional `t3listen`, and only to a webhook you set up yourself.

You normally don't install these by hand: the T3 Tots bot downloads them on its first chat, after you say yes, and checks every file against pinned SHA-256 fingerprints before using it. Agents: see [AGENTS.md](AGENTS.md).

## What's here

| File | Runs on | What it does |
|---|---|---|
| `t3q.py` | macOS, Linux, Windows | Read-only queries of T3 Code's local database: `overview`, `waiting`, `thread`, `projects`, `health`, `usage`. No token needed. |
| `t3ctl` | macOS, Linux, Windows | Small client for T3 Code's local API: list projects/threads/models, start a thread, send a follow-up (steered into a running run, or `--queue` to wait for it to end), list, steer or remove queued messages (`queue`), read replies, settle, rename, interrupt, diff, collect changed files, show a thread's open questions (`pending`, with a risk hint per approval) and answer them (`answer`). Also: usage-limit recovery (`limits`, `resume-at-reset`, `snooze-until-reset`), `snooze`, `model` switching, `search`, scheduled `tasks`, `prs` and `pr`, `fork`, `stop`, `subtasks`, `subagent-stop`, and `watch`, a change-only report for routines. `send` checks that the message really started and fixes a stuck queue once (`--no-verify` skips the check). `new`, `send` and `tasks --upsert` take `--prompt-file` (UTF-8 or UTF-16, as Windows PowerShell writes it). Run `node t3ctl` for the full usage line. |
| `t3ctl.cmd` | Windows | One-line wrapper so `t3ctl` works from `cmd`/PowerShell. |
| `t3listen` (+ `t3listen.cmd`) | macOS, Linux, Windows | Optional. Follows T3 Code's live event stream and POSTs each new thread question (and its close) to your webhook, so T3 Tots can show it on your phone and answer it with your choice. It also tells T3 Tots when a thread finishes, fails or is cancelled. No polling. Starts at login with `t3listen install`. |
| `export.js` | macOS, Linux, Windows | Read-only, redacted JSON export of a project's recent threads (feeds the reports and digests). |
| `survey.js` | macOS, Linux, Windows | Read-only activity survey: threads per project, models used, waiting and stale threads. |
| `t3ui`, `ui-*.applescript` | macOS | Optional fallback that drives the T3 Code app UI when the local API is unavailable (needs Accessibility permission). |
| `cleanup/scan.py` | macOS, Linux, Windows | Read-only disk-usage scan (allocated sizes, hardlinks counted once, duplicates, stale build folders). |
| `cleanup/make_report.py` | bot's box | Builds the interactive offline cleanup report (HTML) from a plan file. |
| `report/report.py` | bot's box | Builds the HTML project briefing from `export.js` output. |

`manifest.json` lists every file with its size, SHA-256 and target OS; `manifest.sha256` is the same list for `sha256sum -c` / `shasum -a 256 -c`.

## Answering questions from your phone (optional)

1. T3 Tots creates a webhook routine for you, then opens a Terminal (macOS) or PowerShell window (Windows) with `t3listen setup` already running. You paste two lines from the routine panel: line 1 the Webhook URL (`https://...`), line 2 the Authorization header (`Authorization: ...`). It saves them into `listen.json` in the tools folder. Only your user account can read that file, and it's never printed.
2. `node t3listen test` sends one test event. `node t3listen install` then starts the listener at login: a LaunchAgent on macOS, a hidden Task Scheduler logon task on Windows, or a systemd user unit on Linux. `t3listen status` and `t3listen uninstall` do what they say.
3. When a thread asks a question, `t3listen` POSTs `{"event":"request.opened", "machine", "threadId", "title", "project", "requestId", "kind", "createdAt", "questions":[{"id","header","question","options":[{"label","description"}],"multiSelect","allowCustomAnswer","required"}], "context", "text"}`. `context` is a short, redacted excerpt of what the thread said just before asking (up to 400 characters). When it's answered (here or in T3), cancelled or expired, it POSTs `{"event":"request.resolved", ..., "status", "answers", "answeredHere"}`. `answeredHere` is true when it was answered with `t3ctl answer` on that computer (tracked for 7 days in `answered-here.json` in the tools folder). T3 Tots answers with `t3ctl answer --thread <id> --request <id> --pick "<your choice>"`, using only your exact choice.
4. When a thread run ends and the thread is left idle, `t3listen` POSTs `{"event":"thread.finished"|"thread.failed"|"thread.cancelled", "kind":"thread-finished"|..., "machine", "threadId", "title", "project", "delegated", "runId", "status", "threadStatus", "startedAt", "completedAt", "completedAtLocal", "durationSec", "lastReply", "error", "text"}`. `lastReply` is the thread's last reply, redacted and trimmed to 600 characters; `error` appears only on `thread.failed`. Each run is reported once (run ids are kept for 14 days in `listen-state.json`), a queued message starting next is not reported as an end, and sub-task threads (`thread:delegated-task:...`) are reported only when they fail. Runs that ended while the listener was down (up to an hour) are reported when it starts again. `node t3listen preview-finish --thread <id>` prints the event for a thread's latest ended run without sending it.
5. When a run fails on a usage limit, `t3listen` turns on T3's own "Resume at reset" for the thread if its project is listed in `autoresume.json` (`{"enabled": true, "projects": ["My App"]}`, none by default) or `t3ctl new` started it (`started-here.json`). The `thread.failed` event then carries `usageLimit`, `autoResumeSet` and `resumeAt`.
6. Permission prompts (approvals) are never sent unless you add `"approvals": true` to `listen.json`. Questions older than `skipStaleMinutes` (default 1440) at startup are skipped. `node t3listen --dry-run` prints the payloads instead of sending them. If the webhook refuses an event, `listen.log` shows the status and the webhook's reply (URL and key redacted); rate limits, network errors and 5xx are retried every minute for up to 24 hours, and anything still undelivered is resent when the listener restarts.

## Developing

- `scripts/check.sh` runs every check: `node --check`, Python compile, unit tests (`node --test tests/*.test.js`), manifest freshness, CRLF in `t3ctl.cmd`, and a public-safety scan for email addresses, real home folders, and API keys. Put words that must never ship (your name, private project names) one per line in `~/.config/t3-tots/private-words.txt`. Never commit that file.
- After changing any shipped file, run `python3 scripts/make-manifest.py` to rewrite `manifest.json` and `manifest.sha256` from `VERSION`.
- Release only from a tag. The installer downloads by tag and checks every hash.

## Requirements

- **Python 3.8+** for `t3q.py` and `cleanup/scan.py` (3.9+ for `report/report.py`). Windows: use `py -3`.
- **Node 22+** for `t3ctl` and `t3listen` (Node 18+ for `export.js` and `survey.js`).
- **T3 Code** installed and opened at least once.

## Security

- `t3q.py` opens T3 Code's `statev2.sqlite` **read-only** and never writes to it. From `server-runtime.json` it reads only `host`, `port` and `pid`.
- The scripts never open T3's `secrets/` folder or any auth, token or credential file, with one exception: the node scripts read a file named `token` **next to themselves**. That token is created only if you approve it, via T3 Code's own CLI (`t3 auth session issue --scope orchestration:read --scope orchestration:operate --ttl 90d --label t3-tots`). It expires after 90 days; revoke it any time with `t3 auth session list` and `t3 auth session revoke <id>`. It is never printed.
- Everything talks only to T3 Code on `127.0.0.1`. The one exception is `t3listen`, which also POSTs question events (thread title, project name, question and options, and a short redacted excerpt of the thread's last message) and run-end events (thread title, project name, status, and its last reply trimmed to 600 characters and redacted) to the webhook in your `listen.json`, if you set one up. Exports redact common API-key patterns and your home path.
- Without a token, T3 Tots stays read-only. With one, `t3ctl answer` only ever sends the answer you chose.

## License

MIT. See [LICENSE](LICENSE).
