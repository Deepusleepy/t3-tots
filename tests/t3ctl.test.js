// Unit tests for t3ctl's pure helpers. Run: node --test tests/*.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const t = require(path.join(__dirname, "..", "tools", "t3ctl"));

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

test("isMainThread: hides threads agents spawned, keeps the user's", () => {
  assert.equal(t.isMainThread({ creationSource: "web" }), true);
  assert.equal(t.isMainThread({}), true);
  assert.equal(t.isMainThread({ creationSource: "mcp" }), false);
  assert.equal(t.isMainThread({ creationSource: "provider" }), false);
});
test("limitLine: marks a reset time that has already passed", () => {
  const now = Date.parse("2026-01-02T00:00:00Z");
  assert.match(t.limitLine({ id: "a", title: "A", usageLimitResetAt: "2026-01-01T00:00:00Z" }, false, now), /\(passed\)/);
  assert.doesNotMatch(t.limitLine({ id: "b", title: "B", usageLimitResetAt: "2026-01-03T00:00:00Z" }, true, now), /passed|Z\b/);
  assert.match(t.limitLine({ id: "c", title: "C" }, false, now), /resets=\?/);
});
test("limitLine: title first, id last", () => {
  assert.match(t.limitLine({ id: "abc", title: "My thread" }, false), /^My thread  resets=.*  id=abc$/);
});
test("localT: names the zone (IST, not GMT+5:30)", () => {
  const { execFileSync } = require("child_process");
  const out = (tz) => execFileSync(process.execPath, ["-e", `console.log(require(${JSON.stringify(path.join(__dirname, "..", "tools", "t3ctl"))}).localT("2026-01-01T12:00:00Z"))`], { env: { ...process.env, TZ: tz } }).toString().trim();
  assert.match(out("Asia/Kolkata"), /5:30 PM IST$|17:30 IST$/i);
  assert.doesNotMatch(out("America/Los_Angeles"), /GMT/);
  assert.equal(t.localT(null), "-");
});
test("isSettled: settledAt or a settled override, unless overridden back", () => {
  assert.equal(t.isSettled({ settledAt: "2026-01-01T00:00:00Z" }), true);
  assert.equal(t.isSettled({ settledOverride: "settled" }), true);
  assert.equal(t.isSettled({ settledAt: "2026-01-01T00:00:00Z", settledOverride: "unsettled" }), false);
  assert.equal(t.isSettled({}), false);
});
test("threadLine: a held queue shows as queue held, not the last run status", () => {
  const th0 = { id: "x", title: "Snig", status: "cancelled" };
  assert.equal(t.threadLine(th0, { runs: [{ status: "queued", queueHeld: true }] }), "x  queue held  Snig");
  assert.equal(t.threadLine(th0, { runs: [] }), "x  cancelled  Snig");
  assert.equal(t.threadLine({ ...th0, settledAt: "2026-01-01T00:00:00Z" }, null), "x  cancelled (settled)  Snig");
});
test("args: --key=value keeps a value that starts with --", () => {
  assert.deepEqual(t.args(["--text=--force is fine", "--thread", "x", "--json"]), { text: "--force is fine", thread: "x", json: true });
  assert.deepEqual(t.args(["--limit", "0"]), { limit: "0" });
});

test("usage names --timeout for new and send", () => {
  const { execFileSync } = require("child_process");
  const out = execFileSync(process.execPath, [path.join(__dirname, "..", "tools", "t3ctl")], { encoding: "utf8" });
  assert.match(out, /new --project p [^|]*--wait \[--timeout seconds\]/);
  assert.match(out, /send --thread id\|title --prompt t \[--wait \[--timeout seconds\]\]/);
  const src = require("fs").readFileSync(path.join(__dirname, "..", "tools", "t3ctl"), "utf8");
  assert.match(src, /"usage: new [^"]*--timeout seconds/); assert.match(src, /"usage: send [^"]*--timeout seconds/);
});

test("missingValue: a flag that needs a value but gets none is caught (--from --to dir)", () => {
  assert.equal(t.missingValue(t.args(["--from", "--to", "dir"]), "skills"), "from");
  assert.equal(t.missingValue(t.args(["--thread"]), "read"), "thread");
  assert.equal(t.missingValue(t.args(["--cancel"]), "queue"), "cancel");
  assert.equal(t.missingValue(t.args(["--cancel", "--thread", "x"]), "resume-at-reset"), undefined);
  assert.equal(t.missingValue(t.args(["--json", "--force", "--dry-run", "--main", "--wait"]), "threads"), undefined);
  assert.equal(t.missingValue(t.args(["--from=--odd", "--to", "d"]), "skills"), undefined);
});
test("a flag with no value exits 1 with usage before doing anything", () => {
  const { spawnSync } = require("child_process");
  const r = spawnSync(process.execPath, [path.join(__dirname, "..", "tools", "t3ctl"), "skills", "install", "--from", "--to", "/nonexistent-t3tots"], { encoding: "utf8" });
  assert.equal(r.status, 1); assert.match(r.stderr, /^USAGE: --from needs a value/);
});

