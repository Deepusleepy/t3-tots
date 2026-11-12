# T3 Tots

Grok Bot / chat companion for [T3 Code](https://github.com/pingdotgg/t3code), with skills and helper tools. Thread status, waiting items, new threads, answers, reports, watches, and updates.

T3 Tots is unofficial. `t3ctl` and `t3listen` use T3 Code's internal local websocket API, which isn't public or stable, and `t3q.py` reads its database read-only. A T3 Code update can break them. T3 Code now has an official [MCP server for outside agents](https://github.com/pingdotgg/t3code/blob/main/docs/user/outside-agents.md) and a `t3 thread` command. They don't cover everything T3 Tots does yet, such as permission approvals, live events to a webhook, resuming a stuck queue and usage-limit recovery. T3 Tots moves features onto the official interfaces as they gain coverage.

[MIT](LICENSE). No accounts or telemetry. The only outbound send is optional `t3listen` to a webhook you set up.

Start with [t3-getting-started](skills/t3-getting-started/SKILL.md). Install and verify by following [AGENTS.md](AGENTS.md). Shared rules: [t3-tots-rules](skills/t3-tots-rules/SKILL.md).

## What's here

| Path | What it is |
|---|---|
| `skills/` | One folder per skill. |
| `tools/` | Scripts, installed flat into one folder per computer. |
| `manifest.json` | Version, dest path, size, SHA-256, and which OS gets each file. |
| `scripts/`, `tests/` | Checks, manifest builder, skill sync. |
| `assets/avatar.png` | Official face, 1024x1024 PNG. First setup downloads it from the pinned release, or the previous tag when that release is not cut yet. |

| Tool | Where | What |
|---|---|---|
| `t3q.py` | all | Read-only T3 DB queries. No token. |
| `t3ctl` | all | Local API client and `skills` installer. `node t3ctl` prints usage. |
| `t3listen` | all | Optional. Pushes questions and run ends to your webhook. |
| `thread-match.js` | all | Shared thread lookup used by `t3ctl` and `t3listen`. Not run on its own. |
| `export.js`, `survey.js` | all | Redacted export and activity survey. |
| `t3ui` + `ui-*.applescript` | macOS | UI fallback if the local API is down (needs Accessibility). |
| `cleanup/scan.py` | all | Read-only disk-usage scan. |
| `cleanup/make_report.py`, `report/report.py` | Grok Bot box | HTML cleanup report and briefing. |
| `t3ctl.cmd`, `t3listen.cmd` | Windows | `cmd` wrappers. From PowerShell use `node t3ctl`. |

## Install

Install from a release tag, not from `main`. Every file is checked against that tag's `manifest.json` before it is used.

**Grok Bot.** Skills are built in. Say "set up T3 Tots". After your yes it installs the tools on each computer. The template card starts as a geometric mark. On first setup the official face from [`assets/avatar.png`](assets/avatar.png) is set at the opening, before install, when that download works.

**Other agents** (Claude Code, Codex, Cursor, Hermes). Download a release or clone the tag, then install the skills:

```sh
gh release download -R Deepusleepy/t3-tots --archive tar.gz
tar xzf t3-tots-*.tar.gz && cd t3-tots-*/
node tools/t3ctl skills install --to ~/.claude/skills --dry-run
node tools/t3ctl skills install --to ~/.claude/skills
```

Clone the same tag:

```sh
git clone --branch <tag> --depth 1 https://github.com/Deepusleepy/t3-tots.git
cd t3-tots
node tools/t3ctl skills install --to ~/.claude/skills --dry-run
node tools/t3ctl skills install --to ~/.claude/skills
```

Windows: `gh release download -R Deepusleepy/t3-tots --archive zip`, expand, then `--to "$env:USERPROFILE\.claude\skills"`.

Skill folders: Claude Code `~/.claude/skills`, Codex `~/.agents/skills`, Cursor `~/.cursor/skills`, Hermes `~/.hermes/skills` (same paths under `%USERPROFILE%` on Windows). Install into one folder only. Cursor also loads the other three, so a second copy is listed twice.

Then ask the agent to set up T3 Tots. It follows [AGENTS.md](AGENTS.md) (hash-check against `manifest.json`. Grok Bot-only steps: `t3-tots-rules` "Grok Bot only"). Updates use the same commands. Edited skills are kept unless you pass `--force` (the old copy goes to `out/skills-backup/<timestamp>/`).

## Phone answers (optional)

`t3listen` POSTs live T3 events to a webhook you set up (`setup`, then `install` at login). Events: `request.opened` / `request.resolved`, and `thread.finished` / `failed` / `cancelled`. Approvals only if you turn them on. Usage-limit stops can arm T3's Resume at reset.

Setup, events, approvals, and autoresume: [t3-phone-answers](skills/t3-phone-answers/SKILL.md). Who may answer: [t3-tots-rules "Decisions"](skills/t3-tots-rules/SKILL.md).

### Active-use suppression (optional, macOS and Windows desktop)

Set `"suppressWhileActive": true` in `listen.json` to skip automatic webhook notifications while T3 Code is foreground and system input was used within the last 15 minutes. Set `"activeIdleMinutes": 5`, for example, to choose a shorter window (a positive number). Suppression is off by default and applies to questions, approvals, run ends, failure batches and the missed-run summary, including retries and catch-up. It works on macOS and Windows; on Linux the setting has no effect, and `t3listen status` says so. A burst of events shares one check for 10 seconds. Suppressed events are remembered, not sent later; the resolution of a suppressed question stays quiet too. Resolutions of delivered questions still go through, so the receiver can close its cards (unless `filters.resolved` is false). Test and dry-run/preview commands still work.

Suppression drops events permanently, including unanswered questions: if you leave before answering a suppressed question, it is not sent to your phone later. The receiver gets no POST for suppressed events, so its delegated-mode actions, such as answering a question or arming resume-at-reset, do not run for those events. The listener's own auto-resume logic is unchanged.

This checks the local macOS desktop app across all threads, without reading window titles or thread text. Windows, Linux, browser-only sessions, activity on another device and failed presence checks retain normal delivery. Input-idle time is system-wide; it cannot prove the user is reading a particular thread.

### Filters (optional)

Each POST can start work on the receiving side. If most finishes need nothing from you, add a `filters` section to `listen.json` so only the run ends that need action are sent. Without `filters` every event is sent as before. `thread.failed`, `request.opened` and `test` are never filtered.

| Key | Value | Effect |
|---|---|---|
| `resolved` | `false` | Don't send `request.resolved`. The phone then isn't told when a question is answered in T3, cancelled or expires, so its card stays until you answer it, and `t3ctl answer` says `NOT_PENDING`. |
| `finished`, `cancelled` | `false` | Don't send that event at all. |
| `finished`, `cancelled` | `{ "postWhen": [...], "skipWhen": [...] }` | Send it only when the run's own last reply matches a `postWhen` pattern (when any are listed) and no `skipWhen` pattern. A run that ended without a reply of its own is always sent. |
| `negations` | list of words | Words that make a `notNegated` match not count. Default: `no`, `not`, `nothing`, `none`, `never`, `neither`, `nor`, `without`, `unless`, `n't`. |

A pattern is a JavaScript regex string, or an object:

- `pattern`: the regex.
- `flags`: regex flags, for example `"i"`. `m` is always added, so `^` and `$` match at each line.
- `lines`: which part of the reply to test. `all` (default, the whole reply), `first`, `last`, or `edge` (the first and the last line, each on its own).
- `notNegated`: `true` means a match counts only when its clause has no negation word before it. A clause ends at `.` `!` `?` or `;` followed by a space or the line end, at `,`, or at a line break, so `v1.4` and `usage.limit` stay whole. Curly apostrophes count as `'`. "Nothing needs a decision from you" doesn't match a "needs a decision" pattern.

Filters see the whole last reply of the run that ended, not only the 600 characters in `lastReply`. They run on the listener's own thread, so each check gets 1 second: a pattern that takes longer on a reply (one that backtracks badly, such as `(a+)+b`) is cut off, the event is sent, and `listen.log` says so. Keep patterns simple. A filtered run end is logged in `listen.log` and marked as reported, so a restart doesn't send it later. `node t3listen preview-finish --thread <id>` says when filters would hold an event back, and `node t3listen status` lists which filters are on, or says the filters are invalid. A bad value, such as a pattern that doesn't compile, stops the listener at startup with `BAD_LISTEN_CONFIG` and names the setting. A key the filters don't know is ignored and listed in `listen.log` and `status`, so a newer `listen.json` never stops an older listener.

Example: send finishes only when the reply has a `STUCK` or `BLOCKED` status line, opens or closes with stuck, blocked or error, names a usage limit or HTTP 429 on its first or last line, or says something needs a decision. Skip cancels whose reply has an uppercase `WAITING` line that names a watch or wake-up still running.

```json
"filters": {
 "finished": { "postWhen": [
  "^[ \\t>*_`#-]*(STUCK|BLOCKED)\\b(?!-)",
  { "pattern": "^[ \\t>*_`#-]*(stuck|blocked|error)\\b(?!-)", "flags": "i", "lines": "edge" },
  { "pattern": "usage.?limit|(?<![#\\d])\\b429\\b|too many requests", "flags": "i", "lines": "edge", "notNegated": true },
  { "pattern": "\\b(needs?|requires?) (a |an |your )?decisions?\\b|\\bdecision (is )?needed\\b", "flags": "i", "notNegated": true }
 ] },
 "cancelled": { "skipWhen": [
  "\\bWAITING\\b[^\\n]*\\b([Ww]atch|[Ww]akes?\\b|[Ww]ake-?up|[Mm]onitor|[Pp]oll)"
 ] }
}
```

### Listener settings for busy setups (optional)

Each POST can start work on the receiving side, so the listener limits bursts by itself and `listen.json` has a few optional settings that cut repeats.

Built in, with no setting:

- **Run ends are combined when there are too many or they are old.** A finish or cancel gets its own message only when it is fresh and few are going out. It is counted instead when it is older than `catchUpMinutes` at a restart or reconnect, when more than `runEndsPerMinute` (default 10) went out in the last minute, when the webhook is rate limited, or when it could not be delivered for an hour. The counted ones are sent together as one `thread.missed.summary`, usually within a few seconds. Failures and questions are never combined. Run ends your `filters` would hold back are left out of the count too. The count is saved, so a refused summary is tried again, also after a restart.
- **A rate limit stops all sending.** When the webhook answers HTTP 429, or any reply that says "rate limit" or "too many requests", nothing more is posted until its `Retry-After` time, or for 15 minutes when it gives none. Questions and failures are kept and sent afterwards, first. Finishes and cancels from that time go into the summary. The pause survives a restart.
- **Questions and failures don't wait.** Catch-up after a restart or reconnect runs beside the live stream, so a question or failure that happens meanwhile is sent at once. When the webhook gives no answer or a 5xx, the listener tries it once, keeps what follows without trying again for each event, retries after 5 seconds and then each minute, questions and failures first.

| Setting | Default | What it does |
|---|---|---|
| `catchUpMinutes` | `30` | After a restart or a lost connection to T3, report finishes and cancels from at most this many minutes back. Older ones from the outage go into one `thread.missed.summary`. `0` reports none from before the reconnect; a large number such as `100000` sends every one, as before v1.4.32. Failures are always caught up back to the last connection, so a usage-limit stop from the outage still gets Resume at reset. Questions are not affected (`skipStaleMinutes` covers them). |
| `runEndsPerMinute` | `10` | How many finishes and cancels may go out on their own in one minute. The rest are combined into `thread.missed.summary`. `0` combines every one. |
| `failureWaveSeconds` | `0` (off) | Hold each `thread.failed` this many seconds for more failures. The wait starts again with each new failure. One failure alone is still sent as a plain `thread.failed`. Two or more are sent once as `thread.failed.batch`. `20` works well. Turn it on only after the receiving routine knows `thread.failed.batch` (update the t3-phone-answers skill first): an older routine ignores events it doesn't know. |
| `failureWaveMaxSeconds` | `120` | The longest a wave is held after its first failure, however many follow. |
| `repeatFailureHours` | `0` (off) | When a thread fails again with the same error as its last sent failure within this many hours, hold it back. Ids, timestamps, clock times and numbers of 4 or more digits in the error don't count as a difference; shorter numbers such as HTTP status codes do. A usage-limit stop is held only when Resume at reset is set for it, so one that needs you is always sent. The next failure that is sent for that thread carries `repeatsSuppressed` (how many were held back) and `repeatsSince`, even after a restart. |

```json
{ "url": "https://...", "headers": { "Authorization": "..." }, "catchUpMinutes": 2, "failureWaveSeconds": 20, "failureWaveMaxSeconds": 120, "repeatFailureHours": 6 }
```

A `thread.missed.summary` event carries `machine`, `count`, `firstAt`/`firstAtLocal`, `lastAt`/`lastAtLocal`, `threads` (up to 20 thread titles), `text` and `eventId`. Update the t3-phone-answers skill with the listener: an older routine ignores events it doesn't know, so it would say nothing about those run ends.

A `thread.failed.batch` event looks like this. Each entry in `failures` has the same fields as a `thread.failed` event, without `event`, `kind`, `machine`, `text`, `sentAt` and `eventId`:

```json
{
 "event": "thread.failed.batch", "kind": "thread-failed-batch", "machine": "laptop", "title": "3 threads", "count": 3,
 "firstAt": "2026-11-03T10:00:01.000Z", "lastAt": "2026-11-03T10:00:09.000Z", "firstAtLocal": "Nov 3, 11:00 AM CET", "lastAtLocal": "Nov 3, 11:00 AM CET",
 "failures": [
  { "threadId": "...", "title": "Fix login", "project": "web", "delegated": false, "runId": "...", "status": "failed", "error": "Provider error 503",
    "startedAt": "...", "completedAt": "...", "completedAtLocal": "...", "durationSec": 41, "lastReply": "...", "usageLimit": true, "autoResumeSet": false, "repeatsSuppressed": 2, "repeatsSince": "..." }
 ],
 "text": "T3 failure wave on laptop: 3 threads failed between ...", "sentAt": "...", "eventId": "..."
}
```

`usageLimit`, `autoResumeSet`, `resumeAt` and `repeatsSuppressed` appear only when they apply, as on `thread.failed`. Each run in a batch is marked as reported, so a restart doesn't send it again. A failure still waiting in a wave, or still unsent, is resent once when the listener restarts; a reconnect to T3 doesn't send it twice. `node t3listen status` lists which of these settings are on. `node t3listen preview-finish --thread <id>` says when a failure would be held back as a repeat.

### More bots and subscriptions (optional)

One listener can send to several bots. The main bot is the webhook from `setup`, and it gets everything until you unsubscribe it from something. Any other bot gets only what it is subscribed to: one project, several, or certain kinds of event from anywhere. Several bots can get the same project, and each gets its own copy. What no bot is subscribed to is sent to nobody.

```sh
node t3listen bot add site --project "my-site"            # paste that bot's webhook URL, then its Authorization line
node t3listen bot add alerts --events failed              # failures from every project
node t3listen unsubscribe main --project "my-site"        # the main bot stops getting my-site
node t3listen unsubscribe main --events finished,cancelled
node t3listen subscribe main --project "my-site"          # undo
node t3listen bots                                        # who gets what
node t3listen test --bot site
node t3listen bot remove site
```

- Event kinds: `questions`, `approvals`, `finished`, `cancelled`, `failed`.
- `--project` takes a title or an id and can be repeated. It is looked up in the running T3 Code and saved by id, so renaming a project changes nothing.
- A bot's webhook URL and key are read from stdin, as in `setup`, and are never printed. Commands and `status` show only names and subscriptions.
- A running listener picks a change up within a minute. Nothing needs reinstalling.
- Each bot has its own rate-limit pause, run-end limit, summary and retries, so a bot that is slow, refusing or over its limit never holds up another.
- A question's close goes to the bots its opening went to. Events carry `projectId` next to `project`.
- In `listen.json` this is `"main": { "skip": [...] }` and `"bots": { "<name>": { "url", "headers", "only": [...], "skip": [...] } }`. Each rule is `{ "projects": [{ "id", "title" }], "events": [...] }` with either part optional. A bot gets an event unless it has `only` rules and none matches, or a `skip` rule matches.

## Delegated mode and approvals

Delegated mode starts only when you hand over control, for example "I'm away, keep it moving". The agent then answers routine questions, nudges stalled threads, and resumes threads after a usage limit.

Even a full-access thread can stop on "Allow running this command?" when a safety check flags it, for example a git hook that asks before `git reset --hard`. In delegated mode the agent never says yes to these. It declines them with `t3ctl answer --decision decline --redirect`, which tells the thread not to retry or work around it, to use a safer way or skip that step, and to keep going. You get the list of what was declined and why when you're back.

When you're around, each approval comes to you as a card with the reason it asks, and the agent accepts it only after your yes for that request. `t3ctl answer` backs this up. An accept without `--user-approved` is refused with `NEEDS_USER_APPROVAL`, and nothing is sent.

Threads that `t3ctl new` and `t3ctl tasks --upsert` start run in full access unless you pass `--runtime`.

## Requirements

- **Python 3.8+** for `t3q.py` and `cleanup/scan.py` (3.9+ for `report/report.py`). Windows: `py -3`.
- **Node 22+** for `t3ctl` and `t3listen` (Node 18+ for `export.js` and `survey.js`).
- **T3 Code** installed and opened at least once.

## Security

- `t3q.py` opens `statev2.sqlite` read-only. From `server-runtime.json` it reads only `host`, `port` and `pid`.
- Scripts never open T3's `secrets/` or other credentials. The only token they read sits next to them, after your yes, with a 90-day TTL, and is never printed. Issue and revoke: [t3-tots-rules "Token"](skills/t3-tots-rules/SKILL.md).
- Traffic stays on `127.0.0.1` except optional `t3listen` POSTs to your webhook. Exports redact API-key patterns and your home path.
- No token: read-only. With one, `t3ctl answer` sends only the answer you chose, and accepts an approval only with `--user-approved`. `t3ctl skills` writes only into `--to` and its own `out/`.

Report issues in [SECURITY.md](SECURITY.md).

## Developing

- `scripts/check.sh`. Syntax, tests, manifest freshness, CRLF on the Windows wrappers, private-word scan. Never-ship words go one per line in `~/.config/t3-tots/private-words.txt` (do not commit it). No list fails the check. `T3TOTS_NO_PRIVATE_WORDS=1` skips it on purpose.
- After changing a tool, add it to `TOOLS` in `scripts/make-manifest.py` and run that script. It rewrites `manifest.json` from `VERSION`.
- `scripts/sync-skills --from <folder>` (or `T3TOTS_SKILLS_SRC`) copies live skills into `skills/`, scans for private details, and updates the manifest. It copies nothing if the scan fails.
- Never decide an approval by reading its text. T3 often shows a description instead of the command. Approval decisions go through `approvalAuthority`.
- Release only from a tag. Installers download by tag and check every hash.
