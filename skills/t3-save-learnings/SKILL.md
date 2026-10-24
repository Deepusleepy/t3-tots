---
name: t3-save-learnings
description: >-
  Save durable lessons from a T3 thread into the project's AGENTS.md or CLAUDE.md.
  Only when the user explicitly says "save learnings", "save what we learned" or
  "add this to AGENTS.md", optionally "from <thread>".
---
Follow the t3-tots-rules skill (skills/t3-tots-rules/SKILL.md). Write one file, and only after a yes to the exact diff.

1. Find the thread as in t3-tots-rules "Finding a thread", with `T3_LAST=40`. An empty `T3_Q` picks the most recent user thread.
2. Pull only durable lessons: working commands, gotchas, conventions, user decisions and repeated agent mistakes. Skip one-off details, secrets and anything already in the file.
3. Target `AGENTS.md` if it exists, else `CLAUDE.md`, else propose creating `AGENTS.md`. Read the target, then show a unified diff of 5 to 12 bullets under `## Learnings` or the closest section. Ask "Write this to <file>?".
4. On yes, apply exactly that diff with the smallest edit. Append or insert, and never rewrite the file. On Windows use `Add-Content -Encoding utf8`. Read the file again to confirm. Don't commit or push unless the user asks.
