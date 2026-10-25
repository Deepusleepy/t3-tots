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
test("riskOf: find with -delete is high", () => {
  assert.equal(t.riskOf({ requestKind: "command", prompt: "find . -name '*.tmp' -delete" }).level, "high");
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
test("riskOf: --git-dir/--work-tree/--namespace take the next token; git.exe, clustered -f, reset options, clean --force, push --delete", () => {
  const high = [
    "git --git-dir /repo push --force", "git --work-tree /repo push --force", "git -C /repo --work-tree /wt push --force",
    "git --git-dir /repo reset --hard", "git --work-tree /repo reset --hard", "git -C /repo --work-tree /wt reset --hard",
    "git --git-dir /repo branch -D", "git --work-tree /repo branch -D", "git -C /repo --work-tree /wt branch -D",
    "git --namespace foo push --force", "git --git-dir=/repo push --force",
    "git -C /repo push -uf origin feature", "git -C /repo push -fu origin feature",
    "git -C /repo reset --quiet --hard", "git -C /repo reset -q --hard",
    "git -C /repo clean --force", "git -C /repo push --delete origin foo",
    "git.exe -C /repo push --force",
  ];
  for (const p of high) {
    const r = t.riskOf({ requestKind: "command", prompt: p }); assert.equal(r.level, "high", p);
  }
});
test("sensitivePath: acronyms before a sensitive word (HTTPAuth, getHTTPAuth, XMLAuth) are caught", () => {
  const root = path.join(path.sep, "proj");
  for (const f of ["HTTPAuth.json", "getHTTPAuth.ts", "XMLAuth.json"])
    assert.equal(t.sensitivePath(path.join(root, f), root), true, f);
  for (const f of ["author.md", "AUTHORS", "docs/authority.md"]) assert.equal(t.sensitivePath(path.join(root, f), root), false, f);
});

test("riskOf: git branch --delete/-m and fetch refspecs are not read-only; listing and bare fetch stay low", () => {
  for (const p of ["git branch --delete feature", "git branch -D feature", "git branch -m old new", "git branch -M old new"])
    assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  for (const p of ["git fetch origin main:main", "git fetch . +refs/heads/experiment:refs/heads/main", "git fetch origin +main"])
    assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch origin feature:feature" }).level, "low");
  for (const p of ["git branch", "git branch --list", "git branch --show-current", "git branch -v", "git fetch", "git fetch origin", "git fetch origin feature", "git fetch https://example.com/repo.git", "git fetch git@github.com:foo/bar.git"])
    assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "low", p);
});
test("riskOf: sibling git forms (clustered -f, tokens before --hard, clean -f anywhere, push :, git.exe quotes, attached -C, git.cmd) are high", () => {
  const high = [
    "git push -fv", "git push -fqu", "git push -vfu",
    "git reset HEAD --hard", "git reset -q HEAD --hard",
    "git clean -x -f", "git clean -d --force",
    "git push :foo",
    '"C:\\Program Files\\Git\\cmd\\git.exe" push --force',
    "git -C'repo' push --force",
    "git.cmd push --force",
    "git checkout -f", "git switch --discard-changes", "git restore --worktree --source=HEAD .", "git push --mirror",
  ];
  for (const p of high) {
    const r = t.riskOf({ requestKind: "command", prompt: p }); assert.equal(r.level, "high", p);
  }
});
test("riskOf: long-form rm/find/Remove-Item deletes are high", () => {
  for (const p of ["rm --recursive --force", "rm --force", "find . -delete", "find . -exec rm {} +", "Remove-Item -r -fo"]) {
    const r = t.riskOf({ requestKind: "command", prompt: p }); assert.equal(r.level, "high", p); assert.ok(r.reasons.length, p);
  }
});

test("riskOf: push delete-refspec is high anywhere after push; HEAD:branch is not", () => {
  for (const p of ["git push :foo", "git push origin :foo", "git push -u origin :foo", "git push --atomic origin :feature", "git --no-pager push -u origin :gone"])
    assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git push HEAD:branch" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git push origin HEAD:feature" }).level, "high");
});

test("riskOf: switch/restore/checkout destructive forms are high; staged-only restore and create-branch are not", () => {
  const high = [
    "git switch -f", "git switch --force", "git switch -C existing", "git switch --force-create existing",
    "git restore .", "git restore --source=HEAD .", "git restore -W .", "git restore --worktree --source=HEAD .",
    "git restore --staged --worktree file", "git restore -S -W file",
    "git checkout -- .", "git checkout HEAD -- file", "git checkout -B existing",
  ];
  for (const p of high) assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git restore --staged file" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git restore -S file" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git switch -c newbranch" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git checkout -b newbranch" }).level, "high");
});

test("riskOf: branch short-flag clusters and --force/-C are high; listing stays low", () => {
  for (const p of ["git branch -d -v feature", "git branch -dv feature", "git branch -Dvf feature", "git branch -C dest", "git branch --force dest"])
    assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  for (const p of ["git branch", "git branch --list", "git branch --show-current", "git branch -v"])
    assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "low", p);
});

test("riskOf: find -exec/-execdir/-ok/-okdir rm (and /rm) are high and not read-only; -execdir is not rm -rf", () => {
  for (const p of ["find /var/tmp -name core -exec /bin/rm {} \\;", "find . -ok rm {} \\;", "find . -execdir rm {} +", "find . -okdir /usr/bin/rm {} \\;", "find . -exec rm {} +"])
    assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  assert.equal(t.riskOf({ requestKind: "command", prompt: "find . -name '*.tmp' -print" }).level, "low");
  assert.equal(t.riskOf({ requestKind: "command", prompt: "find . -exec echo {} \\;" }).level, "low");
});

test("riskOf: PowerShell Remove-Item unique prefixes of Recurse/Force are high; -filter is not", () => {
  for (const p of ["Remove-Item -Recurse x", "Remove-Item -r x", "Remove-Item -Force x", "Remove-Item -fo x", "Remove-Item -Rec x", "Remove-Item -Re x", "Remove-Item -for x", "Remove-Item -forc x", "del -rec x"])
    assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "Remove-Item -filter x" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "Remove-Item x" }).level, "high");
});

test("riskOf: fetch --prune/-p and push --all/--prune are high; bare fetch stays low", () => {
  for (const p of ["git fetch --prune", "git fetch -p", "git push --all", "git push --prune", "git push --mirror"])
    assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  for (const p of ["git fetch", "git fetch origin", "git fetch origin feature"])
    assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "low", p);
});

test("riskOf: single-quoted git.exe / git.cmd are judged like double-quoted", () => {
  for (const p of ["'git.exe' push --force", "'git.cmd' reset --hard", '"git.exe" push --force', '"git.cmd" reset --hard'])
    assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
});

test("riskOf: push -d and quoted delete refspecs are high; HEAD:branch stays normal", () => {
  for (const p of ["git push -d origin feature", "git push origin ':feature'", 'git push origin ":feature"', "git push -u origin ':gone'"])
    assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git push HEAD:branch" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git push origin HEAD:feature" }).level, "high");
});

test("riskOf: checkout pathspec / tree-ish+path / --ours/--theirs are high; checkout -b is not", () => {
  for (const p of ["git checkout .", "git checkout HEAD file", "git checkout HEAD~1 src/app.js", "git checkout --ours file", "git checkout --theirs path"])
    assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git checkout -b newbranch" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git checkout --help" }).level, "high");
});

test("riskOf: unique prefixes of restore --worktree and switch --discard-changes are high", () => {
  for (const p of ["git restore --staged --work file", "git restore --staged --workt file", "git restore --w file", "git switch --discard-c main", "git switch --dis main"])
    assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git restore --staged file" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git switch -c newbranch" }).level, "high");
});

test("riskOf: PowerShell rm -Recurse/-Force is high; Unix rm -r stays a single Unix match", () => {
  for (const p of ["rm -Recurse build", "rm -Force build", "rm -fo build", 'pwsh -Command "rm -Recurse build"']) {
    const r = t.riskOf({ requestKind: "command", prompt: p });
    assert.equal(r.level, "high", p);
    assert.ok(r.reasons.some((x) => /PowerShell rm/i.test(x)), p);
  }
  const unix = t.riskOf({ requestKind: "command", prompt: "rm -r build" });
  assert.equal(unix.level, "high");
  assert.equal(unix.reasons.filter((x) => /PowerShell rm/i.test(x)).length, 0);
  assert.equal(unix.reasons.length, 1);
});

test("riskOf: find -exec quoted rm, wrappers, unlink/rmdir, and -execdir sh -c rm are high and not read-only", () => {
  const high = [
    "find . -exec 'rm' {} \\;", "find . -exec command rm {} \\;", "find . -exec env rm {} \\;",
    "find . -execdir sh -c 'rm \"$1\"' _ {} \\;", "find . -exec unlink {} \\;", "find . -exec rmdir {} \\;",
    "find . -okdir env rm {} \\;", "find . -ok unlink {} \\;",
  ];
  for (const p of high) {
    const r = t.riskOf({ requestKind: "command", prompt: p });
    assert.equal(r.level, "high", p);
    assert.notEqual(r.level, "low", p);
  }
  assert.equal(t.riskOf({ requestKind: "command", prompt: "find . -exec echo {} \\;" }).level, "low");
});

