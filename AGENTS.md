# AGENTS.md: installing and verifying the T3 Tots tools

This repo is the download source for the T3 Tots bot. Instructions for an agent installing it on a user's computer.

## Rules
- Install only after the user's yes. Never print, copy or overwrite the `token` file or `listen.json` (it holds the user's webhook URL and key), and never open T3 Code's `secrets/` or any auth/token/credential file.
- Answer a thread's question (`t3ctl answer`) only with the user's exact choice, never your own. Approvals (`--decision`) only if the user turned them on.
- Always download from a **tag** (`https://raw.githubusercontent.com/Deepusleepy/t3-tots/<tag>/<path>`), never from `main`.
- Verify every file's SHA-256 against `manifest.json` from the same tag (or a hash list you already trust) **before** moving it into place. On any mismatch install nothing and report `HASH_MISMATCH <path>`.
- Files are stored byte-exact (`.gitattributes`: `* -text`); `t3ctl.cmd` has CRLF line endings on purpose.

## Where things go
Tools folder: `~/t3-tots` (Windows `%USERPROFILE%\t3-tots`) unless the user picked another one. Keep the same relative paths.

| Target | Files |
|---|---|
| macOS | `t3q.py`, `t3ctl`, `t3listen`, `export.js`, `survey.js`, `cleanup/scan.py`, `t3ui`, `ui-dump.applescript`, `ui-menuitem.applescript`, `ui-model.applescript`, `ui-press.applescript`, `ui-type.applescript` |
| Linux | `t3q.py`, `t3ctl`, `t3listen`, `export.js`, `survey.js`, `cleanup/scan.py` |
| Windows | `t3q.py`, `t3ctl`, `t3ctl.cmd`, `t3listen`, `t3listen.cmd`, `export.js`, `survey.js`, `cleanup/scan.py` |
| Bot box (master copy) | every file, plus `manifest.json` |

`manifest.json` → `files[].targets` says the same thing in machine-readable form.

After copying: `chmod +x t3ctl t3listen t3ui` (macOS/Linux) and write the tag into `VERSION` in the tools folder.

## Verify
- macOS: `shasum -a 256 -c manifest.sha256` (from a folder holding all files), or per file `shasum -a 256 <file>`
- Linux: `sha256sum <file>`
- Windows: `(Get-FileHash -Algorithm SHA256 <file>).Hash.ToLower()`

Then smoke-test from the tools folder:
- `python3 t3q.py health` (Windows `py -3 t3q.py health`): prints the T3 server state, or `NO_T3_DATA`.
- `node t3ctl` with no arguments prints usage; `node t3ctl projects` needs the token.
- `node t3listen --dry-run --once --timeout 5` connects and prints any open questions (exit 2 = none). Don't run `t3listen install` unless the user asked for phone answers and `listen.json` exists.

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
| `WEBHOOK_REJECTED` / `WEBHOOK_UNREACHABLE` | The webhook refused the key or can't be reached. |
| `ALREADY_RUNNING` | A listener is already running on this computer. |

## Updating
Check `https://api.github.com/repos/Deepusleepy/t3-tots/releases/latest`. If its `tag_name` is newer than the installed `VERSION`, show the user the release notes and which files changed (compare `manifest.json`), and update only after their yes, verifying against that tag's `manifest.json`.
