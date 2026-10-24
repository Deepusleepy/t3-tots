---
name: t3-project-tracker
description: >-
  Living tracker for one project or launch (goal, milestones, todo, decisions, next
  steps). Use for "help me launch <project>", "track <project>", "update the
  <project> tracker", "what's next for <project>", "how close is <project> to done".
---
Follow the t3-tots-rules skill (skills/t3-tots-rules/SKILL.md). Write only the tracker file, never project files.

The tracker is `<tools folder>/trackers/<project>.md` on the computer where the project lives. It has these sections: Goal, Milestones (checkbox and target date), Todo (now, next, later), Decisions (dated), Open questions, Risks, Links, and Log (dated one-liners).

## Create
1. Find the project with `t3ctl projects` or `<projects folder>/<name>` from memory. Find related folders with `mdfind` on macOS, `Get-ChildItem` on Windows or `find` on Linux.
2. Read the README, docs, plans and TODOs, `git log --oneline -30`, `git status -s`, tags and releases, and the project's T3 threads (`node export.js --project '<P>' --days 30 --out out/<P>-tracker.json`).
3. If nothing states the goal and the date, ask for them.
4. Show the goal and the top 5 next steps. Write the file after the user confirms.

## Update
Read git and the threads since the last Log entry. Tick milestones, add decisions (including "we decided X" from chat) and open questions, and add a Log line. Tell the user what changed and the next 3 steps.

## Suggest
Suggest next steps from the gap between the goal and the current state. For a release, check signing, notarizing, the installer, a landing page, the README, the changelog and a demo post. Add bugs from threads and open questions. Offer to start one with t3-new-thread, t3-pm-thread or t3-handoff.
