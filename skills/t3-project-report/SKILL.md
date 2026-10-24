---
name: t3-project-report
description: >-
  Full HTML briefing of one T3 project. Use only for "catch me up on <project>",
  "what all happened in <project>", "brief me on <project>", "project report".
---
Follow the t3-tots-rules skill (skills/t3-tots-rules/SKILL.md). Read-only. The report is built on the box.

1. Computer: the one the user names, else the one the message came from. "Everywhere" means each connected computer.
2. Export from the tools folder: `node export.js --project '<name|path|all>' --days 14 --out out/<Project>-export.json`. Use `--days 7` for "this week" and `--days 30` for "this month". If the project isn't found, run `t3ctl projects` and ask. The export redacts keys and home paths.
3. CopyToBox the export to `/workspace/t3-out/<Project>-export.json`. If `/workspace/t3-tots-tools/report/report.py` is missing, run t3-install-tools "Box copy" first. Then, on the box:
   ```
   python3 /workspace/t3-tots-tools/report/report.py /workspace/t3-out/<Project>-export.json /workspace/t3-out/<Project>-report.html --tz <user IANA tz>
   google-chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars --window-size=1100,2400 --screenshot=/workspace/t3-out/<Project>-report.png file:///workspace/t3-out/<Project>-report.html
   ```
4. SendToUser the HTML and the PNG, then 3 to 5 lines: what moved, what's waiting on the user, and what's running or failing.