test("riskOf: fetch --force/-f, pull prune, and remote prune are high; bare fetch stays low", () => {
  for (const p of ["git fetch --force", "git fetch -f origin feature", "git pull -p", "git pull --prune", "git remote prune origin"])
    assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  for (const p of ["git fetch", "git fetch origin feature"])
    assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "low", p);
});

test("riskOf: unique prefixes of already-high long options; skip prefixes git itself rejects", () => {
  for (const p of ["git push --al origin", "git push --mi origin", "git push --pru origin", "git branch --del feature", "git branch --delet feature", "git branch --mov old new", "rm -d emptydir", "rm --rec build"])
    assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  // git branch --for is ambiguous (--force vs --format); git fetch --pru is ambiguous (--prune vs --prune-tags)
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git branch --for dest" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch --pru" }).level, "high");
});

test("riskOf: shorter unique prefixes git 2.43 / GNU rm already accept are high", () => {
  // git push --de is --delete (unique vs --dry-run). git branch --d/--de is --delete; --mo is --move.
  // rm --r/--re is --recursive; --f is --force; --d is --dir. git switch --di is --discard-changes.
  for (const p of [
    "git push --de origin feature", "git branch --d feature", "git branch --de feature", "git branch --mo old new",
    "rm --r build", "rm --re build", "rm --f build", "rm --d emptydir", "git switch --di main",
  ]) assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  // skipped: git push --d is ambiguous (--delete vs --dry-run); git switch --d is (--discard-changes vs --detach);
  // git branch --m is (--move vs --merged). git rejects these.
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git push --d origin feature" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git switch --d main" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git branch --m old new" }).level, "high");
});

test("riskOf: git pull --force/-f/--fo is high like fetch --force; --ff-only stays normal", () => {
  for (const p of ["git pull -f", "git pull --force", "git pull --fo", "git pull -pf origin"])
    assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git pull --ff-only" }).level, "high");
  // git pull --f is ambiguous (--force vs --ff-only); git rejects it
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git pull --f" }).level, "high");
});

test("riskOf: find -exec wrappers, quoted/path shells, git rm, and multiline -exec are high and not read-only", () => {
  const high = [
    "find . -exec /bin/sh -c 'rm {}' \\;",
    "find . -exec 'sh' -c 'rm {}' \\;",
    "find . -exec \"bash\" -c 'rm {}' \\;",
    "find . -exec /usr/bin/env rm {} \\;",
    "find . -exec env -i rm {} \\;",
    "find . -exec command -p rm {} \\;",
    "find . -exec nice -n 19 rm {} \\;",
    "find . -exec git rm {} \\;",
    "find .\n  -exec rm {} \\;",
    "find . -execdir /bin/sh -c 'rm {}' \\;",
    "find . -ok env -i rm {} \\;",
    "find . -okdir git rm {} \\;",
  ];
  for (const p of high) {
    const r = t.riskOf({ requestKind: "command", prompt: p });
    assert.equal(r.level, "high", p);
    assert.notEqual(r.level, "low", p);
  }
  assert.equal(t.riskOf({ requestKind: "command", prompt: "find . -exec echo {} \\;" }).level, "low");
});

test("riskOf: checkout path / tree-ish+path / --ours --theirs prefixes / -2 -3 are high; -b stays normal", () => {
  const high = [
    "git checkout ../file", "git checkout ..",
    "git checkout './file'", 'git checkout "./src/app.js"',
    "git checkout @ file", "git checkout @~1 file", "git checkout HEAD@{1} file", "git checkout 'HEAD' file",
    "git checkout main file", "git checkout origin/main src/app.js",
    "git checkout --our file", "git checkout --ou file", "git checkout --their file", "git checkout --th file",
    "git checkout -2 file", "git checkout -3 file",
  ];
  for (const p of high) assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git checkout -b newbranch" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git checkout main" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git checkout --help" }).level, "high");
  // git checkout --o is ambiguous (--ours vs --overwrite-ignore); --t is (--theirs vs --track)
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git checkout --o file" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git checkout --t file" }).level, "high");
});

test("riskOf: quoted force refspecs on push and fetch are high like the unquoted form", () => {
  for (const p of [
    "git push origin '+feature'", 'git push origin "+feature"',
    "git push origin '+ :gone'", "git push origin '+:gone'",
    "git fetch origin '+feature:feature'", "git fetch origin '+refs/heads/a:refs/heads/b'",
    'git fetch origin "+refs/heads/a:refs/heads/b"',
  ]) assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch origin feature:feature" }).level, "low");
});

test("riskOf: find -exec ksh/ash/fish/csh/busybox/timeout deletes are high and not read-only", () => {
  const high = [
    "find . -exec ksh -c 'rm {}' \\;",
    "find . -exec /bin/ash -c 'rm {}' \\;",
    "find . -exec busybox sh -c 'rm {}' \\;",
    "find . -exec busybox rm {} +",
    "find . -exec timeout 5 rm {} \\;",
    "find . -execdir ksh -c 'rm {}' \\;",
    "find . -ok /bin/ash -c 'rm {}' \\;",
    "find . -okdir busybox rm {} +",
    "find . -execdir timeout 5 rm {} \\;",
    "find . -exec fish -c 'rm {}' \\;",
    "find . -exec csh -c 'rm {}' \\;",
    "find . -exec tcsh -c 'rm {}' \\;",
  ];
  for (const p of high) {
    const r = t.riskOf({ requestKind: "command", prompt: p });
    assert.equal(r.level, "high", p);
    assert.notEqual(r.level, "low", p);
  }
  assert.equal(t.riskOf({ requestKind: "command", prompt: "find . -exec echo {} \\;" }).level, "low");
  assert.equal(t.riskOf({ requestKind: "command", prompt: "find . -exec timeout 5 echo {} \\;" }).level, "low");
});

test("riskOf: unique prefixes git already accepts for reset --hard, branch --force, push --mirror", () => {
  for (const p of ["git reset --h", "git reset --ha", "git reset --har", "git reset --hard HEAD"])
    assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  for (const p of ["git branch -f existing HEAD", "git branch --forc existing HEAD", "git branch --force existing HEAD"])
    assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git branch --for dest" }).level, "high");
  for (const p of ["git branch", "git branch --list", "git branch --show-current", "git branch -v"])
    assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "low", p);
  assert.equal(t.riskOf({ requestKind: "command", prompt: "git push --m origin" }).level, "high");
  assert.equal(t.riskOf({ requestKind: "command", prompt: "git push --mi origin" }).level, "high");
});

test("riskOf: -b/--orphan exemption does not hide a discard on the same command or chained before -b", () => {
  for (const p of [
    "git checkout -f -b newbranch",
    "git checkout -f --orphan newbranch",
    "git checkout -f main && git checkout -b newbranch",
    "git checkout -- . && git checkout -b newbranch",
    "git checkout main file && git checkout -b newbranch",
  ]) assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git checkout -b new origin/main" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git checkout -b newbranch" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git checkout --orphan newbranch" }).level, "high");
});

test("riskOf: quoted / Windows / glob checkout pathspecs are high; bare branch and -b stay normal", () => {
  for (const p of [
    "git checkout '.'", 'git checkout "."', "git checkout '..'", "git checkout '*.js'",
    "git checkout .\\file", "git checkout '\\.\\src\\app.js'",
    "git checkout src/app.js",
  ]) assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git checkout main" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git checkout -b newbranch" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git checkout feature" }).level, "high");
});

test("riskOf: ANSI-C $'' force refspecs and indented continuation flags are high", () => {
  for (const p of [
    "git push origin $'+feature'",
    "git fetch origin $'+feature:feature'",
    "git push \\\n  --force origin feature",
    "git push \\\n  --de origin feature",
    "git fetch \\\n  --force origin feature",
    "git push\n--force origin feature",
  ]) assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
});

test("uopt: unique prefixes of --all start at --al, not the ambiguous --a", () => {
  const re = new RegExp(t.uopt("all", 2) + "\\b");
  assert.ok(re.test("--al")); assert.ok(re.test("--all")); assert.ok(!re.test("--a")); assert.ok(!re.test("--atomic"));
});

test("riskOf: find -exec mksh/rbash/time/flock/setsid/gtimeout/perl/node/python3 deletes are high and not read-only", () => {
  const high = [
    "find . -exec mksh -c 'rm {}' \\;",
    "find . -exec rbash -c 'rm {}' \\;",
    "find . -exec time rm {} \\;",
    "find . -exec flock /tmp/l rm {} \\;",
    "find . -exec setsid rm {} \\;",
    "find . -exec gtimeout 1 rm {} \\;",
    "find . -exec perl -e 'unlink @ARGV' {} \\;",
    "find . -exec node -e 'require(\"fs\").unlinkSync(\"a\")' \\;",
    "find . -exec python3 -c 'os.remove(\"a\")' \\;",
  ];
  for (const p of high) {
    const r = t.riskOf({ requestKind: "command", prompt: p });
    assert.equal(r.level, "high", p);
    assert.notEqual(r.level, "low", p);
  }
  assert.equal(t.riskOf({ requestKind: "command", prompt: "find . -exec echo {} \\;" }).level, "low");
  assert.equal(t.riskOf({ requestKind: "command", prompt: "find . -exec timeout 5 echo {} \\;" }).level, "low");
});

