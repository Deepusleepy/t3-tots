---
name: t3-routes
description: >-
  How T3 Tots reaches T3 Code when this bot has a T3 connector (T3's own MCP) as
  well as the local tools: which one to use for what, and what to do when one
  fails or refuses. Read it whenever the "T3 routes" memory note exists. Also for
  "connect T3 MCP", "add MCP", "reconnect T3", "remove MCP".
---
Follow the t3-tots-rules skill (skills/t3-tots-rules/SKILL.md). Grok Bot only: other agents use `t3ctl` alone. With no "T3 routes" memory note this skill doesn't apply, and everything goes through the local tools as before.

This skill only picks the route. The other t3-* skills still say what to do. The note and its connectors belong to this bot alone: another bot of the same user has its own or none. A connector reaches every project on its computer, so a bot made for some projects keeps to those.

## Two lists
T3 Tots can reach a computer's T3 Code through **T3's MCP** (a connector named "T3 <computer>" on this bot) and through the **local tools** (`t3ctl`, `t3q.py`, run by the Grok app on that computer).

**List 1: what MCP can do. Use MCP first; the local tools are the backup.**

| Action | MCP tool |
|---|---|
| List, read, wait for threads; see what a thread is asking | `t3_thread_list`, `t3_thread_read`, `t3_thread_wait`, `t3_pending_request` (`list`, `read`) |
| Projects, models | `t3_project_list`, `orchestrator_capabilities` |
| Start a thread | `t3_thread_launch`. See "Starting a thread" |
| Send, steer, queue | `t3_thread_send`, `t3_queue` |
| Stop, interrupt | `t3_thread_interrupt` (`stop: true` stops it like the Stop button) |
| Settle, unsettle, snooze, archive, pin | `t3_thread_organize` |
| Rename; change the model | `t3_thread_update`; `t3_thread_configure` |
| Scheduled tasks | `schedule_task`, `list_scheduled_tasks`, `run_scheduled_task_now`, `delete_scheduled_task` |

Two more MCP tools are used only when that computer's Grok app is off: `t3_thread_search` ("Finding a thread") and `t3_pending_request` `respond` ("Answering").

**List 2: what MCP can't do. Always the local tools.** Approvals (`t3ctl answer --decision`), phone answers setup and `t3listen`, every `t3q.py` report (waiting, digest, usage, health), `limits`, `resume-at-reset`, `snooze-until-reset`, `queue --resume`, `diff`, `files`, `prs`, `pr`, `watch`, `export.js`, `survey.js`, archived threads. Anything in neither list uses the local tools too.

When the Grok app on that computer is off, List 2 and anything in neither list are unavailable there: say so in one line and never fake them through MCP. In particular, don't build "what's waiting" from `t3_pending_request`: it never lists approvals.

**An approval never goes through MCP.** `t3_pending_request` answers questions only. A permission request is accepted only with `t3ctl answer --request <id> --decision <option> --user-approved` after the user's yes (t3-tots-rules "Decisions"). If that computer's Grok app is off, tell the user to approve it in T3 Code.

## Which connection
For a thread on computer X, in this order:
1. X's own T3 connector.
2. The local tools on X.
3. Only when neither can be reached: another computer's T3 connector, passing X's `environmentId`, if `t3_environment_links` on that connector lists X as reachable (the user turned on Linked environments). A change that fails this way counts as "maybe sent" (below).

Every one of these acts on X, the computer that owns the thread. Never run one computer's tools, or use its connector without `environmentId`, for another computer's thread. A computer with no T3 connector uses the local tools for everything. A refusal ("When T3 refuses") is not "can't be reached": it never moves to another computer's connector.

**Finding a thread** from the user's words always uses `t3q.py thread`, as t3-tots-rules says. A computer whose Grok app is off can't run it: search that one with `t3_thread_search` through its connector. MCP search gives no score to compare. So when any computer was searched through MCP, show the top match from each computer and ask, unless one is an exact title or id. If a computer couldn't be searched at all, say so and don't pick a best match from the others.

## Calling MCP
- Pass thread and project ids exactly as T3 and `t3ctl` print them.
- Give every change whose tool takes a `clientRequestId` a new one (launch, send, interrupt, rename, `schedule_task`). Reuse one only to retry that same action with the same content.
- Access levels, lowest first: `approval-required`, `auto-accept-edits`, `auto`, `full-access`. `t3_thread_configure` with only the thread id reads a thread's level. If it is above the connector's level in the note, MCP will refuse a change: don't call it, go straight to "When T3 refuses". If you don't know the level, make the call; a refusal goes there too.
- Archive: read the thread first and don't archive one that is running.

## Starting a thread
- Mode: use the runtime mode the user names. If they name none, use the mode that project's own threads run in. Pass it as `runtimeMode`. If that is above the connector's level, it is a refusal case: ask first ("When T3 refuses"). With the local tools, pass the mode as `t3ctl new --runtime <mode>`; without it `t3ctl new` starts in Full access.
- Wait for the result (`t3_thread_wait`) only when the user wants it.
- After an MCP launch, record it: `t3ctl record --started <threadId>` on that computer (`t3ctl new` records by itself). Without it the thread is hidden from "what's waiting" and digests as agent-started, and Resume at reset isn't armed. If that computer's Grok app is off, add the thread id to a "to record" line in the "T3 routes" note. Before any action or report on a computer, run its "to record" lines first and clear them. While it stays offline, mention that those threads are missing from its reports.
- A launch that may have been sent: through MCP, call `t3_thread_launch` again with the **same** `clientRequestId` and the same content; T3 returns the thread it already made. If you no longer have that id, or it was `t3ctl new` (use the thread id if it printed one), search the project for a thread with that title made in the last few minutes before starting another, and ask if unsure. Never launch a second one on a guess.

## Answering
- A question card the user answered: when the Grok app on that computer is on, use `t3ctl answer` as t3-phone-answers says.
- When that app is off: `t3_pending_request` with `respond`, the exact answers, then `read` to see that it closed. The listener's close will then say it was answered in T3; that is expected.

## When it fails
Decide by what is known about the request, never by guessing from the error text. A failed **read** changed nothing: try it on the next connection. For a **change**, three cases:

**1. Nothing was sent.** Use the next connection in the order above.
- The connector is missing or can't connect.
- HTTP 401: the sign-in expired. Also tell the user that computer needs reconnecting ("Setup").
- HTTP 429: wait about 10 seconds and try once more first.
- `t3ctl` ended with `WRITE_STATE: none` **and** an outage word: `T3_NOT_RUNNING`, `T3_NOT_REACHABLE`, `NO_TOKEN`, `TOKEN_REJECTED`, `TOOLS_INCOMPLETE`, `NODE_TOO_OLD`.

**2. It was refused or wrong. Never moves to another connection.**
- `capability_denied`, `runtime_mode_escalation_denied`, `interaction_mode_escalation_denied`, or HTTP 403: see "When T3 refuses".
- `thread_not_found`, `invalid_request`, `target_required`: fix the call.
- `provider_unavailable`, `model_unavailable`: tell the user.
- Any other `t3ctl` status word (`AMBIGUOUS`, `NOT_PENDING`, `NEEDS_USER_APPROVAL`, `THREAD_RUNNING`, `USAGE` and so on) follows t3-tots-rules "Status words", whatever `WRITE_STATE` says.

**3. Anything else is "maybe sent".** A timeout or dropped connection, HTTP 5xx, `orchestration_error`, `WRITE_STATE: unknown` or no such line from `t3ctl` (killed, computer dropped), any failed change through a linked computer.
- Look where the change would show. A message: the thread **and** its queue (`t3_queue` `list`), since a queued message is not in the thread yet. A launch: "Starting a thread". A scheduled task: `list_scheduled_tasks`. An answer: `t3_pending_request` `read`. Settle, rename, model: read the thread.
- If it is there, stop. If it clearly is not, try again on the same connection, with the same `clientRequestId` when the tool takes one.
- Never repeat it another way while unsure; ask the user.

## When T3 refuses
The user picked an access level when they connected this bot. T3 refuses a change to a thread that runs with more freedom than that level. Don't work around it silently, and don't treat it as an outage.
- Tell the user in one line what was refused and why, and ask: "Should I do it through the local tools?" with **Yes**, **Always** and **No**. If the local tools on that computer can't run now (its Grok app is off), don't offer them: say it can be done in T3 Code, or by reconnecting this bot at a higher level.
- **Yes**: do it with the local tools, once.
- **Always**: save "refusals on <computer>: use the local tools" in the "T3 routes" note. From then on, for a thread above that connector's level, skip MCP, do it with the local tools, and say in the same message that you did. It holds for that computer until its connector is reconnected.
- **No**: stop. Tell them they can do it in T3 Code, or raise the bot's level by reconnecting.
- With nobody there to ask and no "Always" saved: don't do it; report what was refused. Delegated mode doesn't change that. So when the user turns delegated mode on for a computer whose connector is below Full access, ask this question then.

## Setup ("connect T3 MCP")
Only after the user asks. The local tools stay as they are; nothing is removed.
1. T3 Connect's free plan links 3 computers. If the user wants more than that, say so first: the others keep using the local tools, unless they unlink one or upgrade.
2. Each computer's tools must be v1.5.0 or later: `t3ctl record` must print `USAGE: record --started <threadId>`. Update with t3-install-tools first if not.
3. One line of advice before they choose a level: "Through MCP I can only change threads at or below the level you pick. New T3 threads run in Full access unless you changed that, so pick Full access for me, or I'll ask before using the local tools for those."
4. Tell the user, per computer: in T3 Code press Ctrl/Cmd+K, choose **Use T3 Code in another app (MCP)**, pick **Grok Bot**, and follow it. T3 may ask them to sign in to T3 Connect and turn it on for that computer. On the sign-in page they choose what this bot may do and press Approve. Name the connector "T3 <computer>".
5. Check it: `t3_project_list` through the new connector must list that computer's projects, and `orchestrator_capabilities` shows the level as `runtimeMode`.
6. Save one memory note "T3 routes": per computer the connector name, the level, and the sign-in date. Sign-ins last about 30 days; mention the reconnect date. Never save a URL, code or key.
Reconnect after a 401: step 4 for that computer. Remove MCP: remove the connector and the note; the local tools keep working.
