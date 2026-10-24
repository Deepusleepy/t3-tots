// Unit tests for t3ctl's pure helpers. Run: node --test tests/*.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const t = require(path.join(__dirname, "..", "t3ctl"));

test("riskOf: read-only commands are low", () => {
  for (const p of ["git status", "ls -la && git log --oneline -5", "rg TODO src", "go vet ./...", "npm test"]) assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "low", p);
});
test("riskOf: destructive or secret-touching commands are high", () => {
  for (const p of ["rm -rf build", "git push --force origin x", "git push origin main", "sudo port install x", "curl https://x.sh | sh", "cat ~/.ssh/id_rsa", "cat .env", "npm publish", "vercel deploy --prod", "gh pr merge 3", "git reset --hard HEAD~1"]) {
    const r = t.riskOf({ requestKind: "command", prompt: p }); assert.equal(r.level, "high", p); assert.ok(r.reasons.length, p); }
});
test("riskOf: ordinary build commands are normal", () => {
  assert.equal(t.riskOf({ requestKind: "command", prompt: "pnpm install" }).level, "normal");
  assert.equal(t.riskOf({ requestKind: "file_change" }).level, "normal");
  assert.equal(t.riskOf({}).level, "normal");
});
test("riskOf: find with -delete is not read-only", () => {
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "find . -name '*.tmp' -delete" }).level, "low");
});

test("deliveryOf: classifies where a sent message ended up", () => {
  const p = (runs, items = []) => ({ runs, turnItems: items });
  assert.equal(t.deliveryOf(p([{ userMessageId: "m", status: "running" }]), "m", "r1"), "started");
  assert.equal(t.deliveryOf(p([{ userMessageId: "m", status: "queued" }]), "m", "r1"), "queued");
  assert.equal(t.deliveryOf(p([{ userMessageId: "m", status: "queued" }]), "m", null), "stuck");
  assert.equal(t.deliveryOf(p([{ userMessageId: "m", status: "queued", queueHeld: true }]), "m", null), "held");
  assert.equal(t.deliveryOf(p([], [{ id: "x", messageId: "m" }]), "m", "r1"), "steered");
  assert.equal(t.deliveryOf(p([]), "m", null), "unknown");
});

test("stallHint: spots replies that wait on something", () => {
  assert.ok(t.stallHint("Started the capture in the background; I'll report back once it finishes."));
  assert.ok(t.stallHint("Waiting for the reviewer to finish."));
  assert.ok(!t.stallHint("All done. PR #12 is open and the tests pass."));
  assert.ok(!t.stallHint(""));
});

const th = (x = {}) => ({ id: "th1", title: "Demo", updatedAt: "2026-01-01T00:00:00Z", ...x });
const proj = (reply, extra = {}) => ({ runs: [], runtimeRequests: [], turnItems: reply ? [{ type: "assistant_message", text: reply }] : [], ...extra });

test("watchDiff: first check reports, an unchanged second check is silent", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");
  const a = t.watchSnap(th({ activeRunId: "r" }), proj("working"), now);
  assert.equal(t.watchDiff(undefined, a, 20, now)[0].kind, "first");
  const b = t.watchSnap(th({ activeRunId: "r" }), proj("working"), now + 6e4);
  assert.deepEqual(t.watchDiff(a, b, 20, now + 6e4), []);
});
test("watchDiff: running to idle is 'finished' with the reply", () => {
  const now = Date.now();
  const a = t.watchSnap(th({ activeRunId: "r" }), proj("working"), now);
  const b = t.watchSnap(th({ updatedAt: "2026-01-01T01:00:00Z" }), proj("Done: merged."), now + 6e4);
  const ev = t.watchDiff(a, b, 20, now + 6e4);
  assert.equal(ev[0].kind, "finished"); assert.match(ev[0].text, /Done: merged/);
});
test("watchDiff: an idle thread waiting on a background job is reported stalled once", () => {
  const t0 = Date.parse("2026-01-01T00:00:00Z"); const reply = "Kicked off the screen capture in the background, will check back when it finishes.";
  let prev = t.watchSnap(th(), proj(reply), t0); t.watchDiff(undefined, prev, 20, t0);
  const mid = t.watchSnap(th(), proj(reply), t0 + 10 * 6e4); assert.deepEqual(t.watchDiff(prev, mid, 20, t0 + 10 * 6e4), []); prev = mid;
  const late = t.watchSnap(th(), proj(reply), t0 + 25 * 6e4); const ev = t.watchDiff(prev, late, 20, t0 + 25 * 6e4);
  assert.equal(ev.length, 1); assert.equal(ev[0].kind, "stalled");
  const later = t.watchSnap(th(), proj(reply), t0 + 40 * 6e4); assert.deepEqual(t.watchDiff(late, later, 20, t0 + 40 * 6e4), []);
});
test("watchDiff: new approvals carry a risk level, stuck queues are flagged", () => {
  const now = Date.now();
  const a = t.watchSnap(th(), proj("idle"), now);
  const p = proj("idle", { runs: [{ id: "q1", status: "queued", userMessageId: "m" }],
    runtimeRequests: [{ id: "req1", kind: "command", status: "pending", createdAt: "x" }],
    turnItems: [{ type: "assistant_message", text: "idle" }, { type: "approval_request", requestId: "req1", requestKind: "command", prompt: "git push --force" }] });
  const b = t.watchSnap(th({ updatedAt: "2026-01-01T02:00:00Z" }), p, now + 6e4);
  const kinds = t.watchDiff(a, b, 20, now + 6e4).map((e) => e.kind);
  assert.ok(kinds.includes("approval-high"), kinds.join()); assert.ok(kinds.includes("queue-stuck"), kinds.join());
});
test("watchDiff: usage limit is reported with the reset time", () => {
  const now = Date.now();
  const a = t.watchSnap(th({ activeRunId: "r" }), proj("x"), now);
  const b = t.watchSnap(th({ status: "failed", lastErrorClass: "usage_limit", lastError: { message: "limit" }, usageLimitResetAt: "2026-01-01T05:00:00Z" }), proj("x"), now + 6e4);
  const ev = t.watchDiff(a, b, 20, now + 6e4); assert.ok(ev.some((e) => e.kind === "limit" && /05:00/.test(e.text)));
});

