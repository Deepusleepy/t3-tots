---
name: t3-status
description: >-
  Short live answer about T3 work or a named job. Use for "status", "what's going on
  in <X>", "anything running?", "is <X> done?", "recap/where is <thread> at". Not for
  "catch me up/brief me" (t3-project-report) or "what needs me" (t3-waiting).
---
Follow the t3-tots-rules skill (skills/t3-tots-rules/SKILL.md). Steps that use the box, ListMachines, routines, cards or SendToUser are Grok Bot only; other agents follow t3-tots-rules "Grok Bot only". Read-only.

## Pick the mode
- No target ("status", "what's up in T3"): run `t3q.py overview` on every computer. `T3_DAYS` defaults to 7.
- A T3 project: `t3ctl threads --project '<P>' --main --limit 8`. Then run `t3ctl status --thread '<id>' --json` for each thread that is running, waiting, asking or in error, plus the newest one. Add `t3ctl limits` for anything stopped on a usage limit.
- A thread: find it as in t3-tots-rules "Finding a thread". For a recap, raise `T3_LAST` to 20 or 30 until the story is clear.
- PRs linked to a T3 thread: `t3ctl pr --thread '<t>'` or `t3ctl prs --project '<P>'`. Use `gh` as the fallback.
- Not T3 (a benchmark, build, other long job, process or PR): use the checks in t3-watch "Pick the check" once. Report progress markers, such as level or percent done, and the last activity time.
- Unclear: ask one short question.

## Reply
- Overview: per computer and project, one line per thread with title, state, last activity, and where it stands in your words. Put "needs you" first. Add one line for the hidden agent-spawned count, and flag threads with the same title on two computers.
- One target: 2 or 3 lines. Say whether it is running, the last thing that happened and when, and anything waiting on the user. A recap may use up to 6 lines: goal, done, state, next or blocked, waiting on the user.
- Offer the full briefing only when a lot is going on.
