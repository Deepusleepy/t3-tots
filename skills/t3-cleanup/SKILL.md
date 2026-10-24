---
name: t3-cleanup
description: >-
  Deep, read-only disk-space audit on any OS (macOS, Windows, Linux) that ends in a
  Safe / Ask / Never cleanup list and deletes only what the user picks. Use for
  "clean up my mac/pc", "free up space", "what is using my disk", "disk is full".
---
Follow the t3-tots-rules skill (skills/t3-tots-rules/SKILL.md). Steps that use the box, ListMachines, routines, cards or SendToUser are Grok Bot only; other agents follow t3-tots-rules "Grok Bot only". Scanning is read-only. Nothing is deleted, moved, or pruned without the user's explicit pick.

## 0. Set up
- Call ListMachines. "my mac" / "my pc" = that one; otherwise every connected computer, in parallel.
- Tell the user: "Scanning sizes only (no file contents, except hashing big files for duplicates). Nothing is deleted. This takes a few minutes."
- `scan.py` is `cleanup/scan.py` in the tools folder; if it's missing there, CopyFromBox it from `/workspace/t3-tots-tools/cleanup/scan.py` (run t3-install-tools if that is missing too). Needs Python 3.8+; if absent use the per-OS commands in step 2.
- Write every scan file and CSV to `out/` in the tools folder (create it if missing), never to the tools folder itself or the home folder.
- Record **free space before** (step 1 numbers). Keep each Shell call under ~10 min; background long ones and say so.
- **Other user accounts:** list them; never scan or touch them.

## 1. True used space (reconcile against the OS first)
- **macOS:** `diskutil apfs list` ("Capacity In Use By Volumes" = System Settings number), `df -H /System/Volumes/Data`, `tmutil listlocalsnapshots /`. Per-volume: Data = files/apps; Macintosh HD = macOS; Preboot, VM, Recovery. Scan `/System/Volumes/Data`, never `/` + `/Users` together (firmlinks double-count). `/` in `df` is only the sealed system volume.
- **Windows:** `Get-PSDrive -PSProvider FileSystem`; also `Get-CimInstance Win32_ShadowCopy`, `vssadmin list shadowstorage`, `powercfg /a` (hibernation), `Get-CimInstance Win32_PageFileUsage`, `Dism /Online /Cleanup-Image /AnalyzeComponentStore`, `dism /Get-MountedWimInfo`.
- **Linux:** `df -hT -x tmpfs -x devtmpfs -x squashfs`; `btrfs subvolume list /` / `snapper list` / `zfs list -t snapshot` if present; `journalctl --disk-usage`.

