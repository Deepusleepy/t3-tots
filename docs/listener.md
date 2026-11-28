# Listener configuration (`t3listen`)

`t3listen` watches T3 Code over its local WebSocket API and posts events to one or more webhooks configured in `listen.json`.

For initial setup, approvals, and auto-resume behavior, see [t3-phone-answers](../skills/t3-phone-answers/SKILL.md). For who may answer questions and approvals, see [t3-tots-rules](../skills/t3-tots-rules/SKILL.md).

## Event size and bot cost

Every webhook post starts a bot run. The webhook routine prompt (about 2,000 characters) handles finishes, failures, summaries, and closes without loading any skill file. Questions and approvals load one small skill, [t3-event](../skills/t3-event/SKILL.md) (about 5,400 characters).

## Active-use suppression

Set `"suppressWhileActive": true` in `listen.json` to skip automatic webhook posts while the T3 Code desktop app is in the foreground and system keyboard or mouse input happened within the last 15 minutes. Set `"activeIdleMinutes"` to a positive number (for example `5`) to change the idle window.

- Off by default.
- Works on macOS and Windows desktop. On Linux the setting has no effect and `node t3listen status` says so.
- Applies to questions, approvals, run ends, failure batches, and missed-run summaries, including retries and catch-up. Test and `preview-finish` commands still run normally.
- A burst of events reuses one presence check for 10 seconds.
- Presence checks inspect only the foreground app and system-wide idle time, never window titles or thread text. Browser-only sessions, activity on another device, and failed presence checks keep normal delivery.
- Suppressed events are dropped permanently and are not sent later. The close event of a suppressed question stays quiet too. Resolutions of delivered questions still go through so the receiver can close its card (unless `filters.resolved` is `false`).
- Because the receiver gets no post for suppressed events, its delegated-mode actions do not run for them. The listener's own auto-resume logic is unchanged.

## Filters

Add a `filters` object to `listen.json` to hold back run ends that need no action. Without `filters`, every event is sent. `thread.failed`, `request.opened`, and `test` are never filtered.

| Key | Value | Effect |
|---|---|---|
| `resolved` | `false` | Do not send `request.resolved`. The phone card stays open until answered, and `t3ctl answer` returns `NOT_PENDING` if already closed in T3. |
| `finished`, `cancelled` | `false` | Do not send that event type. |
| `finished`, `cancelled` | `{ "postWhen": [...], "skipWhen": [...] }` | Send only when the run's last reply matches a `postWhen` pattern (if any are listed) and matches no `skipWhen` pattern. Runs without a reply are always sent. |
| `negations` | list of strings | Words that invalidate a `notNegated` match. Default: `no`, `not`, `nothing`, `none`, `never`, `neither`, `nor`, `without`, `unless`, `n't`. |

Each pattern is either a JavaScript regex string or an object:

- `pattern` holds the regex string.
- `flags` sets regex flags (for example `"i"`). The `m` flag is always added so `^` and `$` match each line.
- `lines` chooses which part of the reply to test: `all` (default), `first`, `last`, or `edge` (first line and last line tested separately).
- `notNegated` set to `true` counts a match only when its clause has no negation word before it. Clauses end at `.`, `!`, `?`, or `;` followed by whitespace or line end, at `,`, or at a line break. Curly apostrophes count as `'`.

Filters inspect the full last reply (not only the 600-character `lastReply` snippet). Each regex check has a 1-second timeout; a backtracking pattern that exceeds 1 second is cut off, the event is sent, and `listen.log` logs it. Filtered run ends are logged and marked reported so restarts do not send them later.

Run `node t3listen preview-finish --thread <id>` to test whether filters would hold an event back, and `node t3listen status` to check active filters. Invalid filter values stop startup with `BAD_LISTEN_CONFIG`. Unknown keys are ignored and logged so a newer config never breaks an older listener.

Example filter configuration:

