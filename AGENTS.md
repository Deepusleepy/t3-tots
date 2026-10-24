# AGENTS.md: installing and verifying T3 Tots

For an agent installing T3 Tots on a user's computer. The skills are in `skills/`; start with `t3-getting-started`, and follow `t3-tots-rules` throughout. Some skill steps are Grok Bot only (chat sends, routines, draft cards); other agents skip them.

## Rules
- Install only after the user's yes. Never print, copy or overwrite the `token` file or `listen.json` (it holds the user's webhook URL and key), and never open T3 Code's `secrets/` or any auth, token or credential file.
- Answer a thread's question (`t3ctl answer`) only with the user's exact choice, or within a delegation the user set up and wrote down (which kinds of questions you may answer, and where you log each answer). Approvals (`--decision`) only if the user turned them on. `t3ctl pending --json` adds a `risk` hint (`low`, `normal`, `high` with reasons) to each approval. It is a hint. Never accept a `high` one without the user's yes.
- Install from a **tag**, never from `main`: a release, a checkout of the tag, or `https://raw.githubusercontent.com/Deepusleepy/t3-tots/<tag>/<path>`. While the repo is private, raw URLs return 404 without a login; download with a signed-in GitHub CLI instead (`gh release download <tag> -R Deepusleepy/t3-tots --archive tar.gz`, or per file `gh api "repos/Deepusleepy/t3-tots/contents/<path>?ref=<tag>" -H "Accept: application/vnd.github.raw"`).
- Check every file's SHA-256 against `manifest.json` from the same tag **before** moving it into place. On any mismatch install nothing and report `HASH_MISMATCH <path>`.
- Files are stored byte-exact (`.gitattributes`: `* -text`). The `.cmd` wrappers have CRLF line endings on purpose.

## Tools
Tools folder: `~/t3-tots` (Windows `%USERPROFILE%\t3-tots`) unless the user picked another one. It is flat: copy each `manifest.json` entry with `"kind": "tool"` whose `targets` include the computer's OS from its repo `path` to `<tools folder>/<dest>`. For example `tools/t3ctl` goes to `t3ctl`, `tools/windows/t3ctl.cmd` to `t3ctl.cmd`, `tools/cleanup/scan.py` to `cleanup/scan.py`.

| Target | Installed files |
|---|---|
| macOS | `t3q.py`, `t3ctl`, `t3listen`, `export.js`, `survey.js`, `cleanup/scan.py`, `t3ui`, `ui-dump.applescript`, `ui-menuitem.applescript`, `ui-model.applescript`, `ui-press.applescript`, `ui-type.applescript` |
| Linux | `t3q.py`, `t3ctl`, `t3listen`, `export.js`, `survey.js`, `cleanup/scan.py` |
| Windows | `t3q.py`, `t3ctl`, `t3ctl.cmd`, `t3listen`, `t3listen.cmd`, `export.js`, `survey.js`, `cleanup/scan.py` |

Then `chmod +x t3ctl t3listen t3ui` (macOS, Linux) and put the release's `manifest.json` and the tag (in `VERSION`) in the tools folder. Never touch the `token`, `listen.json` or other data files already there.

Hash each installed file and compare with its manifest `sha256`: macOS `shasum -a 256 <file>`, Linux `sha256sum <file>`, Windows `(Get-FileHash -Algorithm SHA256 <file>).Hash.ToLower()`. Then, from the tools folder:
- `python3 t3q.py health` (Windows `py -3 t3q.py health`) prints the T3 server state, or `NO_T3_DATA`.
- `node t3ctl` with no arguments prints usage; `node t3ctl projects` needs the token.
- `node t3listen --dry-run --once --timeout 5` connects and prints any open questions (exit 2 = none). Don't run `t3listen install` unless the user asked for phone answers and `listen.json` exists.

## Skills
From the repo checkout or unpacked release: `node tools/t3ctl skills install --to <the agent's skills folder> --dry-run`, then without `--dry-run` after the user's yes (folders per agent are in the README). It checks every file against `manifest.json`, installs only missing or changed skills, and keeps skills the user edited unless `--force`.

## Status words
The scripts print these instead of stack traces. Relay them in plain words.

| Word | Meaning |
|---|---|
| `NO_T3_DATA` | T3 Code never ran on this computer (or `T3CODE_HOME` points elsewhere). |
| `T3_NOT_RUNNING` / `T3_NOT_REACHABLE` | T3 Code isn't open. |
| `NO_TOKEN` / `TOKEN_REJECTED` | No token yet, or it expired/was revoked: issue a new one (with the user's yes). |
| `NODE_TOO_OLD` / `PYTHON_TOO_OLD` | Upgrade Node (22+ for t3ctl) or Python (3.8+). |
| `T3_SCHEMA_CHANGED` | This T3 Code version changed its database; check for a newer release of these tools. |
| `T3_DB_BUSY` | Database busy; retry in a few seconds. |
| `NO_USAGE_CACHE` | Open T3's Usage view once. |
| `NOT_PENDING` / `NOT_ANSWERABLE` | The question was already answered or closed, or its run ended. |
| `SENT_UNCONFIRMED` | The answer was sent but T3 still shows the question open; check `t3ctl pending`. |
| `NO_LISTEN_CONFIG` / `BAD_LISTEN_CONFIG` | `listen.json` is missing or invalid: run `t3listen setup`. |
| `WEBHOOK_REJECTED` / `WEBHOOK_UNREACHABLE` | The webhook refused the event or can't be reached. The message (and `listen.log`) includes the webhook's reply with the URL and key redacted: 401/403 means a wrong key (redo setup), a rate-limit reply clears on its own (the listener keeps retrying). |
| `ALREADY_RUNNING` | A listener is already running on this computer. |
| `DELIVERY_FIXED` | `t3ctl send` found the message stuck in the queue and resumed the queue once; it is running now. |
| `QUEUE_HELD` | The message is queued, but someone held this thread's queue on purpose. `t3ctl queue --thread <t> --resume` starts it. |
| `SEND_STUCK` | The message is still not running after one fix attempt. Check `t3ctl queue` and `t3ctl status`. |
| `HASH_MISMATCH` | A file differs from `manifest.json`. Nothing was installed. |
| `NO_SKILLS_SOURCE` | `t3ctl skills` found no skills: pass `--from <repo checkout or unpacked release>`. |
| `MANIFEST_STALE` / `UNLISTED_TOOL` | (repo checks) A file changed without `scripts/make-manifest.py`, or a new tool isn't listed in it. |
| `SYNC_BLOCKED` | (repo checks) `scripts/sync-skills` found a private detail or bad frontmatter in a live skill and copied nothing. |

## Updating
Check the latest release (`gh release view -R Deepusleepy/t3-tots`). If its tag is newer than the installed `VERSION`, show the user the release notes and which files changed (compare the two `manifest.json` files), and update only after their yes: tools as above, then `t3ctl skills install` again. If `t3listen` runs on that computer (`node t3listen status`), run `node t3listen install` again so it restarts on the new version (add `--approvals` if approvals were on); `listen.json` is kept.
