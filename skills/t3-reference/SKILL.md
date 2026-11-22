---
name: t3-reference
description: >-
  Lookup tables for T3 Tots: every t3ctl command, Windows shell translations, token
  issue commands, the master copy, and listener, install and repo status words. Use
  only when another t3-* skill points here or a tool printed a word you don't know.
---
Reference only. It changes nothing by itself: the rules for acting are in t3-tots-rules.

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
| `T3_SILENT` | In `listen.log`: T3 stopped answering on an open connection, so the listener exited for its service to start a fresh one, which catches up. Nothing to do unless it repeats; `t3listen status` shows last alive and the starts in the last hour |
| `INSTALL_FAILED` | `t3listen install` couldn't register the autostart. Relay the message |
| `HASH_MISMATCH`, `MANIFEST_MISMATCH`, `BAD_MANIFEST` | A file or manifest didn't match the pinned release, or `t3ctl skills install` found no `manifest.json` to check. Install nothing and tell the user |
| `REPO_PRIVATE_OR_MISSING` | The box can't download the release. Use t3-install-tools "Private repo" |
| `DOWNLOAD_FAILED`, `MISSING_IN_FROM`, `NO_BOX_COPY` | The download failed, the `--from` folder lacks a file, or the box copy is missing. Nothing was installed |
| `NO_SKILLS_SOURCE` | `t3ctl skills` found no skills. Pass `--from <repo checkout or unpacked release>` |
| `NO_SKILLS`, `SYNC_BLOCKED` | Repo checks: `scripts/sync-skills` needs a source folder (`--from` or `T3TOTS_SKILLS_SRC`), or it found a private detail or bad frontmatter and copied nothing |
| `NO_PRIVATE_WORDS` | Repo checks: no private-word list, so `scripts/check.sh` fails. Add one (see `scripts/scan-private.py`) or set `T3TOTS_NO_PRIVATE_WORDS=1` to skip it on purpose |
| `MANIFEST_STALE`, `UNLISTED_TOOL` | Repo checks: a file changed without `scripts/make-manifest.py`, or a new tool isn't listed in it |