```json
"filters": {
  "finished": {
    "postWhen": [
      "^[ \\t>*_`#-]*(STUCK|BLOCKED)\\b(?!-)",
      { "pattern": "^[ \\t>*_`#-]*(stuck|blocked|error)\\b(?!-)", "flags": "i", "lines": "edge" },
      { "pattern": "usage.?limit|(?<![#\\d])\\b429\\b|too many requests", "flags": "i", "lines": "edge", "notNegated": true },
      { "pattern": "\\b(needs?|requires?) (a |an |your )?decisions?\\b|\\bdecision (is )?needed\\b", "flags": "i", "notNegated": true }
    ]
  },
  "cancelled": {
    "skipWhen": [
      "\\bWAITING\\b[^\\n]*\\b([Ww]atch|[Ww]akes?\\b|[Ww]ake-?up|[Mm]onitor|[Pp]oll)"
    ]
  }
}
```

## Busy-setup and outage settings

Built-in protections (always on):

- **Run-end summaries.** Finishes and cancels older than `catchUpMinutes`, over `runEndsPerMinute`, arriving during a rate-limit pause, or undelivered for an hour are combined into one `thread.missed.summary`. Failures, questions, and filtered-out run ends never go into this summary.
- **Rate-limit pauses.** On HTTP 429 (or a reply mentioning "rate limit" or "too many requests"), posting pauses until `Retry-After` or for 15 minutes. The pause survives restarts. Questions and failures are queued and sent first once the pause ends.
- **Priority delivery.** Catch-up runs beside the live stream so live questions and failures go out immediately. On timeouts or 5xx responses, retries back off cleanly with questions and failures first.
- **No duplicates.** Events waiting for retry are not re-queued on reconnect. Timed-out posts (including HTTP 504) retry 3 times; finishes and cancels then move to the summary, while questions and failures retry hourly for a day. Closed questions are never sent late.

Optional `listen.json` settings:

| Setting | Default | Effect |
|---|---|---|
| `catchUpMinutes` | `30` | After a restart or reconnect, send individual finishes and cancels from at most this many minutes back. Older ones go into `thread.missed.summary`. `0` skips all pre-reconnect run ends. Failures always catch up in full. |
| `runEndsPerMinute` | `10` | Maximum individual finishes and cancels sent per minute before combining into `thread.missed.summary`. `0` combines all of them. |
| `failureWaveSeconds` | `20` | Wait window to group simultaneous `thread.failed` events into one `thread.failed.batch`. Resets on each new failure. One lone failure still sends as `thread.failed`. `0` disables batching. |
| `failureWaveMaxSeconds` | `120` | Hard cap on how long a failure wave waits after the first failure. |
| `repeatFailureHours` | `0` (off) | Suppress repeat failures on the same thread with the same normalized error within this window. Usage-limit stops that need manual action are never suppressed. The next sent failure includes `repeatsSuppressed` and `repeatsSince`. |

Example `listen.json`:

```json
{
  "url": "https://...",
  "headers": { "Authorization": "..." },
  "catchUpMinutes": 2,
  "failureWaveSeconds": 45,
  "failureWaveMaxSeconds": 120,
  "repeatFailureHours": 6
}
```

### Summary and batch payloads

`thread.missed.summary` includes `machine`, `count`, `firstAt`, `firstAtLocal`, `lastAt`, `lastAtLocal`, `threads` (up to 20 titles), `text`, and `eventId`.

`thread.failed.batch` looks like this:

```json
{
  "event": "thread.failed.batch",
  "kind": "thread-failed-batch",
  "machine": "laptop",
  "title": "3 threads",
  "count": 3,
  "firstAt": "2026-11-03T10:00:01.000Z",
  "lastAt": "2026-11-03T10:00:09.000Z",
  "firstAtLocal": "Nov 3, 11:00 AM CET",
  "lastAtLocal": "Nov 3, 11:00 AM CET",
  "failures": [
    {
      "threadId": "...",
      "title": "Fix login",
      "project": "web",
      "delegated": false,
      "runId": "...",
      "status": "failed",
      "error": "Provider error 503",
      "startedAt": "...",
      "completedAt": "...",
      "completedAtLocal": "...",
      "durationSec": 41,
      "lastReply": "...",
      "usageLimit": true,
      "autoResumeSet": false,
      "repeatsSuppressed": 2,
      "repeatsSince": "..."
    }
  ],
  "text": "T3 failure wave on laptop: 3 threads failed between ...",
  "sentAt": "...",
  "eventId": "..."
}
```

`usageLimit`, `autoResumeSet`, `resumeAt`, and `repeatsSuppressed` appear only when applicable.

## Multiple bots and subscriptions

One listener can route events to multiple webhooks. The `main` bot receives everything until you unsubscribe it from specific projects or event kinds. Additional bots receive only what they subscribe to.

```sh
node t3listen bot add site --project "my-site"
node t3listen bot add alerts --events failed
node t3listen unsubscribe main --project "my-site"
node t3listen unsubscribe main --events finished,cancelled
node t3listen subscribe main --project "my-site"
node t3listen bots
node t3listen test --bot site
node t3listen bot remove site
```

- Event kinds: `questions`, `approvals`, `finished`, `cancelled`, `failed`.
- Pass `--everything` to `bot add` for a full second copy of all events.
- `--project` accepts a title or project ID (repeatable) and saves by ID so renaming a project does not break routing.
- Webhook URLs and Authorization headers are read from stdin and never printed.
- A running listener picks up `listen.json` edits within a few seconds without restarting.
- Each bot keeps its own retry queue, rate-limit pause, run-end limit, and missed-run summary so one slow or failing bot never blocks another.
- Question close events go to the same bots that received the opening event. Events include both `projectId` and `project`.
- In `listen.json`, subscriptions live under `"main": { "skip": [...] }` and `"bots": { "<name>": { "url", "headers", "only": [...], "skip": [...] } }`, where each rule is `{ "projects": [{ "id", "title" }], "events": [...] }`.
