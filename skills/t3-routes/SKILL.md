---
name: t3-routes
description: >-
  How T3 Tots reaches T3 Code when this bot has a T3 connector (T3's own MCP) as
  well as the local tools: which one to use for what, and what to do when one
  fails or refuses. Read it whenever the "T3 routes" memory note exists. Also for
  "connect T3 MCP", "add MCP", "reconnect T3", "remove MCP".
---
Follow the t3-tots-rules skill (skills/t3-tots-rules/SKILL.md). Grok Bot only: other agents use `t3ctl` alone. With no "T3 routes" memory note this skill doesn't apply, and everything goes through the local tools as before.

## Two lists
T3 Tots can reach a computer's T3 Code through **T3's MCP** (a connector named "T3 <computer>" on this bot) and through the **local tools** (`t3ctl`, `t3q.py`, run by the Grok app on that computer).

**List 1: what MCP can do. Use MCP first; the local tools are the backup.**

| Action | MCP tool |
|---|---|
| List, read, wait for, search threads; see what a thread is asking | `t3_thread_list` (`allProjects: true` for every project), `t3_thread_read`, `t3_thread_wait`, `t3_thread_search`, `t3_pending_request` (`list`, `read`) |
| Projects, models | `t3_project_list`, `orchestrator_capabilities` |
| Start a thread | `t3_thread_launch` with `projectId`, `title`, `message`. See "Starting a thread" |
| Send, steer, queue | `t3_thread_send` (`mode`: `auto`, `queue`, `steer`, `restart`), `t3_queue` (`list`, `read`, `edit`, `cancel`, `reorder`, `promote_to_steer`) |
| Answer a question | `t3_pending_request` (`respond`). See "Answering" |
| Stop, interrupt | `t3_thread_interrupt` (`stop: true` stops it like the Stop button) |
| Settle, unsettle, snooze, archive, pin | `t3_thread_organize` |
| Rename; change the model | `t3_thread_update`; `t3_thread_configure` |
| Scheduled tasks | `schedule_task`, `list_scheduled_tasks`, `run_scheduled_task_now`, `delete_scheduled_task` |

**List 2: what MCP can't do. Always the local tools.** Approvals (`t3ctl answer --decision`), phone answers setup and `t3listen`, every `t3q.py` report (waiting, digest, usage, health), `limits`, `resume-at-reset`, `snooze-until-reset`, `queue --resume`, `diff`, `files`, `prs`, `pr`, `watch`, `export.js`, `survey.js`, archived threads. Anything in neither list uses the local tools too.

When the Grok app on that computer is off, List 2 and anything in neither list are unavailable there: say so in one line and never fake them through MCP. In particular, don't build "what's waiting" from `t3_pending_request`: it never lists approvals.

**An approval never goes through MCP.** `t3_pending_request` answers questions only. A permission request is accepted only with `t3ctl answer --request <id> --decision <option> --user-approved` after the user's yes (t3-tots-rules "Decisions"). If that computer's Grok app is off, tell the user to approve it in T3 Code.

## Which connection
For a thread on computer X, in this order:
1. X's own T3 connector.
2. The local tools on X.
3. Only when neither works: another computer's T3 connector, passing X's `environmentId`, if `t3_environment_links` on that connector lists X as reachable (the user turned on Linked environments). Reads and changes are both allowed. A change that fails this way counts as "maybe sent" (below).

Every one of these acts on X, the computer that owns the thread. Never run one computer's tools, or use its connector without `environmentId`, for another computer's thread. A computer with no T3 connector uses the local tools for everything.

**Finding a thread.** t3-tots-rules says to search every computer with `t3q.py thread`. A computer whose Grok app is off can't run it: search that one with `t3_thread_search` through its connector. MCP search gives no score to compare with `t3q.py`'s. So when any computer was searched through MCP, show the top match from each computer and ask, unless one is an exact title or id. If a computer couldn't be searched at all, say so and don't pick a best match from the others.

## Calling MCP
- Pass thread and project ids exactly as T3 and `t3ctl` print them. Pass only the arguments a tool declares.
- Reads default to a few short items. Ask for what you need with `limit` and `maxCharsPerItem`, and page with `afterPosition`.
- Give each launch, send and interrupt a new `clientRequestId`. Reuse one only to retry that same action with the same content.
- Before a change to a thread, you usually know its `runtimeMode` from a read. If it is above the connector's level in the note, MCP will refuse: don't call it, go straight to "When T3 refuses". If you don't know the mode, make the call; a refusal goes there too.
- Archive: read the thread first and don't archive one that is running (MCP would stop it without a word).
- Outside clients can't use the tools that act as a thread (`delegate_task`, `create_threads`, previews, devices, worktree handoff).

## Starting a thread
- Mode: use the runtime mode the user names. If they name none, use the mode that project's own threads run in (read one). If that is above the connector's level, it is a refusal case: ask first ("When T3 refuses"). With the local tools, pass the mode as `t3ctl new --runtime <mode>`; without it `t3ctl new` starts in Full access.
- Wait for the result (`t3_thread_wait`) only when the user wants it.
- After an MCP launch, record it: `t3ctl record --started <threadId>` on that computer (`t3ctl new` records by itself). Without it the thread is hidden from "what's waiting" and digests as agent-started, and Resume at reset isn't armed. If that computer's Grok app is off, add the thread id to a "to record" line in the "T3 routes" note. Before any action or report on a computer, run its "to record" lines first and clear them. While it stays offline, mention that those threads are missing from its reports.
- A launch that may have been sent (timeout, dropped connection): call `t3_thread_launch` again with the **same** `clientRequestId` and the same content; T3 returns the thread it already made, so there is no need to look first. If you no longer have that id, search the project for a thread with that title made in the last few minutes before starting another, and ask if unsure. Never launch a second one on a guess.

## Answering
- A question card the user answered: when the Grok app on that computer is on, use `t3ctl answer` as t3-phone-answers says. It records the answer by itself.
- When that app is off: `t3_pending_request` with `respond`, the exact answers, then `read` to see that it closed. The listener's close will say it was answered in T3; that is expected, so don't report it as news.

## When it fails
Decide by what is known about the request, never by guessing from the error text.

| What happened | Meaning | Do |
|---|---|---|
| The connector is missing, can't connect, or says the sign-in expired (HTTP 401 or 403) | Nothing was sent | Use the next connection in the order above. After a 401, tell the user that computer needs reconnecting ("Setup" below) |
| The connector answers HTTP 429 or 5xx | Nothing was done | Wait about 10 seconds and try once more, then use the next connection |
| A timeout or dropped connection after the call left, or `orchestration_error`; any failed change through a linked computer | Maybe sent | Look first: read the thread **and** its queue (`t3_queue` `list`), since a queued message is not in the thread yet. If it is there, stop. If both clearly show nothing, retry the same connection with the same `clientRequestId`. Never repeat it another way while unsure; ask the user |
| `t3ctl` ended with `WRITE_STATE: none` | Nothing was sent | The other connection is fine |
| `t3ctl` ended with `WRITE_STATE: unknown`, or gave no such line (killed, computer dropped) | Maybe sent | Look first, thread and queue. `t3ctl` has no retry id, so send again only when both clearly show nothing |
| MCP refused: `capability_denied`, `runtime_mode_escalation_denied`, `interaction_mode_escalation_denied` | T3 says this connection's access level doesn't allow it. Not an outage | See "When T3 refuses" |
| `thread_not_found`, `invalid_request`, `target_required` | The call was wrong | Fix the call |
| `provider_unavailable`, `model_unavailable` | That model can't run now | Tell the user |

## When T3 refuses
The user picked an access level when they connected this bot. T3 refuses a change to a thread that runs with more freedom than that level. Don't work around it silently, and don't treat it as an outage.
- Tell the user in one line what was refused and why, and ask: "Should I do it through the local tools?" with **Yes**, **Always** and **No**.
- **Yes**: do it with the local tools, once.
- **Always**: save "refusals on <computer>: use the local tools" in the "T3 routes" note. From then on, for a thread above that connector's level, skip MCP, do it with the local tools, and say in the same message that you did. It holds for that computer until its connector is reconnected.
- **No**: stop. Tell them they can do it in T3 Code, or raise the bot's level by reconnecting.
- With nobody there to ask (a routine run, delegated mode) and no "Always" saved: what delegated mode already lets you do (t3-tots-rules "Decisions": answer routine questions, one nudge per stall, decline an approval) goes through the local tools, and you list each one in your report. Anything else: don't do it; report what was refused.
A refusal from the local tools themselves (`NEEDS_USER_APPROVAL`, `THREAD_RUNNING`, `AMBIGUOUS` and so on) follows t3-tots-rules "Status words". It never moves to another connection.

## Setup ("connect T3 MCP")
Only after the user asks. The local tools stay as they are; nothing is removed.
1. T3 Connect's free plan links 3 computers. If the user wants more than that, say so first: the others keep using the local tools, unless they unlink one or upgrade.
2. Each computer's tools must be v1.5.0 or later: `t3ctl record` must print `USAGE: record --started ...`. Update with t3-install-tools first if not.
3. Give the level one line of advice from their own setup before they choose: `t3ctl threads --main --limit 20` shows how their threads run. If most run in Full access (T3's default for new threads), say: "Your threads run in Full access. Pick Full access for me, or through MCP I can only work with threads at or below the level you pick, and I'll ask before using the local tools for the rest."
4. Tell the user, per computer: in T3 Code press Ctrl/Cmd+K, choose **Use T3 Code in another app (MCP)**, pick **Grok Bot**, and follow it. T3 may ask them to sign in to T3 Connect and turn it on for that computer. On the sign-in page they choose what this bot may do and press Approve. Name the connector "T3 <computer>".
5. Check it: `t3_project_list` through the new connector must list that computer's projects, and `orchestrator_capabilities` shows the level as `runtimeMode`.
6. Save one memory note "T3 routes": per computer the connector name, the level, and the sign-in date. Sign-ins last 30 days; mention the reconnect date. Never save a URL, code or key.
Reconnect after a 401: step 4 for that computer. Remove MCP: remove the connector and the note; the local tools keep working.