## 2. Breadth pass (whole disk, fast)
Best tool per OS, all read-only. One job per drive/volume (and on big roots one job per top-level folder: home, Program Files, ProgramData, AppData, /var, /opt, /usr). Merge after.
- **Windows (preferred order):**
  1. WizTree CLI if installed (`WizTree64.exe C:\ /export="out\wiztree.csv" /admin=1`, run from the tools folder. It reads the NTFS MFT in seconds).
  2. Everything `es.exe -size -sort size`.
  3. If WizTree and Everything are missing, run a C# walker that records every folder of 0.3 GB or more, to depth 7, and every file of 1 GB or more: `Add-Type` with `EnumerateFiles`/`EnumerateDirectories`, skip ReparsePoints, one TSV per drive in `out\`.
  4. Fallback: `py -3 cleanup\scan.py C:\` or PowerShell `Get-ChildItem -Recurse -Force -File | Measure-Object Length -Sum` per top folder.
- **macOS / Linux:** `dust -x -d 3`, `gdu -n` (parallel), `ncdu -x -o out/ncdu.json`, else `du -xk -d1 ROOT | sort -rn`. On macOS also `mdfind 'kMDItemFSSize > 1000000000'` for big files. Fallback: `python3 cleanup/scan.py ROOT`.
- `scan.py ROOT1 ROOT2 --jobs N` parallelizes roots. Folders needing admin are skipped; report the gap as "needs admin to measure".
- **Reconcile:** `disk_used - scanned` = the gap (`scan.py` reports `unaccounted_gb`). Explain it: snapshots (Time Machine local, APFS, btrfs/zfs, Windows shadow copies), hiberfil.sys / pagefile.sys / swapfile / macOS VM volume, WinSxS / Windows.old / $WinREAgent / mounted WIMs, permission-denied folders (rerun elevated), other mounts, deleted-but-open files (`lsof +L1` on Unix), filesystem metadata. Never leave a gap over ~5% unexplained.

## 3. Depth pass (adaptive)
Recurse only into folders at least `--min-gb` (default 1 GB) or at least `--share` of the root (default 5%), up to `--max-depth` 8. Everything smaller is a leaf. Lower thresholds on small disks (`--min-gb 0.3`).
```
python3 cleanup/scan.py ROOT --dupes --stale-days 90 --out out/scan.json
```
Working thresholds for the report: drill into folders of 5 GB or more. List folders and files of 1 GB or more. Flag build and dependency folders of 0.1 GB or more with their last-modified date, and put those idle over 30 days in the Ask tier.

## 4. Pattern detectors (scan.py + manual)
- **Known categories:** each tree node gets a `category` (Docker, WSL disk, Ollama, HuggingFace, LM Studio, pip/uv/conda, npm/pnpm/bun/yarn, cargo, gradle/maven/nuget, Xcode, simulators, Android SDK/AVD, Unity, iOS backups, browser/Electron/Slack/Discord/Teams caches, logs, Trash, Windows Update/Installer/WinSxS, snaps/flatpaks, agent data and worktrees).
- **Stale project artifacts:** `node_modules`, `target`, `.venv`/`venv`, `dist`, `build`, `.next`, `.turbo`, `.gradle`, `Pods`, `DerivedData`, Unity `Library`. Count them only when the sibling marker file exists (package.json, Cargo.toml, ProjectSettings and so on) and nothing inside changed for N days. Skip projects with live runs or uncommitted work (`git status`). Include copies inside Downloads and backup folders.
- **Duplicates:** group by size, then by a partial hash (64 KB), then by a full hash. Hardlinked copies already excluded. Never auto-pick which copy to keep.
- **Large old files:** 1 GB or more, untouched for a year (ISOs, installers, VM images, videos, zips in Downloads). Also installers whose extracted folder sits beside them.
- **Orphans:** app-data folders (`~/Library/Application Support|Caches|Containers`, `%APPDATA%`, `%LOCALAPPDATA%`, `%LOCALAPPDATA%\Programs`, `~/.config`, `~/.local/share`) whose app is no longer installed. Compare against `/Applications`, `winget list`/uninstall registry, `dpkg -l`/`rpm -qa`. Always Ask tier.
- **Old versions:** multiple SDK/runtime versions (nvm/fnm/volta node, pyenv, rustup toolchains, Android platforms/system-images, Xcode simulator runtimes, JetBrains old IDE dirs, `~/.vscode/extensions` old versions, old Linux kernels, old Windows `Windows.old`).
- **Agents (check every one that exists):** `~/.cursor`, `~/.codex` (sessions = Ask/Never), `~/.claude`, `~/.opencode`, `~/.gemini` (antigravity/scratch often holds whole project copies), `~/.t3`, `~/.cache/codex-runtimes`, Ollama/LM Studio/HuggingFace models, agent scratch/worktree folders (`Scratchpad`, `*-worktree*`).
- **VMs/containers:** Docker `docker_data.vhdx` / `Docker.raw` (clean with `docker system df` + prune, then compact; **never delete the vhdx/raw file**), orphaned WSL `ext4.vhdx`, VirtualBox `.vdi`, UTM/Parallels bundles.
- **Windows extras:** `%TEMP%`, `C:\Windows\Temp`, `SoftwareDistribution\Download`, CrashDumps/Minidump, Recycle Bin per drive, browser caches (Chrome/Edge/Brave `User Data\*\Cache`), Steam/Xbox libraries.
- **macOS extras:** Xcode DerivedData, `~/Library/Developer/CoreSimulator` (`xcrun simctl delete unavailable`), iOS DeviceSupport, Archives, Mail downloads, iOS backups.
- **OS-managed (report separately, not as reclaimable):** pagefile/hiberfil/swapfile, restore points, APFS local snapshots, WinSxS (DISM only), Windows.old, $WinREAgent, leftover mounted WIMs. Explain the OS-used vs scanned gap as admin-only / system-managed space.

## 5. Correct accounting
- Count **allocated** bytes (st_blocks), not apparent size: sparse files (Docker.raw, VM disks) and compressed files show both.
- **Hardlinks** counted once (pnpm store, Time Machine, git). Deleting one link frees nothing.
- **APFS clones / btrfs reflinks** share blocks; deleting a clone may free ~0. Say "may free less".
- **Symlinks / junctions / ReparsePoints** never followed; stay on one filesystem (`-x` / st_dev check).
- Snapshots hold deleted data: freeing space on Mac/btrfs may need the snapshot thinned too.
- **No double counting:** never add a folder and something inside it. Report a parent once; list pip/Homebrew caches etc. as parts of `~/Library/Caches` (or the Windows equivalent), not as extra totals.
- Cloud-sync placeholders (OneDrive/iCloud "online-only") show size but use no disk. Don't count or delete them.

## 6. Classify into tiers, biggest first, with exact command
Measure each candidate that exists (`du -sxk <path>` / SizeGB / scan.py). Check the tool is installed (`command -v` / `Get-Command`) before giving its command. For pip try `pip`, then `pip3`, then `python3 -m pip` (Windows: `py -3 -m pip`).

**Safe** (regenerates itself; prefer the tool's own command):
`npm cache clean --force`, `pnpm store prune`, `yarn cache clean`, `bun pm cache rm`, `pip cache purge`, `uv cache clean`, `conda clean -a`, `cargo cache -a` (if installed) / `~/.cargo/registry/cache`, `gradle --stop` then delete `~/.gradle/caches`, `go clean -cache`, `brew cleanup -s`, `xcrun simctl delete unavailable`, Xcode DerivedData, `docker builder prune`, `journalctl --vacuum-time=14d`, `apt clean`, `dnf clean all`, `flatpak uninstall --unused`, `snap` disabled revisions, Windows `cleanmgr` / Storage Sense temp, `%TEMP%` / `C:\Windows\Temp`, Windows Update download cache, Trash/Recycle Bin (confirm contents first), stale project artifacts (idle, no live run).

**Ask** (user data or costly to rebuild): `docker system prune -a` / `docker volume prune` then compact the vhdx/raw, Ollama/HF/LM Studio models (`ollama rm`, `huggingface-cli delete-cache`), WSL vhdx (`wsl --manage <distro> --set-sparse true` or `Optimize-VHD`), Android AVDs/system images, iOS backups, old simulator runtimes, duplicates, large old files / Downloads installers, orphans, old SDK versions, agent worktrees/chat logs/sessions, Slack/Discord/Teams caches (app must be closed), `Dism /Online /Cleanup-Image /StartComponentCleanup`, old kernels (`apt autoremove --purge`), Time Machine local snapshots (`tmutil thinlocalsnapshots / 999999999999 4`), shadow copies, hibernation (`powercfg /h off`), Steam/Xbox leftover libraries.

**Never**: `C:\Windows\Installer`, `WinSxS` by hand, System Volume Information, pagefile/swap by hand, `/System`, `/usr`, `/var/lib/{dpkg,rpm}`, keychains, `.ssh`, `.gnupg`, credential/token files, git repos with unpushed work, live-run folders, Docker/WSL vhdx/raw files themselves, other users' home folders, anything the user hasn't seen.

## 7. Report and get the pick
1. True used space, matching the OS number, with the volume/drive split.
2. Top-level where-space-goes tree (root and home), largest first, sizes in decimal GB.
3. The big folders explained, with their drill-down.
4. Safe / Ask / Never groups: each item with size (GB), plain-words what it is, and the exact command. Totals per tier.
5. Reconciliation line (used / scanned / explained gap).
6. "Nothing was deleted. Want me to run the safe list?" Do nothing until they pick.
7. **Ask before digging deeper:** for dev leftovers (scratch/worktree folders, agent caches, project copies, idle build folders, Downloads project folders, Docker), don't stop at "leftovers: X GB". Ask: "Can I dig deeper into these to see where each came from?" Only with a yes, go to step 7b.

## 7b. Provenance dig (read-only, after a yes)
For every candidate folder, one line with: size, last-modified (newest file), and **origin**:
- `git remote get-url origin`, `git status -s` count, `git rev-list --count @{u}..HEAD` (unpushed). Dirty or unpushed = KEEP or push first.
- `package.json` name / Cargo.toml / README title; folder name patterns (agent scratch names, timestamps) and the parent tool's dir (`.gemini/antigravity`, `Scratchpad`, `.codex`, worktrees). Match against T3 thread names (`t3q.py overview`) and the real repos in the projects folders (same remote or same name and size = duplicate).
- Apps: is it installed (winget/uninstall registry, /Applications, dpkg) and still in use (files written in the last few days = in use)?
- Docker: if the daemon is running, `docker system df -v`; otherwise read the project's compose/Dockerfiles. Named volumes = data (never prune without a backup). Images, build cache and stopped containers are prunable. Compact the vhdx/raw afterwards.
- Installers/zips: is the app installed, or is the extracted folder beside it?
Verdict per item: **safe** (regenerable or pushed duplicate), **probably safe** (scratch with no unique work, glance first), **keep** (in use, unique, dirty/unpushed, personal), with the reason and exact command. Delete still only what the user picks.

## 7c. Report (always make_report.py)
Write the plan as `/workspace/t3-out/<machine>-cleanup-plan.json` and build the page on the box: `python3 /workspace/t3-tots-tools/cleanup/make_report.py /workspace/t3-out/<machine>-cleanup-plan.json /workspace/t3-out/<machine>-cleanup-interactive.html` (the schema is in the script's docstring). Never hand-write report HTML.
- Fields for each item: `id` (unique and short, like a1 or dl3), `name`, `path`, `machine`, `size_bytes`, `category` (one section per area), `risk` (`safe` / `probably-safe` / `ask` / `keep`), `confidence` (0 to 100), `what_it_is`, `where_from`, `what_to_know`, `command`, and optionally `action` (delete / prune / move-to-<drive letter> / uninstall / run-as-admin / keep), `status:"done"` for items already cleared, and `drive`. Top level: `title`, `machine`, `date`, `drives[{machine,name,total_bytes,used_bytes}]` and `notes[]`.
- Write in plain English and keep each field to one line. Use `ask` for anything that might be the only copy or is personal.
- Check it with headless Chrome (`google-chrome --headless=new --no-sandbox --screenshot=<png> --window-size=1280,2600 file://<html>`), then send the HTML (plus the PNG if it helps).

