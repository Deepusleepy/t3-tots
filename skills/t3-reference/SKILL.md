---
name: t3-reference
description: >-
  Lookup tables for T3 Tots: every t3ctl command, Windows shell translations, token
  issue commands, the master copy, and listener, install and repo status words. Use
  only when another t3-* skill points here or a tool printed a word you don't know.
---
Reference only. It changes nothing by itself: the rules for acting are in t3-tots-rules.

## Host table
The host app decides how a step reaches the user. It is a saved fact, never a guess: setup saves the note "T3 Tots host" with the app name (t3-tots-rules "Grok Bot only" says how). Use only your app's column. With no note, use the Other agents column.

| Step | Grok Bot | OpenBot | Other agents |
|---|---|---|---|
| Computers | ListMachines every run; every connected computer, in parallel, labelled by name | Only the computer the agent runs on. A second computer is a second OpenBot host with its own agent. Label results with that computer | Only the computer you run on |
| The box (`/workspace`, CopyToBox, CopyFromBox) | Build on the box, helpers at `/workspace/t3-tots-tools/` | Run the script from the tools folder and write to `<tools folder>/out/`. `cleanup/scan.py` is installed there; the HTML report helpers stay on the box | Run the same script from the tools folder and write to `<tools folder>/out/` (report helpers need local Python 3.9+; skip screenshots) |
| Sending a file or report | SendToUser | `attach_files_to_response` for files in the chat, `html_render` for a page in the chat. `messaging_post` to a Slack, Discord, Telegram or WhatsApp chat, with place ids from `messaging_list_places`. Always give the path on their computer too | Give the file path |
| Tap-to-answer cards | Cards | `ask_user` for up to 3 questions with options, `ask_ui` for a confirm card with up to 4 buttons. A T3 approval still follows "Decisions" | Ask in plain text with numbered options; answers still follow "Decisions" |
| Memory | Always-visible profile memory | `remember` with `inclusion: "essential"` for facts needed in every prompt (the whole budget is 8 KiB), `search_memories` for the rest. Never save the token, a key, or a path to one | Ask, or use the notes file the user names |
| Scheduled routines | A routine from the routine panel | `create_routine`. Each run starts a new session that sees only the newest chat messages, so the instruction must stand alone. `routine_no_update` when a run has nothing to report, `test_routine` to try one | Run the check once when asked; schedule it only with the user's own tools if they ask |
| Webhook routines | A routine with a webhook trigger | `create_webhook_routine`. The body needs a `type` field and the signed `x-openbot-timestamp`, `x-openbot-delivery-id` and `x-openbot-signature` headers. The delivery id is the dedupe key | Skip unless the user gives their own webhook |
| Watches | A watch routine you create | A scheduled routine that runs the `t3ctl watch` check. It is one run per routine run, not a live watcher | Same as routines |
| Phone answers (`t3listen` to a chat webhook) | The "T3 questions to chat" webhook routine | None that `t3listen` can feed. `t3listen` sends no `type` field and cannot sign the headers above, so every POST is refused. Use the poll routine in t3-phone-answers "OpenBot phone routine" | Skip unless the user gives their own webhook |
| Skill updates | A synced skill updates live, with no restart | `node t3ctl skills install --from <release folder> --to <workspace>/.agents/skills` again. OpenBot lists that folder with no restart | Follow AGENTS.md "Updating" |
| T3's own MCP | The connector (t3-routes) | `save_mcp_server` with `transport: "http"` and the URL from T3 Code's "Copy MCP URL". OpenBot signs in over OAuth and the user approves the sign-in card. `list_mcp_servers` confirms | The connector, if the user set one up |
| Cloud agent (t3-handoff) | CloudAgent; leave fast mode off | None. `start_task` for long work in a side thread of the same agent, `create_agent` for a teammate | None of Grok Bot's kind, so t3-handoff's launch step does not apply |

## t3ctl commands
`node t3ctl` with no arguments prints the same list and needs no token.