test("riskOf: push --branches/--branch/--br/--b are high like --all; --a stays normal", () => {
  // git 2.43: --b is unique for --branches (nothing else in git push -h starts with --b).
  // --a stays ambiguous (--all vs --atomic), so that floor stays at --al.
  for (const p of ["git push --branches", "git push --branch", "git push --br", "git push --b origin", "git push --all", "git push --al"])
    assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git push --a origin" }).level, "high");
  const re = new RegExp(t.uopt("branches", 1) + "\\b");
  assert.ok(re.test("--b")); assert.ok(re.test("--br")); assert.ok(re.test("--branch")); assert.ok(re.test("--branches"));
  assert.ok(!re.test("--atomic"));
  const all = new RegExp(t.uopt("all", 2) + "\\b");
  assert.ok(all.test("--al")); assert.ok(all.test("--all")); assert.ok(!all.test("--a")); assert.ok(!all.test("--atomic"));
});

test("riskOf: extensionless and magic pathspec checkouts are high; bare branch and -b stay normal", () => {
  for (const p of [
    "git checkout Makefile",
    "git checkout README",
    'git checkout "README"',
    "git checkout ':(literal)README'",
    "git checkout Dockerfile",
    'git checkout "Dockerfile"',
    "git checkout LICENSE",
    "git checkout Gemfile",
    "git checkout VERSION",
    "git checkout COPYING",
    "git checkout Jenkinsfile",
    "git checkout Justfile",
    "git checkout LICENCE",
    'git checkout "LICENCE"',
    "git checkout Containerfile",
    "git checkout Rakefile",
    "git checkout Procfile",
    "git checkout Pipfile",
    "git checkout CODEOWNERS",
    "git checkout UNLICENSE",
  ]) assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git checkout -b newbranch" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git checkout -b brand-new" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git checkout main" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git checkout feature" }).level, "high");
});

test("riskOf: backslash-newline continuation on branch/checkout/clean/reset is high", () => {
  for (const p of [
    "git branch \\\n  -f existing HEAD",
    "git checkout \\\n  -- f",
    "git clean \\\n  -f",
    "git reset \\\n--hard",
    "git reset \\\n  --hard",
  ]) assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
});

test("riskOf: backslash-newline push to main and indented switch/branch -C/checkout -B are high", () => {
  // one-line push to main/master and unindented switch -f / branch -C / checkout -B are already high;
  // indent spaces after `\` + newline hid -C/-B, and [^\n]* hid push origin main and --discard-changes.
  for (const p of [
    "git push \\\norigin master",
    "git push \\\norigin main",
    "git switch \\\n--discard-changes feature",
    "git switch \\\n  -f feature",
    "git switch \\\n-f feature",
    "git branch \\\n  -C feature copied-indent",
    "git branch \\\n-C feature copied",
    "git checkout \\\n  -B feature",
    "git checkout \\\n-B feature",
  ]) assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
});

test("riskOf: find -exec stdbuf/ionice/taskset/chrt/prlimit and python3 shutil.rmtree are high and not read-only", () => {
  const high = [
    "find . -exec stdbuf -oL rm {} \\;",
    "find . -exec ionice -c3 rm {} \\;",
    "find . -exec taskset -c 0 rm {} \\;",
    "find . -exec chrt -i 0 rm {} \\;",
    "find . -exec prlimit --nofile=256 rm {} \\;",
    "find . -exec python3 -c '(__import__(\"shutil\").rmtree(\"sub\"))'",
    "find . -exec python3 -c 'import shutil; shutil.rmtree(\"sub\")'",
  ];
  for (const p of high) {
    const r = t.riskOf({ requestKind: "command", prompt: p });
    assert.equal(r.level, "high", p);
    assert.notEqual(r.level, "low", p);
  }
  assert.equal(t.riskOf({ requestKind: "command", prompt: "find . -exec echo {} \\;" }).level, "low");
  assert.equal(t.riskOf({ requestKind: "command", prompt: "find . -exec time echo {} \\;" }).level, "low");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "timeout 5 echo" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "python3 -c 'print(123)'" }).level, "high");
});

test("riskOf: ANSI-C $':…' delete refspecs are high", () => {
  for (const p of ["git push origin $':gone'", "git push origin $':feature'", "git push origin $'+feature'"])
    assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git push origin HEAD:feature" }).level, "high");
});

test("riskOf: find -exec choom/setarch/setpriv/unshare rm are high and not read-only", () => {
  const high = [
    "find . -exec choom -n 0 rm {} \\;",
    "find . -exec setarch x86_64 rm {} \\;",
    "find . -exec setpriv --no-new-privs rm {} \\;",
    "find . -exec unshare --user rm {} \\;",
  ];
  for (const p of high) {
    const r = t.riskOf({ requestKind: "command", prompt: p });
    assert.equal(r.level, "high", p);
    assert.notEqual(r.level, "low", p);
  }
  assert.equal(t.riskOf({ requestKind: "command", prompt: "find . -exec echo {} \\;" }).level, "low");
  assert.equal(t.riskOf({ requestKind: "command", prompt: "find . -exec choom -n 0 echo {} \\;" }).level, "low");
});

test("riskOf: find -exec perl remove_tree and python3 removedirs are high and not read-only", () => {
  const high = [
    "find . -exec perl -MFile::Path=remove_tree -e 'remove_tree(\"sub\")'",
    "find . -exec python3 -c '(__import__(\"os\").removedirs(\"empty/nested\"))'",
    "find . -exec python3 -c 'import os; os.removedirs(\"empty/nested\")'",
  ];
  for (const p of high) {
    const r = t.riskOf({ requestKind: "command", prompt: p });
    assert.equal(r.level, "high", p);
    assert.notEqual(r.level, "low", p);
  }
  assert.equal(t.riskOf({ requestKind: "command", prompt: "find . -exec echo {} \\;" }).level, "low");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "python3 -c 'print(123)'" }).level, "high");
});

test("riskOf: backslash-newline pull force/prune, remote prune, and rm -rf are high; --ff-only stays normal", () => {
  for (const p of [
    "git pull \\\n--force origin main:main",
    "git pull \\\n--fo origin main:main",
    "git pull \\\n-f origin main:main",
    "git pull \\\n  --force origin feature",
    "git pull \\\n--prune origin",
    "git pull \\\n  --prune origin",
    "git remote \\\nprune origin",
    "git remote \\\n  prune origin",
    "rm \\\n-rf build",
    "rm \\\n  -rf build",
  ]) assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git pull --ff-only" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git pull \\\n--ff-only" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git pull \\\n  --ff-only" }).level, "high");
});

test("riskOf: find -exec setarch personality aliases (linux32/linux64/i386/x86_64) rm are high and not read-only", () => {
  const high = [
    "find . -exec linux32 rm {} \\;",
    "find . -exec linux64 rm {} \\;",
    "find . -exec i386 rm {} \\;",
    "find . -exec x86_64 rm {} \\;",
  ];
  for (const p of high) {
    const r = t.riskOf({ requestKind: "command", prompt: p });
    assert.equal(r.level, "high", p);
    assert.notEqual(r.level, "low", p);
  }
  for (const p of [
    "find . -exec linux32 echo {} \\;",
    "find . -exec linux64 echo {} \\;",
    "find . -exec i386 echo {} \\;",
    "find . -exec x86_64 echo {} \\;",
  ]) assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "low", p);
});

test("riskOf: find -exec nsenter rm is high and not read-only; nsenter echo stays low", () => {
  const high = ["find . -exec nsenter rm {} \\;", "find . -exec nsenter --user rm {} \\;", "nsenter rm -rf file"];
  for (const p of high) {
    const r = t.riskOf({ requestKind: "command", prompt: p });
    assert.equal(r.level, "high", p);
    assert.notEqual(r.level, "low", p);
  }
  assert.equal(t.riskOf({ requestKind: "command", prompt: "find . -exec nsenter echo {} \\;" }).level, "low");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "nsenter echo" }).level, "high");
});

test("riskOf: find -exec script -c / capsh -- -c rm are high and not read-only", () => {
  const high = [
    "find . -exec script -q -c 'rm {}' /dev/null \\;",
    "find . -exec capsh -- -c 'rm {}' \\;",
  ];
  for (const p of high) {
    const r = t.riskOf({ requestKind: "command", prompt: p });
    assert.equal(r.level, "high", p);
    assert.notEqual(r.level, "low", p);
  }
  assert.equal(t.riskOf({ requestKind: "command", prompt: "find . -exec script -q -c 'echo {}' /dev/null \\;" }).level, "low");
  assert.equal(t.riskOf({ requestKind: "command", prompt: "find . -exec capsh -- -c 'echo {}' \\;" }).level, "low");
});

test("riskOf: find -exec python3 -c os.remove spellings that are not literal os.remove are high", () => {
  const high = [
    "find . -exec python3 -c '(__import__(\"os\").remove(\"a\"))' \\;",
    "find . -exec python3 -c '(__import__(\"posix\").remove(\"a\"))' \\;",
    "find . -exec python3 -c 'from os import remove; remove(\"a\")' \\;",
    "find . -exec python3 -c 'import os as o; o.remove(\"a\")' \\;",
  ];
  for (const p of high) {
    const r = t.riskOf({ requestKind: "command", prompt: p });
    assert.equal(r.level, "high", p);
    assert.notEqual(r.level, "low", p);
  }
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "python3 -c 'print(123)'" }).level, "high");
  assert.equal(t.riskOf({ requestKind: "command", prompt: "find . -exec echo {} \\;" }).level, "low");
});

