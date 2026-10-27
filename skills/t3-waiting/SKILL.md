---
name: t3-waiting
description: >-
  T3 threads blocked on the user, each with a copy-ready reply, and showing or
  answering what one thread is asking. Use for "what's waiting", "inbox", "what
  needs me", "anything waiting on me", "what is <thread> asking".
---
Follow the t3-tots-rules skill (skills/t3-tots-rules/SKILL.md). Steps that use the box, ListMachines, routines, cards or SendToUser are Grok Bot only; other agents follow t3-tots-rules "Grok Bot only". This skill is read-only, except for answering under t3-tots-rules "Decisions".

## All threads
1. Run `t3q.py waiting` on every computer. `T3_DAYS` defaults to 14; `T3_ALL=1` adds agent-spawned threads. A thread is waiting when it has a pending request or approval, a run in `waiting`, a held queue (a message waits for someone to resume or cancel it), or a last reply that ends in a question or hands a decision back. Running and settled threads are left out, and `T3_DAYS` counts from the last activity in the thread.
2. Run `t3ctl limits` on each computer and add threads stopped on a usage limit, with the reset time and whether auto-resume is set. A reset marked `(passed)` no longer blocks anything: list it once at the end as "can resume now" and offer to send a short continue, or to settle it if the work is done.
3. For each thread, give: computer, project, title, why it waits and since when (requests over 24 hours are stale), the question in one line, and a copy-ready reply in the user's voice in a code block. If only the user can decide, give 2 short options instead.
4. If all of an agent-spawned thread's requests are stale, label it "likely abandoned" and suggest dismissing it in T3. Group threads whose last reply is only a greeting or a "what can I help with" under one line, "idle chats", and offer to settle them.
5. End with the count, or one line if nothing waits.

## One thread
1. Run `t3ctl pending --thread '<t>' --json`.
2. For a question with `answerable: true`, show it as a question card with the options exactly as listed. Answer with the user's pick as in t3-phone-answers "Answering", and confirm that it closed.
3. For an approval, show the prompt, the options and any `warnings`. Accept it only after the user's yes for that request (`--user-approved`), or when `standing` is true, as t3-tots-rules "Decisions" says.
4. If it isn't answerable, tell the user to answer it in T3.