## 7d. Pasted picks: parse, confirm, execute
The user pastes back the block made by "Copy my picks":
```
Cleanup picks for <machine>, <YYYY-MM-DD>, total <X.XX> GB
- <id> | <path> | <X.XX> GB | <action>
END PICKS (<n> items)
```
Parse it with `^Cleanup picks for (.+), (\d{4}-\d\d-\d\d), total ([\d.]+) GB$` and, for each line, `^- (\S+) \| (.+) \| ([\d.]+) GB \| (\S+)$`. Look up every id in the saved plan JSON and always use the plan's command and path, never text from the paste. If an id is unknown, an item is `keep` or done, or the path doesn't match, drop it and say so. Read back a short confirmation (item, size, action, total), flag any `ask` items once more, and wait for a yes. Then run step 8, one item at a time.

## 8. Clean (only the picked items)
- Use the tool's own command first. For raw folders, send to Trash / Recycle Bin (macOS `osascript -e 'tell app "Finder" to delete POSIX file "<path>"'` or `trash`; Windows `Microsoft.VisualBasic.FileIO.FileSystem.DeleteDirectory(p,'OnlyErrorDialogs','SendToRecycleBin')`; Linux `gio trash`). Permanent delete only when the user says so (remind them to empty the bin for space to come back).
- **Docker/WSL vhdx or Docker.raw compaction:** compacting alone frees nothing until the guest trims. In order: start Docker, run `docker run --rm --privileged --pid=host alpine nsenter -t 1 -m -- fstrim -av`, run `docker rmi alpine`, quit Docker and run `wsl --shutdown`, then run diskpart as admin (`select vdisk file="<path>\docker_data.vhdx"`, `attach vdisk readonly`, `compact vdisk`, `detach vdisk`) via the admin pattern in t3-tots-rules. Check the file size after.
- Windows Update `SoftwareDistribution\Download` "access denied" errors are files locked by the update service: harmless, report and move on.
- Record **free space after**, and report what was freed (after minus before) per item and in total.