test("riskOf: git pull + dest refspecs are high like fetch; --ff-only stays normal", () => {
  for (const p of [
    "git pull ../origin +main:main",
    "git pull origin +refs/heads/main:refs/heads/main",
    "git pull origin \\\n+refs/heads/main:refs/heads/main",
    "git pull origin \\\n  +refs/heads/main:refs/heads/main",
  ]) assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git pull --ff-only" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git pull \\\n--ff-only" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git pull \\\n  --ff-only" }).level, "high");
});

test("riskOf: quoted and $'...' rm -rf / git pull --force flags are high; harmless quoted args stay normal", () => {
  for (const p of [
    'rm "-rf" dir',
    "rm $'-rf' dir",
    'git pull "--force" origin main',
    "git pull $'--force' origin main",
  ]) assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: 'rm "-v" file' }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "rm $'-v' file" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: 'git pull "--ff-only"' }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git pull $'origin'" }).level, "high");
});

test("riskOf: git remote -v/--verbose prune and update -p/--prune are high; bare -v stays low; && echo prune is not high", () => {
  for (const p of [
    "git remote -v prune origin",
    "git remote --verbose prune origin",
    "git remote -v update -p origin",
    "git remote update -p",
    "git remote update --prune",
    "git remote update \\\n--prune",
    "git remote update \\\n  --prune",
  ]) assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  assert.equal(t.riskOf({ requestKind: "command", prompt: "git remote -v" }).level, "low");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git remote -v && echo prune" }).level, "high");
});

test("riskOf: git restore --staged continued onto --worktree / -S onto -W is high; --staged alone stays normal", () => {
  for (const p of [
    "git restore --staged \\\n  --worktree f",
    "git restore --staged \\\n--worktree f",
    "git restore -S \\\n  -W file",
    "git restore -S \\\n-W file",
  ]) assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git restore --staged file" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git restore -S file" }).level, "high");
});

test("riskOf: restore -S/-W only match as flags, not inside paths; continuations stay high", () => {
  // v1.4.14 dropped (?<=\s) on -W/-S so my-Script / file-W looked like flags.
  for (const p of [
    "git restore my-Script",
    "git restore src/app-Setup.ts",
    "git restore foo-S",
    "git restore README",
    "git restore --staged \\\n  --worktree f",
    "git restore --staged \\\n--worktree f",
    "git restore -S \\\n  -W file",
    "git restore -S \\\n-W file",
  ]) assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git restore --staged file-W" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git restore --staged README-W" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git restore --staged file" }).level, "high");
});

test("riskOf: joined quotes and backslash-escaped flags are high like whole-token quotes", () => {
  for (const p of [
    'rm -"rf" dir',
    'rm "-"rf dir',
    "rm -\\rf dir",
    'rm --"force" dir',
    'git pull --"force" origin main',
    'git restore --staged --"worktree" file',
    'git push --"force" origin feature',
  ]) assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: 'rm "-v" file' }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: 'git pull "--ff-only"' }).level, "high");
});

test("riskOf: git pull backslash-escaped + refspec is high like push; --ff-only stays normal", () => {
  for (const p of [
    "git pull origin \\+main:main",
    "git pull origin '+main:main'",
    "git pull origin $'+main:main'",
  ]) assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git pull --ff-only" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git pull \\\n--ff-only" }).level, "high");
});

test("riskOf: git remote quoted -v prune and update --pr are high; --pro / bare -v / && echo prune are not", () => {
  for (const p of [
    'git remote "-v" prune origin',
    "git remote $'-v' prune origin",
    "git remote update --pr origin",
  ]) assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  assert.equal(t.riskOf({ requestKind: "command", prompt: "git remote -v" }).level, "low");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git remote update --pro origin" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git remote -v && echo prune" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git remote update origin-p" }).level, "high");
});

test("riskOf: quoted git fetch prune/force are high, not read-only; non-force refspec stays normal", () => {
  for (const p of [
    'git fetch "--prune" origin',
    'git fetch "-p" origin',
    'git fetch "--force" origin main:other',
    'git fetch "--force" origin',
    "git fetch $'--force' origin",
    "git fetch --prune",
    "git fetch -p",
  ]) assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  assert.equal(t.riskOf({ requestKind: "command", prompt: "git fetch origin feature:feature" }).level, "normal");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch --pr" }).level, "high");
});

test("riskOf: unquoted leading-dot checkout pathspecs are high; bare branches stay normal", () => {
  for (const p of [
    "git checkout .gitignore",
    "git checkout .github",
    "git checkout .gitmodules",
    "git checkout .editorconfig",
    'git checkout ".gitignore"',
    "git checkout ./.gitignore",
    "git checkout -- .gitignore",
    "git checkout HEAD .gitignore",
  ]) assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git checkout main" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git checkout feature" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git checkout -b newbranch" }).level, "high");
});

test("riskOf: more extensionless checkout names are high; -b / --orphan / branch names stay normal", () => {
  for (const p of [
    "git checkout Vagrantfile",
    'git checkout "Vagrantfile"',
    "git checkout Brewfile",
    "git checkout Podfile",
    "git checkout Fastfile",
    "git checkout NOTICE",
    "git checkout OWNERS",
    "git checkout vagrantfile",
    "git checkout owners",
  ]) assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git checkout -b Vagrantfile" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git checkout --orphan Vagrantfile" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git checkout main" }).level, "high");
});

test("riskOf: quoted short restore -W/-SW are high; file-W stays a path; my-Script stays high", () => {
  // v1.4.15 restored (?<=\\s) on -W/-S so file-W is a path, but a quote between space and dash
  // hid whole-token '-W' / "-W" / $'-W' / '-SW' (argv -W / -SW, discards the worktree).
  for (const p of [
    "git restore --staged '-W' file",
    'git restore --staged "-W" file',
    "git restore --staged $'-W' file",
    "git restore --staged '-SW' file",
    "git restore --staged --worktree file",
    "git restore --staged --\"worktree\" file",
    "git restore --staged --\"w\" file",
    "git restore --staged \\\n  --worktree f",
    "git restore my-Script",
  ]) assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git restore --staged file-W" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git restore --staged file" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git restore -S file" }).level, "high");
});

test("riskOf: git remote update --p / quoted -p / joined --prune are high; --pr stays high; --pro / -v / origin-p are not", () => {
  // git 2.43 accepts --p/--pr/--pru/--prun/--prune on update. v1.4.15 floored at --pr and
  // (?<=\\s)-p, so --p and quoted/joined -p/--prune (argv -p / --prune) stayed normal.
  for (const p of [
    "git remote update --p origin",
    'git remote update "-p"',
    "git remote update '-p'",
    "git remote update $'-p'",
    'git remote update --"prune"',
    'git remote update -"p"',
    "git remote update --pr origin",
    "git remote update --prune origin",
    "git remote update -p",
  ]) assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  assert.equal(t.riskOf({ requestKind: "command", prompt: "git remote -v" }).level, "low");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git remote update --pro origin" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git remote -v && echo prune" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git remote update origin-p" }).level, "high");
});

test("riskOf: ANSI-C $ after the dashes is high; fetch is not read-only; harmless quoted args stay normal", () => {
  // qflag allowed quote/backslash immediately after -/-- and whole-token $'--prune' / $'-rf',
  // but not -$'' / --$'' (and rm -v"rf" → argv -vrf). Fetch's high path and READ_ONLY share FETCH_FLAG.
  for (const p of [
    "git fetch -$'p' origin",
    "git fetch --$'prune' origin",
    "git fetch -$'f' origin",
    "rm -$'rf' dir",
    "rm --$'force' dir",
    "git pull --$'force'",
    "git push --$'force'",
    "git restore --staged --$'worktree' file",
    'rm -v"rf" dir',
    'rm -"rf" dir',
    'rm --"force" dir',
    'git fetch "--prune" origin',
  ]) {
    const r = t.riskOf({ requestKind: "command", prompt: p });
    assert.equal(r.level, "high", p);
    assert.notEqual(r.level, "low", p);
  }
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: 'rm "-v" file' }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: 'git pull "--ff-only"' }).level, "high");
});

test("riskOf: fetch mid-word quotes, empty quotes, -np, and ANSI-C hex prune/force are high, not read-only", () => {
  // v1.4.16 qflag only allowed a quote/$'/backslash immediately after -/--. Mid-word
  // quotes, empty '' / $'', combined -n"p" (argv -np), and $'--pr\x75ne' stayed low
  // because READ_ONLY shares FETCH_FLAG. --fo"rce" was already high (--fo unique prefix).
  // Fetch --prune is the whole word (min 5): --pru is ambiguous with --prune-tags.
  for (const p of [
    'git fetch --pru"ne"',
    'git fetch --pr"une"',
    'git fetch --prun"e"',
    'git fetch --f"orce"',
    "git fetch --''prune",
    "git fetch --$''prune",
    "git fetch ''--prune",
    "git fetch -''p",
    'git fetch -n"p"',
    "git fetch $'--pr\\x75ne'",
    'git fetch --fo"rce"',
    "git fetch --prune",
  ]) {
    const r = t.riskOf({ requestKind: "command", prompt: p });
    assert.equal(r.level, "high", p);
    assert.notEqual(r.level, "low", p);
  }
  assert.equal(t.riskOf({ requestKind: "command", prompt: "git fetch origin" }).level, "low");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch --pru" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch --no-force" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch --follow-tags" }).level, "high");
});

