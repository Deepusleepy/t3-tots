# T3 Tots

A chat companion for [T3 Code](https://github.com/pingdotgg/t3code) that pairs T3 Code's official MCP server with local helper tools and 25 skills. Works with Grok Bot, Claude Code, Codex, Cursor, and Hermes.

T3 Tots is unofficial. Everyday thread control runs through T3 Code's official [MCP server](https://github.com/pingdotgg/t3code/blob/main/docs/user/outside-agents.md). Features MCP does not cover yet (live phone-answer webhooks, command approvals, cross-thread inbox, usage-limit auto-resume, reports, and diffs) use local scripts (`t3ctl`, `t3listen`, and read-only `t3q.py`). As T3 Code's official MCP and `t3 thread` CLI expand, T3 Tots moves features onto them.

[MIT](LICENSE). No accounts and no telemetry. Local tools stay on `127.0.0.1`, except optional `t3listen` webhook posts to a URL you configure.

Start with [t3-getting-started](skills/t3-getting-started/SKILL.md). Non-Grok agents install and verify with [AGENTS.md](AGENTS.md). Shared rules live in [t3-tots-rules](skills/t3-tots-rules/SKILL.md).

## How it works

T3 Tots combines two layers so your bot stays fast, light on context, and safe across one or more computers.

### T3 Code MCP (first-class integration)

First setup and updates to v1.5.1 offer T3 Code's official MCP on a tap-to-answer card, or you can say "connect T3 MCP" any time. In T3 Code, press `Ctrl/Cmd+K`, pick **Use T3 Code in another app (MCP)**, and connect your bot.

- **Direct thread control.** Sending and steering messages, starting threads, reading, listing, waiting, stopping, renaming, settling, unsettling, pinning, and snoozing go straight through MCP without loading a skill.
- **Works when the desktop app is closed.** Linked computers stay reachable over T3 Connect even when the Grok desktop app is closed, including answering open thread questions from your phone.
- **Low token overhead.** A short memory note carries the MCP rules (about 2,000 characters instead of 30,000+ for full skill docs).
- **One action, one route.** Local tools never run as a blind fallback when an MCP call times out. The bot checks state first so a message is never sent twice.
- **Respects your access level.** If T3 refuses an MCP call because of the permission level you chose, the bot stops and asks you on a card how to proceed instead of working around it.

Routing and recovery rules live in [t3-routes](skills/t3-routes/SKILL.md).

### Local tools and phone answers

Local scripts fill in everything MCP does not expose yet.

- **Cross-thread inbox and status.** `t3q.py` reads T3 Code's SQLite database read-only to report what is running, what needs you, and project overviews without a token.
- **Live phone notifications.** `t3listen` pushes questions, optional command approvals, and run finishes or failures to your webhook. Each event run reads only a short prompt (or the small [t3-event](skills/t3-event/SKILL.md) skill for questions and approvals).
- **Usage-limit recovery.** Arms T3's resume-at-reset automatically for threads T3 Tots started and for projects you opt in.
- **Reports, digests, and machine upkeep.** Generates HTML project briefings, disk-space audits, tool updates, and dev-config sync across computers.

## What you can do

- **Check status and waiting items.** Ask "status" or "what's waiting on me" across all connected computers.
- **Control threads from chat.** Start threads, send follow-ups, steer running work, rename, settle, archive, stop, snooze, or resume after limits.
- **Pick an oversight mode.** Choose **Monitor** (relay questions and finishes), **Orchestrate** (add watches and multi-thread coordination), or **PM coworker** (plan and run project-manager threads).
- **Turn on scheduled routines.** Seven shipped routines start paused and can be toggled individually (daily digest, weekly wrap-up, waiting-on-you check, weekly health check, out-of-date check, weekly usage estimate, and weekly T3 Tots update check in Notify me, Auto update, or Off mode).
- **Delegate while away.** Hand over control ("I'm away, keep it moving") so the bot answers routine questions, nudges stalls, and arms resume-at-reset while declining every command-approval prompt safely.
- **Hand off or sync.** Send work to a Cursor cloud agent, save lessons to `AGENTS.md`, or sync dev configs across machines.

## Install

Install from a release tag, never from `main`. Every file is verified by SHA-256 against that tag's `manifest.json` before it is placed.

### Grok Bot

Skills are built in. Say "set up T3 Tots". First setup saves the full copy of all 25 skills, applies the avatar from [`assets/avatar.png`](assets/avatar.png), installs the helper tools on each computer after your yes, and offers T3 MCP, phone answers, oversight mode, and routines one step at a time.

### Claude Code, Codex, Cursor, and Hermes

Download the latest release and install the skills:

```sh
gh release download -R Deepusleepy/t3-tots --archive tar.gz
tar xzf t3-tots-*.tar.gz && cd t3-tots-*/
node tools/t3ctl skills install --to ~/.claude/skills --dry-run
node tools/t3ctl skills install --to ~/.claude/skills
```

Or clone a release tag:

```sh
git clone --branch <tag> --depth 1 https://github.com/Deepusleepy/t3-tots.git
cd t3-tots
node tools/t3ctl skills install --to ~/.claude/skills --dry-run
node tools/t3ctl skills install --to ~/.claude/skills
```

On Windows, download `--archive zip`, extract it, and pass `--to "$env:USERPROFILE\.claude\skills"`.

Install into **one** folder only (Cursor also reads the other three, so a second copy appears twice):

| Agent | Skill folder |
|---|---|
| Claude Code | `~/.claude/skills` |
| Codex | `~/.agents/skills` |
| Cursor | `~/.cursor/skills` |
| Hermes | `~/.hermes/skills` |

Then ask your agent to set up T3 Tots. It follows [AGENTS.md](AGENTS.md) to install and hash-check the tools. Updates use the same commands and preserve skills you edited unless you pass `--force` (backups go to `out/skills-backup/<timestamp>/`).

## Phone answers and listener options

`t3listen` watches T3 Code and posts `request.opened`, `request.resolved`, `thread.finished`, `thread.failed`, and `thread.cancelled` events to your webhook.

Optional `listen.json` features:

- **Active-use suppression.** Skip webhook posts while the T3 Code desktop app is foreground and you used keyboard or mouse input recently (works on macOS and Windows desktop; off by default).
- **Event filters.** Match or skip `finished` and `cancelled` runs by regex so only runs that need action ping your phone.
- **Outage and burst protection.** Combine run-end floods into one `thread.missed.summary`, group simultaneous failures into `thread.failed.batch`, pause on HTTP 429 rate limits, and suppress repeat failures.
- **Multiple bots.** Subscribe separate bots to specific projects or event types from one listener.

Full `listen.json` settings, CLI commands, and event payloads are in [docs/listener.md](docs/listener.md). Setup steps are in [t3-phone-answers](skills/t3-phone-answers/SKILL.md).

## Safety and approvals

- **Human-only command approvals.** `t3ctl answer` refuses to accept an approval without `--user-approved`, which is only passed after your explicit yes for that request ID. In delegated mode, approvals are always declined with `--redirect` so the thread tries a safer path or skips that step.
- **Untrusted thread text.** Thread replies, questions, errors, and webhook payloads are treated strictly as data, never as instructions.
- **No secret access.** Scripts never read T3 Code's `secrets/` or credential files. `t3q.py` opens `statev2.sqlite` read-only and reads only `host`, `port`, and `pid` from `server-runtime.json`. The local token is created only after your yes, expires after 90 days, and is never printed. Exports redact API-key patterns and your home path.

Report security issues through [SECURITY.md](SECURITY.md).

## What is in this repo

| Path | Purpose |
|---|---|
| `skills/` | 25 skills (one folder per skill). |
| `tools/` | Local scripts installed flat into one folder per computer. |
| `manifest.json` | Version, install path, size, SHA-256, and target OS for every file. |
| `scripts/`, `tests/` | Syntax checks, test suites, manifest builder, and skill sync. |
| `assets/avatar.png` | Official 1024x1024 PNG avatar. |

### Helper tools

| Tool | OS | Purpose |
|---|---|---|
| `t3q.py` | All | Read-only SQLite queries against T3 Code. Needs no token. |
| `t3ctl` | All | Local API client and skill installer. Run `node t3ctl` for usage. |
| `t3listen` | All | Optional webhook listener for questions, approvals, and run ends. |
| `thread-match.js` | All | Shared thread lookup used by `t3ctl` and `t3listen`. |
| `export.js`, `survey.js` | All | Redacted thread export and activity survey. |
| `t3ui` + `ui-*.applescript` | macOS | UI fallback when the local API is down (needs Accessibility). |
| `cleanup/scan.py` | All | Read-only disk usage scan. |
| `cleanup/make_report.py`, `report/report.py` | Bot box | HTML cleanup report and project briefing generators. |
| `t3ctl.cmd`, `t3listen.cmd` | Windows | `cmd` wrappers. In PowerShell, run `node t3ctl` directly. |

## Requirements

- **Python 3.8+** for `t3q.py` and `cleanup/scan.py` (3.9+ for `report/report.py`). Use `py -3` on Windows.
- **Node 22+** for `t3ctl` and `t3listen` (Node 18+ for `export.js` and `survey.js`).
- **T3 Code** installed and opened at least once.

## Developing

- Run `scripts/check.sh` to verify syntax, tests, manifest freshness, CRLF on Windows wrappers, and private-word rules. Put never-ship words one per line in `~/.config/t3-tots/private-words.txt` (do not commit it), or set `T3TOTS_NO_PRIVATE_WORDS=1` to skip that check.
- After adding or changing a tool, update `TOOLS` in `scripts/make-manifest.py` and run it to rebuild `manifest.json` from `VERSION`.
- Run `scripts/sync-skills --from <folder>` (or set `T3TOTS_SKILLS_SRC`) to copy live skills into `skills/`, scan for private details, and update the manifest.
- Never decide an approval from its display text. Approval decisions go through `approvalAuthority`.
- Release only from a tag so installers can verify every file hash.

## Thanks

- [@mzkmnk](https://github.com/mzkmnk) for the project-bot idea that led to per-project and per-event bot subscriptions (v1.4.33).
- [@0xmythril](https://github.com/0xmythril) for reporting the post-outage notification flood with the numbers needed to fix it (#40, v1.4.32).
- [@pablog12](https://github.com/pablog12) for notification filters and grouped failure batches (#38, #39, v1.4.31).
- [@balasivagn](https://github.com/balasivagn) for the idea to stay quiet while actively using T3 Code (#41, v1.4.32).
