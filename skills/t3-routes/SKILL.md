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
| List, read, wait for, search threads | `t3_thread_list` (`allProjects: true` for every project), `t3_thread_read`, `t3_thread_wait`, `t3_thread_search` |
| Projects, models | `t3_project_list`, `orchestrator_capabilities` |
| Start a thread | `t3_thread_launch` with `projectId`, `title`, `message`, and the model and mode the user wants. Then record it (below) |
| Send, steer, queue | `t3_thread_send` (`mode`: `auto`, `queue`, `steer`, `restart`), `t3_queue` (`list`, `read`, `edit`, `cancel`, `reorder`, `promote_to_steer`) |
| Answer a question | Record it first (below), then `t3_pending_request` |
| Stop, interrupt | `t3_thread_interrupt` (`stop: true` stops it like the Stop button) |
| Settle, unsettle, snooze, archive, pin | `t3_thread_organize` |
| Rename; change the model | `t3_thread_update`; `t3_thread_configure` |
| Scheduled tasks | `schedule_task`, `list_scheduled_tasks`, `run_scheduled_task_now`, `delete_scheduled_task` |

**List 2: what MCP can't do. Always the local tools.** Approvals (`t3ctl answer --decision`), phone answers and `t3listen`, every `t3q.py` report (waiting, digest, usage, health), `limits`, `resume-at-reset`, `snooze-until-reset`, `queue --resume`, `diff`, `files`, `prs`, `pr`, `watch`, `export.js`, `survey.js`, archived threads. When the Grok app on that computer is off, these are unavailable: say so in one line; never fake them through MCP.

## Which connection
For a thread on computer X, in this order:
1. X's own T3 connector.
2. Another computer's T3 connector with X's `environmentId`, only when `t3_environment_links` on that connector lists X as reachable (the user turned on Linked environments). Reads are fine. A change that fails this way counts as "maybe sent" (below).
3. The local tools on X.
A computer with no T3 connector (T3 Connect's free plan links 3) uses the local tools for everything. Act only on the computer that owns the thread.

## Calling MCP
- Pass thread and project ids exactly as T3 and `t3ctl` print them. Pass only the arguments a tool declares.
- Reads default to a few short items. Ask for what you need with `limit` and `maxCharsPerItem`, and page with `afterPosition`.
- Give each launch, send and interrupt a new `clientRequestId`. Reuse one only to retry that same action with the same content.
- Archive: read the thread first and don't archive one that is running (MCP would stop it without a word).
- Outside clients can't use the tools that act as a thread (`delegate_task`, `create_threads`, previews, devices, worktree handoff). Start work with `t3_thread_launch` and follow it with `t3_thread_wait`.

## Records
The local reports and the listener live on the thread's computer, so tell them what you did through MCP. Run these there with the local tools when that computer is reachable; if it isn't, do it when it is back:
- After `t3_thread_launch`: `t3ctl record --started <threadId>`. Without it the thread is hidden from "what's waiting" and digests as agent-started, and Resume at reset isn't armed for it.
- Before answering with `t3_pending_request`: `t3ctl record --answered <requestId>`, so the listener's close says it was answered from chat. If the answer failed: `t3ctl record --unanswered <requestId>`.

## When it fails
Decide by what is known about the request, never by guessing from the error text.

| What happened | Meaning | Do |
|---|---|---|
| The connector is missing, can't connect, or says the sign-in expired (HTTP 401) | Nothing was sent | Use the next connection in the order above. After a 401, tell the user that computer needs reconnecting ("Setup" below) |
| A timeout or dropped connection after the call left, or `orchestration_error`; any failed change through a linked computer | Maybe sent | Read the thread first. If it happened, stop. If it clearly didn't, retry the same connection with the same `clientRequestId`. Never repeat it another way while unsure; ask the user |
| `t3ctl` ended with `WRITE_STATE: none` | Nothing was sent | The other connection is fine |
| `t3ctl` ended with `WRITE_STATE: unknown`, or gave no such line (killed, computer dropped) | Maybe sent | Read the thread first, as above |
| MCP refused: `capability_denied`, `runtime_mode_escalation_denied`, `interaction_mode_escalation_denied` | T3 says this connection's access level doesn't allow it. Not an outage | See "When T3 refuses" |
| `thread_not_found`, `invalid_request`, `target_required` | The call was wrong | Fix the call |
| `provider_unavailable`, `model_unavailable` | That model can't run now | Tell the user |

## When T3 refuses
The user picked an access level when they connected this bot. T3 refuses a change to a thread that runs with more freedom than that level. Don't work around it silently, and don't treat it as an outage.
- Tell the user in one line what was refused and why, and ask: "Should I do it through the local tools?" with **Yes**, **Always** and **No**.
- **Yes**: do it with the local tools, once.
- **Always**: save "refusals: use the local tools" in the "T3 routes" note. From then on do it with the local tools and say in the same message that you did.
- **No**: stop. Tell them they can do it in T3 Code, or raise the bot's level by reconnecting.
A refusal from the local tools themselves (`NEEDS_USER_APPROVAL`, `THREAD_RUNNING`, `AMBIGUOUS` and so on) follows t3-tots-rules "Status words". It never moves to another connection.

## Setup ("connect T3 MCP")
Only after the user asks. The local tools stay as they are; nothing is removed.
1. Each computer's tools must be v1.5.0 or later: `t3ctl record` must print `USAGE: record --started ...`. Update with t3-install-tools first if not.
2. Tell the user, per computer: in T3 Code press Ctrl/Cmd+K, choose **Use T3 Code in another app (MCP)**, pick **Grok Bot**, and follow it. T3 may ask them to sign in to T3 Connect and turn it on for that computer. On the sign-in page they choose what this bot may do and press Approve. Name the connector "T3 <computer>".
3. Before they choose, give the level one line of advice from their own setup: `t3ctl threads --main --limit 20` shows how their threads run. If most run in Full access (T3's default for new threads), say: "Your threads run in Full access. Pick Full access for me, or through MCP I can only work with threads at or below the level you pick, and I'll ask before using the local tools for the rest."
4. Check it: `t3_project_list` through the new connector must list that computer's projects, and `orchestrator_capabilities` shows the level as `runtimeMode`.
5. Save one memory note "T3 routes": per computer the connector name, the level, and the sign-in date. Sign-ins last 30 days; mention the reconnect date. Never save a URL, code or key.
6. T3 Connect's free plan links 3 computers. Others keep using the local tools; say which.
Reconnect after a 401: step 2 for that computer. Remove MCP: remove the connector and the note; the local tools keep working.