test("riskOf: restore/remote/push/pull/rm empty quotes, mid-token joins, and ANSI-C hex are high", () => {
  // Same joins as fetch, on verbs already using qflag: -S"W" is argv -SW (worktree), not
  // staged-only -S (quote used to be a word boundary). ''-W / -''W / $''-W / --''worktree
  // glue to -W / --worktree. -v\\rf and $'-v\\x72f' are argv -vrf.
  for (const p of [
    'git restore --staged -S"W" tracked',
    "git restore --staged ''-W",
    "git restore --staged -S'W'",
    "git restore --staged -S$'W'",
    "git restore --staged -S\\W",
    'git restore --staged ""-W',
    "git restore --staged -''W",
    "git restore --staged $''-W",
    "git restore --staged --''worktree",
    "git restore --staged --$''worktree",
    "git restore --staged $'-\\x57'",
    "git restore --staged $'-S\\x57'",
    "git remote update -''p",
    "git remote update --''prune",
    "git remote update ''-p",
    'git push -u"f"',
    "git push --''force",
    "git push --''force-with-lease",
    'git pull --pr"une"',
    'git pull --f"orce"',
    "git pull -''p",
    "rm -v\\rf dir",
    "rm $'-v\\x72f'",
    "rm $'-\\x76rf'",
  ]) assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git restore --staged file" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git restore --staged file-W" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git restore --staged --word file" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git remote update --pro origin" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: 'rm "-v" file' }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: 'git pull "--ff-only"' }).level, "high");
});

test("riskOf: quoted/ANSI-C flags on reset/clean/switch/checkout/branch/push/remote verbs are high", () => {
  // These verbs never called qflag, so --$'hard' / --"hard" / -"fd" / -$'f' / "-D" /
  // --"delete" / 'prune' / "update" --prune ran at normal. Same helper as fetch.
  for (const p of [
    "git reset --$'hard'",
    'git reset --"hard"',
    'git clean -"fd"',
    'git clean --"force"',
    "git switch -$'f'",
    'git switch --"discard-changes"',
    'git checkout -"f" tracked',
    'git branch "-D"',
    'git branch --"delete"',
    'git push --"delete"',
    'git push --"prune"',
    "git remote 'prune' origin",
    'git remote "update" --prune',
  ]) assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git checkout -b newbranch" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git switch -c newbranch" }).level, "high");
  assert.equal(t.riskOf({ requestKind: "command", prompt: "git remote -v" }).level, "low");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git branch --for dest" }).level, "high");
});

test("riskOf: ANSI-C hex dash / octal / unicode prune is high, not read-only", () => {
  // v1.4.17 qhex only rewrote letters as \\xHH. Hex dashes ($'\\x2d\\x2dprune' / $'\\x2dp'),
  // octal u ($'--pr\\165ne'), and unicode u ($'--pr\\u0075ne') stayed low and still pruned.
  for (const p of [
    "git fetch $'\\x2d\\x2dprune'",
    "git fetch $'\\x2dp'",
    "git fetch $'--pr\\165ne'",
    "git fetch $'--pr\\u0075ne'",
    "git fetch $'--pr\\x75ne'",
  ]) {
    const r = t.riskOf({ requestKind: "command", prompt: p });
    assert.equal(r.level, "high", p);
    assert.notEqual(r.level, "low", p);
  }
  assert.equal(t.riskOf({ requestKind: "command", prompt: "git fetch origin" }).level, "low");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch --no-force" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch --follow-tags" }).level, "high");
});

test("riskOf: rm ANSI-C hex dash and octal letter -rf is high", () => {
  // Same spellings as fetch: $'\\x2drf' (hex dash) and $'-\\162f' (octal r) are argv -rf.
  for (const p of ["rm $'\\x2drf'", "rm $'-\\162f'", "rm $'-\\x72f'"])
    assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "rm $'-v' file" }).level, "high");
});

test("riskOf: backslash-newline inside double quotes joins fetch --prune", () => {
  // --pru"\\<newline>ne" is argv --prune; QSEP did not include newline so this stayed normal.
  const p = 'git fetch --pru"\\\nne"';
  const r = t.riskOf({ requestKind: "command", prompt: p });
  assert.equal(r.level, "high", p);
  assert.notEqual(r.level, "low", p);
  assert.equal(t.riskOf({ requestKind: "command", prompt: "git fetch origin" }).level, "low");
});

test("riskOf: quoted / ANSI-C -C and -B go through qflag", () => {
  // gitCs -C/-B never called qflag: unquoted -C stayed high, but "-C" / $'-C' /
  // checkout -"B" / switch "-C" reset/overwrite at normal.
  for (const p of [
    'git branch "-C"',
    "git branch $'-C'",
    'git checkout -"B" feature',
    'git switch "-C" feature',
    "git branch -C dest",
    "git checkout -B feature",
  ]) assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git checkout -b newbranch" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git checkout -b release-2" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git switch -c newbranch" }).level, "high");
});

test("riskOf: pathological quote piles on fetch stay fast", () => {
  // v1.4.17 QWRAP/QSEP used ['"]{1,2}, so n quotes was Fibonacci. 30 quotes took hundreds
  // of ms; 36–38 did not finish in seconds. One quote per iteration stays linear.
  const p = "git fetch --" + '"'.repeat(40) + "xyz";
  const t0 = process.hrtime.bigint();
  const r = t.riskOf({ requestKind: "command", prompt: p });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 50, `40 quotes took ${ms.toFixed(2)}ms`);
  assert.equal(r.level, "low", p);
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch --no-force" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch --follow-tags" }).level, "high");
});

test("riskOf: bash short \\u / \\U / \\x{} fetch prune/force is high, not read-only", () => {
  // v1.4.18 qhex spelled \\u as exactly four hex digits and had no \\U or \\x{}.
  // bash 5.2 also expands \\u/\\U 1–8 hex digits (greedy) and \\x{HH}. Fetch's high
  // path and READ_ONLY share FETCH_FLAG. $'\\U2d'f / $'\\u2d\\u2d'force close the
  // quote before f (a hex digit); $'\\U2df' / $'\\u2d\\u2dforce' are U+02DF / -˟orce.
  for (const p of [
    "git fetch $'\\u2d\\u2dprune'",
    "git fetch $'\\u02d\\u02dprune'",
    "git fetch $'--pr\\u75ne'",
    "git fetch $'--pr\\u075ne'",
    "git fetch $'\\U2d\\U2dprune'",
    "git fetch $'\\U0000002d\\U0000002dprune'",
    "git fetch $'--pr\\U75ne'",
    "git fetch $'--pr\\U00000075ne'",
    "git fetch $'\\U2d'f",
    "git fetch $'\\x{2d}\\x{2d}prune'",
    "git fetch $'\\x{2d}p'",
    "git fetch $'--pr\\x{75}ne'",
    "git fetch $'\\u2d\\u2d'force",
  ]) {
    const r = t.riskOf({ requestKind: "command", prompt: p });
    assert.equal(r.level, "high", p);
    assert.notEqual(r.level, "low", p);
  }
  assert.equal(t.riskOf({ requestKind: "command", prompt: "git fetch origin" }).level, "low");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch --no-force" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch --follow-tags" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch --quiet" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch $'\\x2d\\x2dquiet'" }).level, "high");
});

test("riskOf: rm short \\u / \\U / \\x{} -rf is high", () => {
  // Same spellings as fetch: $'\\u2drf' / $'\\x{2d}rf' / $'\\U2drf' are argv -rf.
  // $'-\\u72'f / $'-\\U72'f close the quote before f; $'-\\u72f' is - + U+072F.
  for (const p of [
    "rm $'\\u2drf'",
    "rm $'\\x{2d}rf'",
    "rm $'\\U0000002drf'",
    "rm $'\\U2drf'",
    "rm $'-\\x{72}f'",
    "rm $'-\\u72'f",
    "rm $'-\\U72'f",
  ]) assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "rm $'-v' file" }).level, "high");
});

test("riskOf: branch/switch -C with quote before C / \\x{2d}C is high", () => {
  // B/C are hex digits, so $'\\u2dC' is U+02DC, not -C. Argv is -C when the quote
  // closes before C, or when \\x{2d} braces terminate the hex. gitCs -C stays
  // case-sensitive (not -c).
  for (const p of [
    "git branch $'\\u2d'C dest",
    "git branch $'\\x{2d}C' dest",
    "git switch $'\\u2d'C feature",
    "git switch $'\\x{2d}C' feature",
    "git switch $'\\U2d'C feature",
  ]) assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git branch $'\\u2dC' dest" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git checkout -b newbranch" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git switch -c newbranch" }).level, "high");
});