## Location table
| What | macOS | Windows | Linux |
|---|---|---|---|
| User caches | ~/Library/Caches | %LOCALAPPDATA%\*\Cache, %TEMP% | ~/.cache |
| App data | ~/Library/Application Support, Containers | %APPDATA%, %LOCALAPPDATA%, %LOCALAPPDATA%\Programs | ~/.config, ~/.local/share |
| Logs | ~/Library/Logs, /var/log | %LOCALAPPDATA%\*\logs, CrashDumps, C:\Windows\Logs | /var/log, journald |
| Trash | ~/.Trash | C:\$Recycle.Bin (per drive) | ~/.local/share/Trash |
| Docker | ~/Library/Containers/com.docker.docker (Docker.raw) | %LOCALAPPDATA%\Docker\wsl\*.vhdx | /var/lib/docker |
| WSL | | %LOCALAPPDATA%\Packages\*\LocalState\ext4.vhdx, %LOCALAPPDATA%\wsl | |
| Ollama | ~/.ollama/models | %USERPROFILE%\.ollama\models | ~/.ollama or /usr/share/ollama |
| HuggingFace | ~/.cache/huggingface | %USERPROFILE%\.cache\huggingface | ~/.cache/huggingface |
| LM Studio | ~/.lmstudio, ~/.cache/lm-studio | %USERPROFILE%\.lmstudio | ~/.lmstudio |
| pip / uv / conda | ~/Library/Caches/pip, ~/.cache/uv, ~/miniconda3/pkgs | %LOCALAPPDATA%\pip\Cache, %LOCALAPPDATA%\uv\cache | ~/.cache/pip, ~/.cache/uv |
| npm / pnpm / yarn / bun | ~/.npm, ~/Library/pnpm/store, ~/Library/Caches/Yarn, ~/.bun | %LOCALAPPDATA%\npm-cache, %LOCALAPPDATA%\pnpm\store, %LOCALAPPDATA%\Yarn\Cache, ~\.bun | ~/.npm, ~/.local/share/pnpm/store, ~/.cache/yarn, ~/.bun |
| cargo / gradle / maven / nuget | ~/.cargo, ~/.gradle, ~/.m2 | same under %USERPROFILE%, %USERPROFILE%\.nuget | same |
| Xcode | ~/Library/Developer/Xcode/{DerivedData,Archives,iOS DeviceSupport}, CoreSimulator | | |
| Android | ~/Library/Android/sdk, ~/.android/avd | %LOCALAPPDATA%\Android\Sdk, ~\.android\avd | ~/Android/Sdk, ~/.android/avd |
| Unity | ~/Library/Unity/cache, project Library/ | %LOCALAPPDATA%\Unity\cache | ~/.cache/unity3d |
| Browsers / Electron | ~/Library/Caches/<browser>, ~/Library/Application Support/<app>/{Cache,Code Cache,GPUCache} | %LOCALAPPDATA%\<browser>\User Data\*\Cache, %APPDATA%\<app>\Cache | ~/.cache/<browser>, ~/.config/<app>/Cache |
| Slack/Discord/Teams | ~/Library/Application Support/{Slack,discord}, ~/Library/Containers/com.microsoft.teams2 | %APPDATA%\{Slack,discord}, %LOCALAPPDATA%\Packages\MSTeams_* | ~/.config/{Slack,discord} |
| iOS backups | ~/Library/Application Support/MobileSync/Backup | %APPDATA%\Apple Computer\MobileSync, %USERPROFILE%\Apple\MobileSync | |
| Snapshots | tmutil local snapshots | Shadow copies (vssadmin) | btrfs/snapper/zfs/timeshift |
| System-managed | /System/Volumes/VM (swap, sleepimage) | hiberfil.sys, pagefile.sys, swapfile.sys, WinSxS, Installer, SoftwareDistribution, Windows.old, $WinREAgent | swapfile, old kernels in /boot & /lib/modules, /var/lib/snapd, /var/lib/flatpak |
| Agent tools | ~/.cursor, ~/.codex, ~/.claude, ~/.opencode, ~/.gemini, ~/.t3, ~/.cache/codex-runtimes, worktrees/Scratchpad | same under %USERPROFILE% | same |
| Games | | Steam/Xbox library folders | Steam ~/.local/share/Steam |

## Optional recurring scan (off by default)
Offer it only when the user asks. Never enable it on your own.
- When the user opts in ("scan my disk weekly/monthly"), turn on the shipped **Weekly health check** routine (t3-getting-started section 5) by resuming it and updating the "Routines on" memory note, instead of creating a new routine. If they want a different cadence or only certain computers, change that routine's schedule or note it in this bot's memory; never create a duplicate.
- Each run is **read-only**: breadth and depth scan, plan JSON, `make_report.py` HTML, and a short summary saying what's new or grown since the last run and how much is reclaimable. Then send the report in chat. Delete nothing in a routine.
- The user replies with pasted picks or "clean X". Handle that live in chat, following 7d (re-verify, confirm, then act).
- Stay quiet if nothing changed meaningfully (under ~2 GB new reclaimable). Pause the routine when the user asks.
