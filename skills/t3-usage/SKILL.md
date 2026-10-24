---
name: t3-usage
description: >-
  Estimated T3 token usage and cost by provider, model and day. Only when the user
  asks: "usage", "costs", "what did I spend", "how many tokens", or the Weekly usage
  estimate routine. Never include it in digests or unprompted reports.
---
Follow @t3-tots-rules. Read-only.

1. Run `t3q.py usage` on every computer. `T3_DAYS` defaults to 7. `T3_WEEK=1` gives the calendar week from Monday. The script reads the newest `usage-scan-cache*.json` and `usage-model-rates.json`, counts each request once, and prices it at API list rates.
2. If the cache is over 12 hours old, say so first and suggest opening T3's Usage view to refresh it.
3. Per computer and combined, give total tokens and the estimated cost, then by provider, the top 10 models and by day. Mark every figure as an estimate, because subscriptions aren't billed per token. List the models that have no price.