test("riskOf: full-width \\u/\\U after the hex cap is high; greed traps stay off high", () => {
  // v1.4.19 ended every \\u/\\U arm with (?![0-9A-Fa-f]). bash 5.2 \\u takes at most 4
  // hex digits and \\U at most 8, so $'\\u002df' is argv -f (f is the next character).
  // The lookahead treated that letter as part of the escape, and fetch scored low.
  // Full-width drops the lookahead; under-width keeps it so $'\\u2df' stays U+02DF.
  for (const p of [
    "git fetch $'\\u002df'",
    "git fetch $'\\u002dff'",
    "git fetch $'\\u002d\\u002dforce'",
    "git fetch $'\\U0000002df'",
    "git fetch $'\\U0000002d\\U0000002dforce'",
    "rm $'\\u002df' file",
    "git branch $'\\u002dC' dest",
    "git switch $'\\u002dC' feature",
    "git branch $'\\u002dD' feature",
    "git clean $'\\u002d\\u002dforce'",
    "git switch $'\\u002d\\u002ddiscard-changes'",
    "git push $'\\u002df'",
    "git push $'\\u002d\\u002dforce'",
    "git fetch $'\\u002dp'",
    "git fetch $'\\u002d\\u002dprune'",
    "rm $'\\u002drf'",
    "git reset $'\\u002d\\u002dhard'",
  ]) {
    const r = t.riskOf({ requestKind: "command", prompt: p });
    assert.equal(r.level, "high", p);
    assert.notEqual(r.level, "low", p);
  }
  for (const p of [
    "git fetch $'\\U2df'",
    "git fetch $'\\u2df'",
    "git fetch $'\\u2d\\u2dforce'",
    "git branch $'\\u2dC' dest",
  ]) assert.notEqual(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  assert.equal(t.riskOf({ requestKind: "command", prompt: "git fetch origin" }).level, "low");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch --no-force" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch --follow-tags" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch --quiet" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch $'\\u002d\\u002dquiet'" }).level, "high");
});

test("riskOf: \\x{} low-8-bits dash (value mod 256) is high, not read-only", () => {
  // v1.4.19 allowed only leading zeros in \\x{…} ($'\\x{0*2d}'). bash 5.2 takes the
  // value mod 256, so $'\\x{12d}' / $'\\x{012d}' / $'\\x{102d}' are all '-'. Extra
  // non-zero high digits slipped through and fetch $'\\x{12d}f' scored low.
  for (const p of [
    "git fetch $'\\x{12d}f'",
    "git fetch $'\\x{12d}\\x{12d}force'",
    "git fetch $'\\x{012d}f'",
    "git fetch $'\\x{102d}f'",
    "rm $'\\x{12d}rf'",
    "rm $'\\x{12d}f'",
    "git push $'\\x{12d}f'",
    "git branch $'\\x{12d}C' dest",
    "git switch $'\\x{12d}C' feature",
    "git fetch $'\\x{2d}f'",
    "git fetch $'\\x{002d}f'",
    "git fetch $'\\x2df'",
  ]) {
    const r = t.riskOf({ requestKind: "command", prompt: p });
    assert.equal(r.level, "high", p);
    assert.notEqual(r.level, "low", p);
  }
  assert.equal(t.riskOf({ requestKind: "command", prompt: "git fetch origin" }).level, "low");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch --no-force" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch --follow-tags" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch --quiet" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch $'\\x{2d}\\x{2d}quiet'" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch $'\\x{2d}\\x{2d}no-force'" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git branch $'\\x2dc' dest" }).level, "high");
  assert.equal(t.riskOf({ requestKind: "command", prompt: "git branch $'\\x2dC' dest" }).level, "high");
  const long = "git fetch $'\\x{" + "1".repeat(80) + "2d}f'";
  const t0 = process.hrtime.bigint();
  const r = t.riskOf({ requestKind: "command", prompt: long });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 50, `80 extra \\x{} hex digits took ${ms.toFixed(2)}ms`);
  assert.equal(r.level, "high", long);
});

test("riskOf: unclosed \\x{…} stops at the first non-hex, like bash", () => {
  // v1.4.20 required a closing brace (\\x\\{body\\}). bash 5.2 reads hex after
  // \\x{ until } or a non-hex byte; } is optional. Value is that integer mod 256.
  // $'\\x{12dp' / $'\\x{2Dp' / $'\\x{0002dp' are argv -p; a following hex digit is
  // part of the value ($'\\x{2df}' is byte 0xdf, not -f).
  for (const p of [
    "git fetch $'\\x{12dp'",
    "git fetch $'\\x{2Dp'",
    "git fetch $'\\x{0002dp'",
    "git fetch $'\\x{2d\\x{2dprune'",
    "git fetch $'\\x{12d\\x{12dprune'",
    "git fetch $'\\x{12d'f",
    "git fetch $'\\x{12d\\x{12d'force",
    "rm $'\\x{12drf'",
    "git push $'\\x{12d'f",
    "git branch $'\\x{12d'C dest",
    "git switch $'\\x{12d'C feature",
    "git clean $'\\x{12d\\x{12d'force",
    "git reset $'\\x{12d\\x{12dhard'",
    "git fetch $'\\x{2d}f'",
    "git fetch $'\\x{12d}f'",
    "git fetch $'\\x{102d}f'",
    "git fetch $'\\x{12d}\\x{12d}prune'",
  ]) {
    const r = t.riskOf({ requestKind: "command", prompt: p });
    assert.equal(r.level, "high", p);
    assert.notEqual(r.level, "low", p);
  }
  for (const p of [
    "git fetch $'\\x{2df}'",
    "git fetch $'\\x{12d\\x{12dforce'",
  ]) assert.notEqual(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  assert.equal(t.riskOf({ requestKind: "command", prompt: "git fetch origin" }).level, "low");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch --quiet" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch --no-force" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch --follow-tags" }).level, "high");
  const unclosed = "git fetch $'\\x{" + "1".repeat(80) + "2dp'";
  const empty = "git fetch $'" + "\\x{}".repeat(40) + "origin'";
  const t0 = process.hrtime.bigint();
  const r = t.riskOf({ requestKind: "command", prompt: unclosed });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const t1 = process.hrtime.bigint();
  t.riskOf({ requestKind: "command", prompt: empty });
  const msEmpty = Number(process.hrtime.bigint() - t1) / 1e6;
  assert.ok(ms < 50, `80 extra unclosed \\x{} hex digits took ${ms.toFixed(2)}ms`);
  assert.ok(msEmpty < 50, `40 empty \\x{} probes took ${msEmpty.toFixed(2)}ms`);
  assert.equal(r.level, "high", unclosed);
});

test("riskOf: under-width \\U002d is not -f; full-width \\u/\\U stay high", () => {
  // v1.4.20 compiled git()/rm/READ_ONLY with i. Node 22 rejects (?-i:), so the
  // 4-digit \\u arm (no lookahead) also matched 4-digit \\U. bash \\U still has
  // an 8-digit cap, so $'\\U002df' is U+02DF, not -f. Quote-end and a following
  // non-hex still stop the \\U run ($'\\U002d'f / $'\\U002dp' are -f / -p).
  for (const p of [
    "git fetch $'\\U002df'",
    "git fetch $'\\U002dforce'",
    "git fetch $'\\U002d\\U002dforce'",
    "git push $'\\U002df'",
    "rm $'\\U002df'",
    "git clean $'\\U002d\\U002dforce'",
    "git fetch $'\\U2df'",
    "git fetch $'\\u2df'",
    "git fetch $'\\u2dC'",
    "git fetch $'\\U2dC'",
    "git branch $'\\U002dC' dest",
  ]) assert.notEqual(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  for (const p of [
    "git fetch $'\\u002df'",
    "git fetch $'\\U0000002df'",
    "git fetch $'\\U002dp'",
    "git fetch $'\\U002d\\U002dprune'",
    "git fetch $'\\U002d'f",
    "git fetch $'\\x{12d}f'",
    "git fetch $'\\x{2d}f'",
    "git fetch $'\\x{102d}f'",
    "git fetch $'\\x{12d}\\x{12d}prune'",
  ]) {
    const r = t.riskOf({ requestKind: "command", prompt: p });
    assert.equal(r.level, "high", p);
    assert.notEqual(r.level, "low", p);
  }
  assert.equal(t.riskOf({ requestKind: "command", prompt: "git fetch origin" }).level, "low");
  assert.equal(t.riskOf({ requestKind: "command", prompt: "git fetch $'\\U002df'" }).level, "low");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch --quiet" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch --no-force" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch --follow-tags" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch $'\\x{2d}\\x{2d}quiet'" }).level, "high");
});