| Area | Commands |
|---|---|
| Find | `projects`, `models`, `threads [--project p] [--main] [--limit n]`, `search --query q [--limit n]` |
| Read | `read --thread t [--last n]`, `status --thread t [--json]`, `pending --thread t [--json]`, `diff`, `files [--last-turn] [--copy no] [--include path,path]`, `raw`, `limits [--json]`, `subtasks --thread t [--all]`, `prs --project p` (required) `[--state open\|closed\|merged\|all]`, `pr --thread t [--number n] [--all]`, `pr --project p --repo owner/name --number n` |
| Watch | `watch --thread a[,b] [--state file] [--stall-min 20] [--json]` |
| Send | `new --project p (--prompt t \| --prompt-file f) [--model m --effort e --title x --mode plan --worktree base-branch --attach a.png] [--wait [--timeout seconds]]`, `send --thread t (--prompt t \| --prompt-file f) [--queue] [--no-verify] [--wait [--timeout seconds]]` (`--wait` gives up after 300 seconds unless `--timeout` says otherwise). `--worktree <base-branch>` starts the thread in its own new worktree instead of the project folder; use it for threads that work in parallel. `--effort` without `--model` changes the effort of the model the project would use |
| Answer | `answer --thread t [--request id] (--pick label \| --text words \| --answers json \| --decision d [--user-approved \| --redirect])` |
| Queue | `queue --thread t [--steer id\|all \| --cancel id\|all \| --resume \| --edit id --text x \| --move id (--before id\|end \| --first)]` |
| Thread actions | `settle`, `unsettle`, `archive`, `unarchive`, `rename --title x`, `interrupt [--hold]`, `stop`, `subagent-stop --subagent id`, `fork [--run id --title x]`, `model [--model m --effort e --provider p]`, `snooze --until +2h\|HH:MM\|ISO`, `unsnooze`, `resume-at-reset [--cancel]`, `snooze-until-reset [--cancel]` |
| Records | `record --started <threadId>` (after starting a thread through T3's MCP; needs no token) |
| Scheduled tasks | `tasks [--upsert ... \| --enable id \| --disable id \| --run id \| --delete id --yes]` |
| Skills | `skills [list] [--from dir] [--to dir]`, `skills install --to dir [--from dir] [--only a,b] [--dry-run] [--force]` (copies these skills into another agent's skills folder; see the repo README) |

## Windows shell translations

| POSIX | Windows |
|---|---|
| `python3` | the saved Python command (`py -3`) |
| `VAR='x' cmd` | `$env:VAR='x'; cmd` |
| `tail -n N`, `head -N` | `Get-Content -Tail N`, `Select-Object -First N` |
| `wc -l` | `Measure-Object -Line` |
| `pgrep -fl X` | `Get-CimInstance Win32_Process \| ? CommandLine -like '*X*'` |
| `"$(cat f)"` | `(Get-Content f -Raw)` |

## Token commands
Only after the user's yes (t3-tots-rules "Token"). Never print or copy the token.

- macOS and Linux: `(umask 077; ~/.t3/bin/t3 auth session issue --scope orchestration:read --scope orchestration:operate --ttl 90d --label t3-tots --subject t3-tots --token-only > token)`
- Windows PowerShell: `& "$env:USERPROFILE\.t3\bin\t3.cmd" auth session issue --scope orchestration:read --scope orchestration:operate --ttl 90d --label t3-tots --subject t3-tots --token-only | Out-File -Encoding ascii token; icacls token /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null`. Plain `>` in Windows PowerShell writes UTF-16 and breaks the token.

## Master copy
The reference copy lives on the box at `/workspace/t3-tots-tools/`, installed and sha256-verified by t3-install-tools. Its `manifest.json` is the reference for every computer. Skill folders don't carry their own copies of the scripts. If the master copy is missing, run t3-install-tools "Box copy". If a computer lacks a script or a hash differs from `manifest.json`, say so and offer to reinstall.

## t3listen
Optional. It needs the token and `listen.json`. It follows T3's live events and POSTs question and finish events to the user's webhook routine (t3-phone-answers). Commands: `setup`, `test [--bot name]`, `bots`, `bot add <name> [--project p]... [--events a,b]`, `bot remove <name>`, `subscribe|unsubscribe <bot|main> [--project p]... [--events a,b]` (t3-phone-answers "More bots"), `install [--approvals]`, `uninstall`, `status`, `preview-finish --thread id|title` (same thread rules as `t3ctl`: full id, an 8+ character prefix, an exact title or one title match, else `AMBIGUOUS`); `--dry-run` prints instead of sending. It sends approvals too when `listen.json` has `"approvals": true` or the service was installed with `--approvals`; `status` prints which. Running `install` again keeps the `listen.json` setting and drops the flag unless you pass it again. When a main thread stops on a usage limit, t3listen arms T3's Resume at reset if the project is listed in `autoresume.json` (`{"enabled":true,"projects":[...]}`) or `t3ctl new` started the thread (recorded in `started-here.json` for 60 days).

## Other scripts and data files
- `export.js` writes a redacted JSON export for reports. Options work like t3ctl (`--project Foo` or `--project=Foo`; an unknown option is `USAGE`). `--project` is a filter: an exact id, else a folder, else an exact title (case ignored) picks that project, and two exact matches stop with `AMBIGUOUS` listing them; otherwise every project whose title contains the words is exported, and it prints a note naming them. No `--project` means all. `survey.js` lists activity and stale threads.
- `t3ui` and `ui-*.applescript` are a macOS-only UI fallback. They use the running T3 Code app, or `T3_APP`.
- Data files the skills create in the tools folder: `templates.md`, `trackers/`, `update-prefs.json`, `sync-prefs.json`, `sync-backups/`, `out/`, `README.md`, `watch-state.json`, `watch-<name>.json`, `autoresume.json`. `t3ctl new` writes `started-here.json`. t3listen writes `listen.json` (private), `listen-state.json`, `answered-here.json` and `listen.log`.

## More status words

| Word | Meaning and next step |
|---|---|
| `NO_LISTEN_CONFIG`, `BAD_LISTEN_CONFIG`, `BAD_URL`, `BAD_HEADER` | `listen.json` is missing or wrong. Run `t3listen setup` again |
| `LAST_SUBSCRIPTION`, `ALREADY_SUBSCRIBED` | `t3listen unsubscribe` would leave a bot with no subscription, which means everything, so remove the bot instead; or the bot already gets that. Nothing was changed |
| `WEBHOOK_REJECTED` | The webhook refused the event. HTTP 401 or 403 means a wrong key, so redo setup. A rate-limit reply clears on its own; the listener keeps retrying |
| `WEBHOOK_UNREACHABLE` | The webhook can't be reached. The listener keeps retrying |
| `ALREADY_RUNNING` | A listener already runs there |
| `INSTALL_FAILED` | `t3listen install` couldn't register the autostart. Relay the message |
| `HASH_MISMATCH`, `MANIFEST_MISMATCH`, `BAD_MANIFEST` | A file or manifest didn't match the pinned release, or `t3ctl skills install` found no `manifest.json` to check. Install nothing and tell the user |
| `REPO_PRIVATE_OR_MISSING` | The box can't download the release. Use t3-install-tools "Private repo" |
| `DOWNLOAD_FAILED`, `MISSING_IN_FROM`, `NO_BOX_COPY` | The download failed, the `--from` folder lacks a file, or the box copy is missing. Nothing was installed |
| `NO_SKILLS_SOURCE` | `t3ctl skills` found no skills. Pass `--from <repo checkout or unpacked release>` |
| `NO_SKILLS`, `SYNC_BLOCKED` | Repo checks: `scripts/sync-skills` needs a source folder (`--from` or `T3TOTS_SKILLS_SRC`), or it found a private detail or bad frontmatter and copied nothing |
| `NO_PRIVATE_WORDS` | Repo checks: no private-word list, so `scripts/check.sh` fails. Add one (see `scripts/scan-private.py`) or set `T3TOTS_NO_PRIVATE_WORDS=1` to skip it on purpose |
| `MANIFEST_STALE`, `UNLISTED_TOOL` | Repo checks: a file changed without `scripts/make-manifest.py`, or a new tool isn't listed in it |
