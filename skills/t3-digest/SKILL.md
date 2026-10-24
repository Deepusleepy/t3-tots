---
name: t3-digest
description: >-
  Daily or weekly digest across all the user's projects (T3 threads, git, TODOs,
  trackers) with suggestions. Use for "daily digest", "weekly digest", "what did I do
  this week", "where do my projects stand", "what happened today", or the Daily digest
  and Weekly wrap-up routines.
---
Follow the t3-tots-rules skill (skills/t3-tots-rules/SKILL.md). Read-only. Leave out usage and cost figures; those belong to t3-usage, on request only.

## 1. Collect from every connected computer
- T3: `node survey.js` for activity and stale threads, and `node export.js --project all --days <1|7> --out out/digest.json`, then CopyToBox the export. `t3q.py waiting` lists what needs the user.
- Active project folders are the T3 projects active in the window, plus folders under the user's projects folder that changed in it. The projects folder comes from memory; ask once if it's unknown. For each one, collect:
  - `git -C <root> log --since=<window> --oneline | head -20`
  - `git -C <root> status -s | wc -l` and the current branch
  - the first 40 lines of `TODO*`, `ROADMAP*`, `plans/` and `state.md`
- Goals: `<tools folder>/trackers/*.md` (t3-project-tracker).

## 2. Write
For each project, cover what happened, where it stands, what's next (from trackers, TODOs and the last agent messages), and 1 or 2 concrete suggestions, such as "1 uncommitted file" or "idle 5 days: settle or continue?". Then list what's waiting on the user and what's running now. Add stale threads only in the weekly digest, and only if the user turned on the stale-thread list.

- Daily: 15 lines or fewer in chat.
- Weekly: the same, plus an HTML page at `/workspace/t3-out/digest-<date>.html` in the t3-project-report style, sent with SendToUser.

## 3. Routines
The Daily digest and Weekly wrap-up routines run this skill (t3-getting-started section 5). In a routine run, skip quiet projects, and send nothing if nothing happened and nothing is waiting.