test("riskOf: qflag word-boundary lookahead treats backslash as continuing the word", () => {
  // v1.4.21 qflag used (?![\\$'"]*[A-Za-z0-9]) in a template, so \\$ became \$ and
  // the class lost the backslash. Unique prefixes (--fo/--for/--h/--f/--d/--al) then
  // ended when the next letter was an ANSI-C escape, while bash still joined it:
  // $'--fo\x{6c}low-tags' is argv --follow-tags (false high). A real backslash in
  // the class lets \x / \u / \U / octal count as continuing the longer word.
  for (const p of [
    "git fetch $'--fo\\x{6c}low-tags'",
    "git fetch $'--fo\\x6clow-tags'",
    "git fetch $'--fo\\u006clow-tags'",
    "git fetch $'--fo\\U0000006clow-tags'",
    "git fetch $'--fo\\154low-tags'",
    "git fetch $'--fo\\x{16c}low-tags'",
    "git fetch $'--for\\x{6d}at'",
    "git reset $'--h\\x{65}lp'",
    "rm $'--f\\x{69}le' x",
    "git branch $'--d\\x{72}y-run'",
    "git push $'--al\\x{73}o'",
  ]) assert.notEqual(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  for (const p of [
    "git fetch $'--fo\\x{72}ce'",
    "git fetch --force",
    "git fetch --fo",
  ]) {
    const r = t.riskOf({ requestKind: "command", prompt: p });
    assert.equal(r.level, "high", p);
    assert.notEqual(r.level, "low", p);
  }
  assert.equal(t.riskOf({ requestKind: "command", prompt: "git fetch origin" }).level, "low");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch --follow-tags" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch --quiet" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch --no-force" }).level, "high");
});

test("riskOf: qenc spellings of + / : refspecs are high like the literal forms", () => {
  // v1.4.21 PLUS_SPEC / DEL_SPEC matched a literal + / : only. ANSI-C / qenc
  // spellings of + (0x2b) and : (0x3a) bypassed them, so fetch $'\x{2b}main'
  // stayed low (READ_ONLY) and push $'\x{3a}gone' stayed normal.
  for (const p of [
    "git fetch origin $'\\x{2b}main'",
    "git fetch origin $'\\x2bmain'",
    "git fetch origin $'\\x{12b}'",
    "git fetch origin $'\\x{12b}main'",
    "git fetch origin $'\\x{2bmain'",
    "git fetch origin $'\\u002bmain'",
    "git fetch origin $'\\u2bmain'",
    "git fetch origin $'\\U002bmain'",
    "git fetch origin $'\\U0000002bmain'",
    "git push origin $'\\x{2b}feature'",
    "git fetch origin +main",
    "git fetch origin $'+main'",
    "git fetch origin $' +main'",
    "git push origin '+feature'",
    "git pull origin $'\\x{2b}main:main'",
  ]) {
    const r = t.riskOf({ requestKind: "command", prompt: p });
    assert.equal(r.level, "high", p);
    assert.notEqual(r.level, "low", p);
  }
  for (const p of [
    "git push origin $'\\x{3a}gone'",
    "git push origin $'\\x{3agone'",
    "git push origin $'\\u003agone'",
    "git push origin :gone",
    "git push origin $':gone'",
  ]) assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git push origin HEAD:feature" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git push origin HEAD:branch" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch origin feature:feature" }).level, "low");
  assert.equal(t.riskOf({ requestKind: "command", prompt: "git fetch origin" }).level, "low");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch --follow-tags" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch --quiet" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch --no-force" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch origin $'\\x{2bf}'" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch origin $'\\u2b0main'" }).level, "high");
});

test("riskOf: qenc 3-digit octal value+256 is the same byte as in-range octal", () => {
  // v1.4.22 qenc emitted \\53/\\053 for + and \\72/\\072 for :. bash 5.2 3-digit
  // octal keeps the low 8 bits, so \\453 is + (299&0xff), \\472 is :, \\546 is f.
  for (const p of [
    "git fetch origin $'\\453main'",
    "git push origin $'\\472gone'",
    "git fetch $'-\\546' origin",
    "git fetch $'--\\560rune' origin",
    "git push $'--\\546orce' origin x",
    "rm $'-\\546' x",
    "rm $'-\\562f' dir",
    "git clean $'-\\546'",
    "git branch $'-\\544' gone",
    "git fetch origin $'\\053main'",
    "git push origin $'\\072gone'",
    "git fetch $'-\\146' origin",
    "rm $'-\\162f' dir",
    "git fetch origin $'+main'",
    "git push origin :gone",
  ]) {
    const r = t.riskOf({ requestKind: "command", prompt: p });
    assert.equal(r.level, "high", p);
    assert.notEqual(r.level, "low", p);
  }
  assert.equal(t.riskOf({ requestKind: "command", prompt: "git fetch origin" }).level, "low");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch --quiet" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch --follow-tags" }).level, "high");
});

test("riskOf: backslash before a delete refspec colon is high like :gone", () => {
  // PLUS_SPEC already allowed \\ before +. DEL_SPEC missed \\:gone / ''\\:gone /
  // \\:''gone (argv :gone). Literal :gone stays high.
  for (const p of [
    "git push origin \\:gone",
    "git push origin ''\\:gone",
    "git push origin \\:''gone",
    "git push origin :gone",
    "git push origin ':gone'",
    "git push origin $':gone'",
  ]) assert.equal(t.riskOf({ requestKind: "command", prompt: p }).level, "high", p);
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git push origin HEAD:feature" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git push origin HEAD:branch" }).level, "high");
});

test("riskOf: encoded fetch :main/:master is high; leading-colon fetch is not read-only", () => {
  // v1.4.22 fetch high arm :(main|master) and READ_ONLY [^\s:@]+: wanted a literal
  // colon, so $'\\x{3a}main' / $'\\72main' / $'\\472main' stayed low. Leading
  // :gone stayed inside READ_ONLY because the source class is non-empty.
  for (const p of [
    "git fetch origin $'\\x{3a}main'",
    "git fetch origin $'\\72main'",
    "git fetch origin $'\\472main'",
    "git fetch origin $'\\x{3a}refs/heads/main'",
    "git fetch origin :main",
    "git fetch origin :refs/heads/main",
    "git fetch origin :master",
  ]) {
    const r = t.riskOf({ requestKind: "command", prompt: p });
    assert.equal(r.level, "high", p);
    assert.notEqual(r.level, "low", p);
  }
  for (const p of [
    "git fetch origin :gone",
    "git fetch origin :feature",
    "git fetch origin $'\\x{3a}gone'",
    "git fetch origin $'\\472gone'",
  ]) assert.notEqual(t.riskOf({ requestKind: "command", prompt: p }).level, "low", p);
  assert.equal(t.riskOf({ requestKind: "command", prompt: "git fetch origin" }).level, "low");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch origin feature:feature" }).level, "low");
  assert.equal(t.riskOf({ requestKind: "command", prompt: "git fetch origin feature:feature" }).level, "normal");
  assert.equal(t.riskOf({ requestKind: "command", prompt: "git fetch git@github.com:foo/bar.git" }).level, "low");
  assert.equal(t.riskOf({ requestKind: "command", prompt: "git fetch https://example.com/repo.git" }).level, "low");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch --follow-tags" }).level, "high");
});

test("riskOf: /i qcls encodes the other case of class letters", () => {
  // git()/rm are /i, so [dmf] matches D/M and [rfd] matches R, but qcls only
  // encoded the written case. $'-\\104' / $'-\\x44' (argv -D) stayed normal.
  for (const p of [
    "git branch $'-\\104' gone",
    "git branch $'-\\x44' gone",
    "git branch $'-\\115' other",
    "git branch $'-\\x4d' other",
    "rm $'-\\122' dir",
    "rm $'-\\x52' dir",
    "git fetch $'-\\120'",
    "git branch -D gone",
    "git branch -M other",
    "rm -R dir",
    "git fetch -P",
    "git branch $'-\\144' gone",
    "git fetch $'-\\146' origin",
  ]) {
    const r = t.riskOf({ requestKind: "command", prompt: p });
    assert.equal(r.level, "high", p);
    assert.notEqual(r.level, "low", p);
  }
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git branch $'-\\143' dest" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git branch -c dest" }).level, "high");
  assert.equal(t.riskOf({ requestKind: "command", prompt: "git fetch origin" }).level, "low");
});

test("riskOf: brace expansion of flags and delete refspecs is high", () => {
  // bash expands {a,b} before argv. Contiguous flags split by braces
  // (--{force,} / {-rf,} / {:gone,}) scored low/normal while argv is dangerous.
  // {--force,} / {-f,} already contain the spelling; keep those high.
  for (const p of [
    "git fetch --{force,}",
    "git fetch --{prune,}",
    "git fetch --pr{une,}",
    "rm {-rf,} dir",
    "rm {-r,-f} dir",
    "git push origin {:gone,}",
    "git reset --{hard,}",
    "git branch {-D,} gone",
    "git pull --{force,}",
    "git fetch {--force,}",
    "rm {-f,} dir",
  ]) {
    const r = t.riskOf({ requestKind: "command", prompt: p });
    assert.equal(r.level, "high", p);
    assert.notEqual(r.level, "low", p);
  }
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch --{tags,}" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch '--{force,}'" }).level, "high");
  assert.equal(t.riskOf({ requestKind: "command", prompt: "git fetch origin" }).level, "low");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch --follow-tags" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch --quiet" }).level, "high");
});

test("riskOf: quote/escape/brace breaks after a fetch colon dest are high", () => {
  // v1.4.23 FETCH_HEAD qenc'd the colon, then matched refs/heads/ and main|master
  // as literal text. bash still joins :m''ain / :m\\ain / $':m'{ain,} / feature:m''ain
  // to argv :main (or feature:main). Same qflex joins as flags.
  for (const p of [
    "git fetch origin :m''ain",
    "git fetch origin :refs/heads/m''ain",
    "git fetch origin feature:m''ain",
    "git fetch origin :m\\ain",
    "git fetch origin $':m'{ain,}",
    "git fetch origin :main",
    "git fetch origin :refs/heads/main",
    "git fetch origin feature:main",
    "git fetch origin :master",
    "git fetch origin :refs/heads/master",
    "git fetch origin :re''fs/heads/main",
  ]) {
    const r = t.riskOf({ requestKind: "command", prompt: p });
    assert.equal(r.level, "high", p);
    assert.notEqual(r.level, "low", p);
  }
  assert.equal(t.riskOf({ requestKind: "command", prompt: "git fetch origin" }).level, "low");
  assert.equal(t.riskOf({ requestKind: "command", prompt: "git fetch git@github.com:foo/bar.git" }).level, "low");
  assert.equal(t.riskOf({ requestKind: "command", prompt: "git fetch https://example.com/repo.git" }).level, "low");
  assert.equal(t.riskOf({ requestKind: "command", prompt: "git fetch origin feature:feature" }).level, "normal");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch '--{force,}'" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch origin ':m{ain,}'" }).level, "high");
});

