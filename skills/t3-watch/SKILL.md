---
name: t3-watch
description: >-
  Watch a T3 thread, log, process, benchmark run or PR and ping the user when it
  finishes, needs them, stalls or fails, or keep threads moving while the user is
  away. Use for "ping me when <X> finishes", "watch <X>", "tell me when <X> needs
  me", "let me know when <X> is done", "monitor <X>", "keep it going overnight",
  "I'm away, handle it".
---
Follow @t3-tots-rules. A watch is a routine you create only when the user asks for one. It reports by default. In hands-off mode it may also answer, approve and nudge, under t3-tots-rules "Decisions".

## Pick the check
- A T3 thread on a computer where `t3listen` runs with phone answers on: finished, failed and cancelled events already reach chat (@t3-phone-answers). A watch is still useful for stalls, approvals and queue problems, which t3listen doesn't report.
- A T3 thread: `t3ctl watch --thread '<id>[,<id2>]' --state watch-<name>.json --json`. One call covers several threads and prints nothing when nothing changed. Give each watch routine its own state file, so two watches on one thread don't hide changes from each other.
- A log: `tail -n 30 <log>`. A process: `pgrep -fl <name>`.
- A PR: `gh pr view <n> -R <owner/repo> --json state,statusCheckRollup,reviews,comments`.
- T3 scheduled tasks: `t3ctl tasks` lists them. Create one only on an explicit ask, with `--upsert ... --disabled` first, then `--enable` once the user confirms.

## Start a watch
1. Resolve the target and take one snapshot now with the same command and state file the routine will use. It prints a `first` event with the state, and the routine's first run then reports only real changes. Tell the user the state, including any `queue-held` or `limit` it shows.
2. Create a routine that runs every 10 minutes, or every 5 if they say "soon", with the prompt below filled in.
3. Reply in one line: what you're watching, how often, and the current state.

Don't set an end time unless the user gives one. A watch runs until the user stops it. When the work finishes, say so and offer to stop it.

### Routine prompt
```
Watch <TARGET> on <COMPUTER> (machineId <ID>). Follow t3-tots-rules and t3-watch.
Mode: <report | hands-off until <end condition>>.
Check: <the command from "Pick the check">
Rules:
- No changes in the output: send nothing and write nothing to memory or a journal.
- finished: tell the user "<TARGET> finished at <time>", 2 lines of result, offer files (t3-get-output) and offer to stop this watch. Report the finish only once, and skip it if t3listen already reported it in chat. A finish can also mean the thread is asking something or has a plan ready; say which.
- question, approval-*, limit, error, queue-held, queue-stuck, stale-request, quiet, stalled, unreadable: follow t3-watch "Handle an event".
- first, state, reply: send nothing, unless the user asked for progress updates.
- Computer unreachable, or T3 closed there (`T3_NOT_RUNNING`, `T3_NOT_REACHABLE`): tell the user once, then keep checking quietly until it is back.
```

## Handle an event
In report mode, send the user one line per event: what it needs and the last reply in 200 characters or fewer. Keep watching.

In hands-off mode, act first and report after:

| Event | What to do |
|---|---|
| `question` | Answer it yourself if it's routine. Escalate product, money or publishing questions to the user. |
| `approval-low`, `approval-normal` | Accept it with `t3ctl answer --thread <t> --request <id> --decision <d>`, where `<d>` is the accept option that `t3ctl pending --thread <t> --json` lists. |
| `approval-high` | Ask the user. Don't accept it yourself. |
| `queue-stuck` | `t3ctl queue --thread <t> --resume` once. |
| `queue-held` | Leave it. Someone held it on purpose. Tell the user. |
| `limit` | If `autoResume` isn't set, run `t3ctl resume-at-reset --thread <t>`. |
| `stalled` | Read the last reply. If it is waiting on a background job, check the job. Send one nudge, for example "The capture finished; continue." Don't nudge the same stall twice. |
| `quiet` | Check `t3ctl subtasks --thread <t>` and `t3ctl read --thread <t> --last 2`. If it is truly stuck, tell the user. Don't interrupt it yourself. |
| `stale-request` | Clear it in T3 if it belongs to a finished run, else tell the user. |
| `error` | Tell the user with the error text. |
| `unreadable` | Tell the user once with the error. Keep checking. The watch reports it again only if the error changes. |

Keep a short log of what you decided and why, and send it to the user when they're back or when the watch ends.

## Hands-off mode
Start it when the user hands over control, for example "do whatever you need" or "keep it moving overnight". Before the first check:
1. Save the scope and the end condition to memory (t3-tots-rules "Decisions").
2. On a Mac, keep it awake for the run (t3-tots-rules "Computers").
3. Confirm in one line which threads, until when, and what you'll still ask about.
