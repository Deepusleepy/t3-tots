---
name: t3-sync
description: >-
  Sync global dev setup (configs, skills, MCP, shell, editors) between the user's
  computers. Use for "sync my setup", "sync everything", "sync X only", "change my sync picks", "copy my settings to my
  other computer", "make my computers match".
---
# T3 Sync
Follow the t3-tots-rules skill (skills/t3-tots-rules/SKILL.md). Steps that use the box, ListMachines, routines, cards or SendToUser are Grok Bot only; other agents follow t3-tots-rules "Grok Bot only". Each apply is a write, so it needs the user's yes, and saved picks count only as its "Writes" section allows.

## Scope (global only)
- **Include:** T3 Code settings (keybindings, appearance, providers, model defaults; not threads or DB). Provider CLIs (Claude Code, Codex, Cursor CLI, OpenCode, Gemini and others): version, global config, rules/AGENTS.md/CLAUDE.md, skills, commands, agents, MCP server definitions. Shell profile (aliases, PATH, functions). Global git config (not credentials). Editor settings, keybindings, snippets and extension list (VS Code, Cursor, Zed). Global npm/pnpm/bun/pipx/uv tools. Runtime versions (node, python, bun).
- **Never copy:** secrets, tokens, API keys, `*auth*`/`*token*`/credential files, ssh/gpg keys, keychains, `.env`, git credential helpers' stores, session or history DBs, caches, project repos or project data. If a config file holds an inline secret (an MCP env var, for example), copy it with that value removed and mark it "fill in manually".
- **Logins:** list each one as "sign in manually: <tool> (`<login command>`)".

## First run
1. Run ListMachines. Name each computer with its OS and say which ones are offline. Ask which computer is the main one (the source), and the direction: main to all others, a single pair, or a two-way merge of picked items. You need 2 or more connected computers.
2. Scan both computers **read-only** and in parallel (zsh on macOS, PowerShell on Windows, bash on Linux). Resolve home dirs at runtime. For each candidate, collect its existence, version, a hash, and a short diff. Skip secret files by name without opening them.
3. Show a grouped checklist with the groups T3 Code / Provider CLIs / MCP / Shell / Git / Editors / Global tools / Runtimes / Sign in manually. Mark each item `missing` (on the target), `differs` (one-line summary), `same`, or `not portable` (an OS-only app, for example). Let the user pick by group or by item.
4. Save the result to `<tools folder>/sync-prefs.json` on the main computer, then add a memory note: main computer, direction, path to the prefs file.
   ```json
   {"version":1,"main":"<machine label>","targets":["<label>"],"direction":"main->targets",
    "items":[{"id":"claude.global-rules","group":"Provider CLIs","src":"~/.claude/CLAUDE.md","kind":"file"}],
    "excluded":["..."],"updated":"<ISO time>"}
   ```
   Use these `kind` values: `file`, `dir`, `json-merge` (merge keys and keep keys that exist only on the target), `tool-list` (install whatever is missing), `version` (upgrade to match), `shell-snippet` (translated).
5. Then apply the picks, following the steps under Apply.

## Later runs
- **"sync everything":** read the prefs file, re-scan only the saved items, and show a short diff (what will change on each target). Then apply the saved items as t3-tots-rules "Writes" allows. Report anything new that is not in the picks, but don't apply it.
- **"sync X only":** match X against item ids and groups, then run the same flow for just those items.
- **"change my sync picks":** re-scan everything, show the checklist with the current picks pre-marked, and save the changes. Change the main computer or direction only when the user asks.

## Apply
1. **Back up first:** copy every file you will overwrite on the target to `<tools folder>/sync-backups/<timestamp>/` (same relative path) and record the backup path.
2. **Translate per OS:**
   - Map paths between `~/.config/x` and `%APPDATA%\x` or `%USERPROFILE%\.x`, depending on where the tool reads its config on that OS (check, don't assume). Use `\` vs `/` path separators, and rewrite absolute home paths inside configs.
   - Shell: convert zsh aliases, exports and functions to the PowerShell `$PROFILE` (`Set-Alias`/functions, `$env:`). Skip anything that can't be translated and list it.
   - Editors: Mac `~/Library/Application Support/<Editor>/User`, Windows `%APPDATA%\<Editor>\User`, Linux `~/.config/<Editor>/User`. Convert keybindings between cmd and ctrl.
   - MCP commands: map `npx` to `npx.cmd` where Windows needs it, and fix interpreter paths.
   - Tools and runtime versions: install or upgrade with the commands in t3-update, including its project-safety check.
3. Write with the target's native shell. Transfer files through the box with CopyToBox/CopyFromBox. Never print file contents that may hold secrets.
4. **Verify:** re-hash or diff each item, run `<tool> --version`, check that JSON parses, and load the shell profile in a fresh shell to check for errors.
5. **Report**, per target: what was changed, added, or skipped (and why), the backup path, any manual sign-ins still needed, and anything you couldn't check. If verification fails, offer to restore from the backup.