test("pickThread: exact id, 8+ character prefix, exact title, one title match; several is AMBIGUOUS", () => {
  const ts = [{ id: "aaaa1111-0000", title: "Snig PR review", updatedAt: "2026-01-01" }, { id: "aaaa1112-0000", title: "Snig fixes", updatedAt: "2026-01-03" },
    { id: "cccc3333-0000", title: "Other", updatedAt: "2026-01-02" }, { id: "dddd4444-0000", title: "Other things", updatedAt: "2026-01-04" }];
  assert.equal(t.pickThread(ts, "aaaa1111-0000").id, "aaaa1111-0000");
  assert.equal(t.pickThread(ts, "cccc3333").id, "cccc3333-0000");
  assert.throws(() => t.pickThread(ts, "aaaa111"), /^Error: NOT_FOUND.*8 or more/); // short prefixes never match ids
  assert.throws(() => t.pickThread(ts, "aaaa11"), /NOT_FOUND/);
  assert.throws(() => t.pickThread([...ts, { id: "aaaa1111-9999", title: "x", updatedAt: "" }], "aaaa1111"), /^Error: AMBIGUOUS: 2 threads/);
  assert.equal(t.pickThread(ts, "other").id, "cccc3333-0000"); // exact title beats a longer title containing it
  assert.equal(t.pickThread(ts, "pr review").id, "aaaa1111-0000");
  assert.throws(() => t.pickThread(ts, "snig"), /AMBIGUOUS: 2 threads match "snig"[\s\S]*aaaa1112-0000  Snig fixes/);
});

test("sensitivePath: dotfiles, dot folders and token, auth, secret, credential or .env names are never copied", () => {
  const root = path.join(path.sep, "w", "proj");
  for (const f of [".env", ".env.production", "config/.npmrc", ".ssh/id_rsa", "secrets/db.txt", "api_token.txt", "auth.json", "creds/credentials.json", "my.env", "server.pem", "TOKEN"])
    assert.equal(t.sensitivePath(path.join(root, f), root), true, f);
  for (const f of ["src/app.ts", "README.md", "docs/guide.md"]) assert.equal(t.sensitivePath(path.join(root, f), root), false, f);
  assert.equal(t.sensitivePath(path.join(path.sep, "home", ".hidden", "proj", "a.ts"), path.join(path.sep, "home", ".hidden", "proj")), false); // a dot folder above the root is fine
});
test("pickProject: id, folder, exact title, one title match; several or none is an error, never the first one", () => {
  const P = [{ id: "p1", title: "Web", workspaceRoot: "/r/web" }, { id: "p2", title: "Web admin", workspaceRoot: "/r/admin" }, { id: "p3", title: "Website", workspaceRoot: "/r/site" }, { id: "p4", title: "API", workspaceRoot: "/r/api" }];
  assert.equal(t.pickProject(P, "p3").id, "p3");
  assert.equal(t.pickProject(P, "/r/admin/").id, "p2");
  assert.equal(t.pickProject(P, "web").id, "p1");            // exact title beats the two that contain it
  assert.equal(t.pickProject(P, "ap").id, "p4");             // one title contains it
  assert.throws(() => t.pickProject(P, "eb"), /AMBIGUOUS: 3 projects/);
  assert.throws(() => t.pickProject(P, "zzz"), /NOT_FOUND/);
  for (const q of ["", "   "]) assert.throws(() => t.pickProject(P, q), /--project .* is required/);
  assert.throws(() => t.pickProject([...P, { id: "p5", title: "web", workspaceRoot: "/x" }], "Web"), /AMBIGUOUS: 2/);
});
test("outPath: keeps the project-relative path so same-name files don't overwrite each other", () => {
  const root = path.resolve("/proj"), out = path.resolve("/out");
  const a = t.outPath(out, root, path.join(root, "src", "index.ts")), b = t.outPath(out, root, path.join(root, "test", "index.ts"));
  assert.equal(a, path.join(out, "src", "index.ts")); assert.notEqual(a, b);
  assert.equal(t.outPath(out, root, path.resolve("/elsewhere/x.md")), path.join(out, "x.md"));  // outside the project: never ../ out of out/
  assert.equal(t.outPath(out, null, path.resolve("/a/b.md")), path.join(out, "b.md"));
});

test("sensitivePath: auth is a whole word (author.md is fine); keys, .env, .ssh and .gnupg are caught", () => {
  const root = path.join(path.sep, "proj");
  for (const f of ["auth.json", "Auth.json", "oauth.json", "AuthSessions/x", "googleAuth.json", "auth-store/x", "authorize.ts", ".env", ".env.development", "prod.env", "id_rsa", "id_ed25519.pub", "key.pem", "cert.p12", ".ssh/config", ".gnupg/pubring.kbx", "private_key.txt"])
    assert.equal(t.sensitivePath(path.join(root, f), root), true, f);
  for (const f of ["author.md", "AUTHORS", "authors/list.md", "docs/authority.md", "envoy.yaml", "src/environment.ts"]) assert.equal(t.sensitivePath(path.join(root, f), root), false, f);
});

test("riskOf: git options before push (git -C path, git -c k=v) don't hide a force push or a push to main", () => {
  for (const p of ["git -C /repo push --force", 'git -C "/a b/repo" push origin main', "git -c core.x=y push -f", "git --no-pager -C . push origin HEAD:master", "git -C repo reset --hard"]) {
    const r = t.riskOf({ requestKind: "command", prompt: p }); assert.equal(r.level, "high", p);
  }
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git -C /repo push origin feature" }).level, "high");
});