test("riskOf: quote/escape/brace breaks of a push dest main/master are high", () => {
  // v1.4.23 scored push with \\b(main|master)\\b, so m''ain / $'\\x6dain' /
  // HEAD:m''ain / m{''ain,} stayed normal while argv is main / HEAD:main.
  for (const p of [
    "git push origin m''ain",
    "git push origin $'\\x6dain'",
    "git push origin HEAD:m''ain",
    "git push origin m{''ain,}",
    "git push origin m\\ain",
    "git push origin main",
    "git push origin HEAD:main",
    "git push origin master",
    "git push origin HEAD:master",
    "git push origin 'main'",
    "git push origin $'main'",
  ]) {
    const r = t.riskOf({ requestKind: "command", prompt: p });
    assert.equal(r.level, "high", p);
    assert.notEqual(r.level, "low", p);
  }
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git push origin remain" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git push origin domain" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git push origin feature" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git push origin 'm{ain,}'" }).level, "high");
});

test("riskOf: encoded colon/slash joins on a push dest main/master are high", () => {
  // v1.4.24 push used (?<!\\w) before MAIN_DEST. A qenc of : or / ends on a
  // hex/octal digit, so $'\\x3amain' / $'\\x2fmain' scored normal while bash
  // argv is HEAD:main / refs/heads/main. FETCH_HEAD already consumes qhex(":")
  // and does not look behind; push now uses that colon join plus a slash join.
  // $'\\x{3a}main' / $'\\x{2f}main' ended on } and already stayed high.
  const { execFileSync } = require("child_process");
  const argvLast = (src) => execFileSync("bash", ["-c", 'n(){ printf %s "${@: -1}"; }; eval n ' + src], { encoding: "utf8" });
  for (const [p, argv] of [
    ["git push origin $'HEAD\\x3amain'", "HEAD:main"],
    ["git push origin HEAD$'\\x3amain'", "HEAD:main"],
    ["git push origin $'HEAD\\72main'", "HEAD:main"],
    ["git push origin HEAD$'\\72main'", "HEAD:main"],
    ["git push origin $'HEAD\\072main'", "HEAD:main"],
    ["git push origin $'HEAD\\u003amain'", "HEAD:main"],
    ["git push origin $'HEAD\\x3am''ain'", "HEAD:main"],
    ["git push origin $'HEAD\\x3a\\x6d\\x61\\x69\\x6e'", "HEAD:main"],
    ["git push origin feature$'\\x3amain'", "feature:main"],
    ["git push origin feature$'\\x3am''ain'", "feature:main"],
    ["git push origin $'feature\\x3amain'", "feature:main"],
    ["git push origin $'HEAD\\x3amaster'", "HEAD:master"],
    ["git push origin $'refs/heads\\x2fmain'", "refs/heads/main"],
    ["git push origin refs/heads$'\\x2fmain'", "refs/heads/main"],
    ["git push origin $'refs/heads\\57main'", "refs/heads/main"],
    ["git push origin refs/heads$'\\57main'", "refs/heads/main"],
    ["git push origin $'refs/heads\\057main'", "refs/heads/main"],
    ["git push origin $'refs/heads\\u002fmain'", "refs/heads/main"],
    ["git push origin $'refs\\x2f\\x68\\x65\\x61\\x64\\x73\\x2f\\x6d\\x61\\x69\\x6e'", "refs/heads/main"],
    ["git push origin $'\\x72\\x65\\x66\\x73\\x2f\\x68\\x65\\x61\\x64\\x73\\x2f\\x6d\\x61\\x69\\x6e'", "refs/heads/main"],
    ["git push origin $'HEAD\\x{3a}main'", "HEAD:main"],
    ["git push origin $'refs/heads\\x{2f}main'", "refs/heads/main"],
    ["git push origin HEAD:main", "HEAD:main"],
    ["git push origin refs/heads/main", "refs/heads/main"],
  ]) {
    assert.equal(argvLast(p), argv, p);
    const r = t.riskOf({ requestKind: "command", prompt: p });
    assert.equal(r.level, "high", p);
    assert.notEqual(r.level, "low", p);
  }
  assert.equal(t.riskOf({ requestKind: "command", prompt: "git fetch origin" }).level, "low");
  assert.equal(t.riskOf({ requestKind: "command", prompt: "git fetch git@github.com:foo/bar.git" }).level, "low");
  assert.equal(t.riskOf({ requestKind: "command", prompt: "git fetch https://example.com/repo.git" }).level, "low");
  assert.equal(t.riskOf({ requestKind: "command", prompt: "git fetch origin feature:feature" }).level, "normal");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git push origin remain" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git push origin domain" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git push origin mainline" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git push origin mastery" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git fetch origin ':m{ain,}'" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git push origin 'm{ain,}'" }).level, "high");
});

test("riskOf: encoded colon after dest main/master is a word boundary", () => {
  // v1.4.24 MAIN_DEST used qflag's trailing lookahead, which treats \\x / octal
  // / \\u as more of the word. $'\\x3afeature' after main scored normal (argv
  // main:feature) and :main$'\\x3a'feature dropped from high. Literal
  // main\\:feature already stayed high. Encoded colon before a fetch dest
  // (feature$'\\x3amain') already stayed high.
  const { execFileSync } = require("child_process");
  const argvLast = (src) => execFileSync("bash", ["-c", 'n(){ printf %s "${@: -1}"; }; eval n ' + src], { encoding: "utf8" });
  for (const [p, argv] of [
    ["git push origin $'main\\x3afeature'", "main:feature"],
    ["git push origin main$'\\x3a'feature", "main:feature"],
    ["git push origin $'main\\72feature'", "main:feature"],
    ["git push origin main$'\\72'feature", "main:feature"],
    ["git push origin $'main\\x{3a}feature'", "main:feature"],
    ["git push origin $'master\\x3afeature'", "master:feature"],
    ["git fetch origin :main$'\\x3a'feature", ":main:feature"],
    ["git fetch origin $'\\x3amain\\x3afeature'", ":main:feature"],
    ["git fetch origin feature$'\\x3amain'", "feature:main"],
    ["git push origin main\\:feature", "main:feature"],
  ]) {
    assert.equal(argvLast(p), argv, p);
    const r = t.riskOf({ requestKind: "command", prompt: p });
    assert.equal(r.level, "high", p);
    assert.notEqual(r.level, "low", p);
  }
  assert.equal(t.riskOf({ requestKind: "command", prompt: "git fetch origin" }).level, "low");
  assert.equal(t.riskOf({ requestKind: "command", prompt: "git fetch origin feature:feature" }).level, "normal");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git push origin remain" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git push origin domain" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git push origin mainline" }).level, "high");
  assert.notEqual(t.riskOf({ requestKind: "command", prompt: "git push origin mastery" }).level, "high");
});

test("findThread: archivedThreads are searched like search/preview-finish", async () => {
  const fs = require("fs"), os = require("os"), http = require("http"), { execFile } = require("child_process");
  const src = fs.readFileSync(path.join(__dirname, "..", "tools", "t3ctl"), "utf8");
  assert.match(src, /pickThread\(\[\.\.\.s\.threads, \.\.\.\(s\.archivedThreads \|\| \[\]\)\], q\)/);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "t3ctl-find-"));
  fs.copyFileSync(path.join(__dirname, "..", "tools", "t3ctl"), path.join(tmp, "t3ctl"));
  fs.writeFileSync(path.join(tmp, "token"), "test-fixture");
  const threads = [{ id: "live-thread-01", title: "Live One", status: "idle" }];
  const archivedThreads = [{ id: "arch-thread-99", title: "Old archived", status: "completed" }];
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url);
    if (u === "/api/orchestration/shell") return res.end(JSON.stringify({ projects: [], threads, archivedThreads }));
    const known = [...threads, ...archivedThreads];
    const hit = known.find((x) => u === "/api/orchestration/threads/" + x.id);
    if (hit) return res.end(JSON.stringify({ projection: { thread: hit, turnItems: [], runs: [], runtimeRequests: [] } }));
    res.statusCode = 404; res.end("{}");
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  fs.mkdirSync(path.join(tmp, "t3")); fs.writeFileSync(path.join(tmp, "t3", "server-runtime.json"), JSON.stringify({ host: "127.0.0.1", port: srv.address().port }));
  const run = (cmd, q) => new Promise((r) => execFile(process.execPath, [path.join(tmp, "t3ctl"), cmd, "--thread", q],
    { env: { ...process.env, T3_HOME: path.join(tmp, "t3") } }, (err, out, errOut) => r({ code: err ? err.code : 0, out: out + errOut })));
  try {
    let r = await run("read", "arch-thread-99"); assert.equal(r.code, 0, r.out); assert.match(r.out, /arch-thread-99/);
    r = await run("read", "Old archived"); assert.equal(r.code, 0, r.out); assert.match(r.out, /Old archived/);
    r = await run("pending", "arch-thread-99"); assert.equal(r.code, 0, r.out);
    r = await run("read", "no-such-thread-xx"); assert.equal(r.code, 1); assert.match(r.out, /NOT_FOUND/);
  } finally { srv.close(); }
});