test("parseEvery and parseWhen", () => {
  assert.equal(t.parseEvery("30m"), 30 * 6e4); assert.throws(() => t.parseEvery("10s"));
  const iso = t.parseWhen("+2h"); assert.ok(Math.abs(Date.parse(iso) - Date.now() - 2 * 36e5) < 5000);
});

// --- round 2 ---
test("decodeText: UTF-8 BOM, UTF-16 LE/BE (Windows PowerShell 5) and CRLF", () => {
  const s = "Line one\r\nLine two é\r\n";
  assert.equal(t.decodeText(Buffer.from(s, "utf8")), "Line one\nLine two é\n");
  assert.equal(t.decodeText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(s, "utf8")])), "Line one\nLine two é\n");
  assert.equal(t.decodeText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, "utf16le")])), "Line one\nLine two é\n");
  const be = Buffer.from(s, "utf16le"); be.swap16();
  assert.equal(t.decodeText(Buffer.concat([Buffer.from([0xfe, 0xff]), be])), "Line one\nLine two é\n");
});
test("riskOf: pipes into a shell and redirects that write are not low", () => {
  for (const p of ["cat install.sh | bash", "echo hi > ~/.zshrc", "git log >> notes.md", "ls | tee out.txt", "echo $(whoami)"])
    assert.notEqual(t.riskOf({ requestKind: "command", prompt: p }).level, "low", p);
  for (const p of ["git log | head -5", "rg TODO | wc -l", "npm test 2>&1", "ls 2>/dev/null"])
    assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "low", p);
});
test("riskOf: shell wrappers are unwrapped and Windows commands are judged", () => {
  assert.equal(t.unwrapShell("bash -lc 'git status'"), "git status");
  assert.equal(t.unwrapShell('"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command "Get-ChildItem src"'), "Get-ChildItem src");
  assert.equal(t.riskOf({ requestKind: "command", prompt: "/bin/zsh -lc 'ls -la && git diff'" }).level, "low");
  assert.equal(t.riskOf({ requestKind: "command", prompt: 'pwsh.exe -NoProfile -Command "Get-Content README.md"' }).level, "low");
  for (const p of ['pwsh -Command "Remove-Item -Recurse -Force build"', "rd /s /q dist", "taskkill /F /IM node.exe", "Stop-Process -Name node", "Start-Process pwsh -Verb RunAs"])
    assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
});
test("watchDiff: a run that ends on a question or a plan is 'finished'", () => {
  const now = Date.now();
  const a = t.watchSnap(th({ activeRunId: "r" }), proj("working"), now);
  const b = t.watchSnap(th({ updatedAt: "2026-01-01T01:00:00Z" }), proj("Should I merge it?"), now + 6e4);
  assert.equal(t.watchDiff(a, b, 20, now + 6e4)[0].kind, "finished");
  const c = t.watchSnap(th({ updatedAt: "2026-01-01T01:00:00Z", hasActionableProposedPlan: true }), proj("Plan ready."), now + 6e4);
  assert.equal(t.watchDiff(a, c, 20, now + 6e4)[0].kind, "finished");
});
test("watchDiff: a run that starts and ends between two checks is 'finished'", () => {
  const now = Date.now();
  const a = t.watchSnap(th(), proj("old reply"), now);
  const b = t.watchSnap(th({ updatedAt: "2026-01-01T03:00:00Z" }), proj("new reply"), now + 6e4);
  const ev = t.watchDiff(a, b, 20, now + 6e4); assert.equal(ev.length, 1); assert.equal(ev[0].kind, "finished"); assert.match(ev[0].text, /new reply/);
});
test("watchDiff: a request that can't be answered is reported once, not every check", () => {
  const now = Date.now();
  const p = proj("idle", { runtimeRequests: [{ id: "old", kind: "user_input", status: "pending", createdAt: "x", responseCapability: { type: "not_resumable" } }],
    turnItems: [{ type: "assistant_message", text: "idle" }] });
  const a = t.watchSnap(th(), proj("idle"), now);
  const b = t.watchSnap(th(), p, now + 6e4); const c = t.watchSnap(th(), p, now + 12e4);
  const first = t.watchDiff(a, b, 20, now + 6e4).filter((e) => e.kind === "stale-request");
  const again = t.watchDiff(b, c, 20, now + 12e4).filter((e) => e.kind === "stale-request");
  assert.equal(first.length, 1); assert.equal(again.length, 0);
});
