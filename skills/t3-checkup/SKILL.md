---
name: t3-checkup
description: >-
  Health check of T3 Code and the computer it runs on. Use for "health", "checkup",
  "is T3 ok", "is my computer ok", "why is T3 slow", or the Weekly health check routine.
---
Follow @t3-tots-rules. Read-only.

1. Run `t3q.py health` on every computer.
2. Per computer, give one line with these parts:
   - T3 running (pid), port and bind address
   - stuck runs (live over 1 hour with no activity for 30 minutes), held queues, and stale pending requests (over 24 hours)
   - T3 data folder size, disk free, memory available, and CPU load against the core count
3. Warn when one of these is true:
   - T3 listens on `0.0.0.0` or `::`, which makes it reachable from the network. Suggest `127.0.0.1`. If the user says network access is fine, save that and don't warn again.
   - Disk free is under 10%, memory available is under 10%, load is above the core count, or the data folder is over 20 GB.
4. On macOS, quote free space only. For true used space, offer @t3-cleanup.
5. Suggest fixes. Apply none. A held queue isn't stuck: someone held it on purpose, so offer to resume or cancel it. Stale requests on agent-spawned threads usually belong to finished work; suggest dismissing them in T3.
