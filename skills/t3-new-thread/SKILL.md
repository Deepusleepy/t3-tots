---
name: t3-new-thread
description: >-
  Start a new T3 thread or send a follow-up into one. Use for "new thread", "/new",
  "start a thread in <project>", "follow up in <thread>", "send this to T3".
---
Follow @t3-tots-rules, including "Sending into threads". Send only the prompt the user asked for.

## 1. Resolve (read-only)
- Computer: the one the user names, else the one their message came from.
- Project: `t3ctl projects`. `--project` takes an id, title or path and ignores case. If the folder isn't a project yet, ask before `~/.t3/bin/t3 project add <path>` (Windows: `t3.cmd project add <path>`).
- Thread, for follow-ups: `t3ctl threads [--project P] --main --limit 15`. Confirm if several match. Then read its recent history with `t3ctl read --thread '<t>' --last 6`.
- Model: `t3ctl models` lists the models already used. Aliases are `haiku`, `sonnet` and `opus`, and pick the newest of that family; other ids look like `claude-sonnet-5-5`, `gpt-6.1-sol` or `grok-4.7`. Effort is low, medium, high, xhigh or max. With none given, the project default applies.

## 2. Write the prompt
- Pass on the user's words and context. Leave the design decisions to the thread.
- If the prompt is longer than a few lines, write it to a file and pass `--prompt-file <file>`.

## 3. Send
- New thread: `t3ctl new --project <P> --model <m> --effort <e> --prompt-file <file> [--title '<t>'] [--mode plan] [--attach a.png,b.jpg] [--wait --timeout 300]`
- Follow-up: `t3ctl send --thread '<id|title>' --prompt-file <file> [--attach ...] [--queue] [--wait]`
- A follow-up steers into a running run by default. Add `--queue` only when the user wants it to wait for the run to end. t3ctl then checks delivery; relay its notes.
- Leave out `--wait` for long coding tasks, say it's running, and offer @t3-watch.
- `t3ctl new` records the thread in `started-here.json`, so t3listen arms Resume at reset if the thread later stops on a usage limit.

## Fallback on macOS
Use the UI only if `t3ctl` fails and the user is OK with T3 taking focus: `t3ui new '<project search>' '<model search>' '<Low|Medium|High|Extra High|Max>' '<prompt>'` or `t3ui send '<exact sidebar title>' '<prompt>'`. Then check the result with `t3ctl read`. If macOS says the app isn't allowed assistive access, tell the user which app to allow in System Settings > Privacy & Security > Accessibility.

## Reply
In 1 or 2 lines: the thread title and id, project, model and effort, and the reply or "running". Say whether the message was steered into a running run, queued, or not delivered.
