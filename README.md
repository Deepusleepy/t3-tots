# T3 Tots tools

Helper scripts for **T3 Tots**, a chat companion for [T3 Code](https://github.com/pingdotgg/t3code). T3 Tots tells you what your coding-agent threads are doing and what's waiting on you, starts threads and follow-ups, makes project reports and digests, watches long runs, and keeps your computers updated and tidy.

Free and open source (MIT). No accounts, no telemetry, nothing phones home.

You normally don't install these by hand: the T3 Tots bot downloads them on its first chat, after you say yes, and checks every file against pinned SHA-256 fingerprints before using it. Agents: see [AGENTS.md](AGENTS.md).

## What's here

| File | Runs on | What it does |
|---|---|---|
| `t3q.py` | macOS, Linux, Windows | Read-only queries of T3 Code's local database: `overview`, `waiting`, `thread`, `projects`, `health`, `usage`. No token needed. |
| `t3ctl` | macOS, Linux, Windows | Small client for T3 Code's local API: list projects/threads/models, start a thread, send a follow-up, read replies, settle, rename, interrupt, diff, collect changed files. |
| `t3ctl.cmd` | Windows | One-line wrapper so `t3ctl` works from `cmd`/PowerShell. |
| `export.js` | macOS, Linux, Windows | Read-only, redacted JSON export of a project's recent threads (feeds the reports and digests). |
| `survey.js` | macOS, Linux, Windows | Read-only activity survey: threads per project, models used, waiting and stale threads. |
| `t3ui`, `ui-*.applescript` | macOS | Optional fallback that drives the T3 Code app UI when the local API is unavailable (needs Accessibility permission). |
| `cleanup/scan.py` | macOS, Linux, Windows | Read-only disk-usage scan (allocated sizes, hardlinks counted once, duplicates, stale build folders). |
| `cleanup/make_report.py` | bot's box | Builds the interactive offline cleanup report (HTML) from a plan file. |
| `report/report.py` | bot's box | Builds the HTML project briefing from `export.js` output. |

`manifest.json` lists every file with its size, SHA-256 and target OS; `manifest.sha256` is the same list for `sha256sum -c` / `shasum -a 256 -c`.

## Requirements

- **Python 3.8+** for `t3q.py` and `cleanup/scan.py` (3.9+ for `report/report.py`). Windows: use `py -3`.
- **Node 22+** for `t3ctl` (Node 18+ for `export.js` and `survey.js`).
- **T3 Code** installed and opened at least once.

## Security

- `t3q.py` opens T3 Code's `statev2.sqlite` **read-only** and never writes to it. From `server-runtime.json` it reads only `host`, `port` and `pid`.
- The scripts never open T3's `secrets/` folder or any auth, token or credential file, with one exception: the node scripts read a file named `token` **next to themselves**. That token is created only if you approve it, via T3 Code's own CLI (`t3 auth session issue --scope orchestration:read --scope orchestration:operate --ttl 90d --label t3-tots`). It expires after 90 days; revoke it any time with `t3 auth session list` and `t3 auth session revoke <id>`. It is never printed.
- Everything talks only to T3 Code on `127.0.0.1`. Exports redact common API-key patterns and your home path.
- Without a token, T3 Tots stays read-only.

## License

MIT. See [LICENSE](LICENSE).
