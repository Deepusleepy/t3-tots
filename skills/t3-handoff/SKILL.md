---
name: t3-handoff
description: >-
  Hand a T3 thread's work to a Cursor cloud agent that returns a branch and a PR. Use
  for "send to cursor", "hand off <thread> to cursor", "let a cloud agent finish
  <thread>", "run this in the cloud", "make a PR from <thread>".
---
Follow the t3-tots-rules skill (skills/t3-tots-rules/SKILL.md). Steps that use the box, ListMachines, routines, cards or SendToUser are Grok Bot only; other agents follow t3-tots-rules "Grok Bot only". Read-only on the user's computers. Launch only after the user confirms the brief.

## 1. Gather
1. Find the thread as in t3-tots-rules "Finding a thread", with `T3_LAST=20`. An empty `T3_Q` picks the most recent user thread.
2. In the working folder, run `git -C <dir> status --porcelain`, `git -C <dir> remote get-url origin` and `git -C <dir> log -1 --oneline`. On a detached HEAD, ask for the base branch.
3. Stop and tell the user when there's no GitHub remote, or when the task needs uncommitted changes. The cloud agent can't see them, so ask the user to commit and push first.

## 2. Brief
```
Repo: <owner/name>   Base branch: <branch>
Goal: <1 or 2 sentences from the whole thread>
Context: <decisions, constraints, files and areas, conventions from AGENTS.md or CLAUDE.md>
Current state: <what's done, the head commit>
Task: <the next concrete steps>
Done when: <checks that must pass>
Deliver: a new branch and a PR against <base>. Do not merge.
```
Strip secrets, tokens, personal paths and personal data from the brief.

## 3. Launch
1. Show the brief and ask "Send this to Cursor?".
2. On yes, start a CloudAgent on the full GitHub URL and the base branch. Set `project: true` only if the user asks for a project. If source control isn't connected, ask the user to connect GitHub.
3. Report the agent link. When it's done, report the branch, the PR and a 3-line summary. Never merge.
