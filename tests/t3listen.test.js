// Unit tests for t3listen's pure helpers. Run: node --test tests/*.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const l = require(path.join(__dirname, "..", "tools", "t3listen"));

test("pickThread: same rules as t3ctl (8+ character prefix, exact title, AMBIGUOUS, NOT_FOUND)", () => {
  const t3ctl = require(path.join(__dirname, "..", "tools", "t3ctl"));
  const ts = [{ id: "aaaa1111-0000", title: "Snig PR review", updatedAt: "2026-01-01T00:00:00Z" }, { id: "aaaa2222-0000", title: "Snig fixes", updatedAt: "2026-01-03T00:00:00Z" },
    { id: "cccc3333-0000", title: "Other", updatedAt: "2026-01-02T00:00:00Z" }, { id: "dddd4444-0000", title: "other notes", updatedAt: "2026-01-02T00:00:00Z" }];
  assert.equal(l.pickThread(ts, "aaaa1111-0000").id, "aaaa1111-0000");
  assert.equal(l.pickThread(ts, "cccc3333").id, "cccc3333-0000");
  assert.equal(l.pickThread(ts, "pr review").id, "aaaa1111-0000");
  assert.equal(l.pickThread(ts, "OTHER").id, "cccc3333-0000"); // exact title beats the substring match on "other notes"
  assert.throws(() => l.pickThread(ts, "snig"), /^Error: AMBIGUOUS: 2 threads/);
  assert.throws(() => l.pickThread(ts, "aaaa"), /^Error: (AMBIGUOUS|NOT_FOUND)/);
  assert.throws(() => l.pickThread(ts, "ccc"), /NOT_FOUND: .*8 or more characters/);
  assert.throws(() => l.pickThread(ts, "nothing like it"), /^Error: NOT_FOUND/);
  for (const q of ["aaaa1111-0000", "cccc3333", "pr review", "OTHER", "snig", "aaaa", "ccc", "nothing like it"]) {
    const run = (f) => { try { return JSON.stringify(f(ts, q)); } catch (e) { return e.message; } };
    assert.equal(run(l.pickThread), run(t3ctl.pickThread), `t3listen and t3ctl disagree on "${q}"`);
  }
  // newest updatedAt is listed first; NOT_FOUND names t3q.py. Both come from the shared helper.
  assert.throws(() => l.pickThread(ts, "snig"), /^Error: AMBIGUOUS: 2 threads match "snig"[\s\S]*aaaa2222-0000  Snig fixes\n {2}aaaa1111-0000  Snig PR review/);
  assert.throws(() => l.pickThread(ts, "nothing like it"), /Find it with: T3_Q='<words>' python3 t3q.py thread$/);
});
test("cleanEvent: questions, option labels, approval prompt, titles and answers are redacted; ids are kept", () => {
  const os = require("os"), home = os.homedir();
  const e = { event: "request.opened", threadId: "t-1", requestId: "r-1", title: `fix ${home}/x`, questions: [{ id: "q1", question: "use key " + "sk_" + "live_abcdefghijklmnop1234?", header: "token: abcdefghijkl",
    options: [{ label: "ghp_" + "a".repeat(30), description: `in ${home}/proj`, value: "whsec_" + "b".repeat(24) }] }], answers: { q1: ["sk-ant-" + "c".repeat(24)] },
    approval: { requestKind: "command", prompt: `cat ${home}/.ssh/id && echo glpat-${"d".repeat(20)}`, options: [{ decision: "accept", label: "xo" + "xb-1234567890-abc" }] } };
  l.cleanEvent(e); const s = JSON.stringify(e);
  for (const bad of [home + "/", "sk_live_", "ghp_", "whsec_", "sk-ant-", "glpat-", "xoxb-", "abcdefghijkl"]) assert.ok(!s.includes(bad), `${bad} leaked: ${s}`);
  assert.equal(e.threadId, "t-1"); assert.equal(e.requestId, "r-1"); assert.equal(e.questions[0].id, "q1");
  assert.match(e.approval.prompt, /~\/\.ssh\/id/);
  assert.match(l.summary({ ...e, machine: "m", questions: undefined }), /\[redacted\]/);
});
test("localTime: names the zone (IST, not GMT+5:30)", () => {
  const { execFileSync } = require("child_process");
  const out = execFileSync(process.execPath, ["-e", `console.log(require(${JSON.stringify(path.join(__dirname, "..", "tools", "t3listen"))}).localTime("2026-01-01T12:00:00Z"))`], { env: { ...process.env, TZ: "Asia/Kolkata" } }).toString().trim();
  assert.match(out, /IST$/);
});

test("approvalsLine names which switch turned approvals on", () => {
  const { approvalsLine } = l;
  assert.equal(approvalsLine(false, false), "off");
  assert.equal(approvalsLine(true, false), "on (listen.json)");
  assert.equal(approvalsLine(false, true), "on (installed with --approvals)");
  assert.equal(approvalsLine(true, true), "on (listen.json and installed with --approvals)");
});

test("staleMinutes: missing means the documented 1440; 0 stays off", () => {
  for (const v of [undefined, null, "", "abc", -5]) assert.equal(l.staleMinutes(v), 1440, String(v));
  assert.equal(l.staleMinutes(0), 0); assert.equal(l.staleMinutes("30"), 30);
});
test("redaction catches github_pat_, npm_, xapp- and glpat- keys", () => {
  const keys = ["github_pat_" + "A1".repeat(15), "npm_" + "a1B2".repeat(9), "xapp-" + "1-A0".repeat(5), "glpat-" + "x_Y-".repeat(6), "sk-" + "a".repeat(24), "token = abcdefghij"];
  for (const k of keys) assert.equal(`see ${k} here`.replace(l.RED, "[redacted]"), "see [redacted] here", k);
});
test("log lines never print a raw thread title (titles go through clean)", () => {
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "tools", "t3listen"), "utf8");
  const raw = src.split("\n").filter((l) => /\blog\(/.test(l) && /\$\{t\.title\}/.test(l));
  assert.deepEqual(raw, []);
});

test("reportEnd redacts the event before it is first saved to listen-state.json", () => {
  const src = require("fs").readFileSync(path.join(__dirname, "..", "tools", "t3listen"), "utf8");
  const body = src.slice(src.indexOf("async function reportEnd"), src.indexOf("\n}\n", src.indexOf("async function reportEnd")));
  assert.ok(body.includes("cleanEvent(e)"), "reportEnd cleans the event");
  assert.ok(body.indexOf("cleanEvent(e)") < body.indexOf("saveState()"), "cleanEvent runs before the first saveState");
});
test("restart catch-up: any thread in the window (busy too), not only END[t.status]; buildEnd still skips", () => {
  const src = require("fs").readFileSync(path.join(__dirname, "..", "tools", "t3listen"), "utf8");
  const start = src.indexOf("const since = S.lastAlive");
  const end = src.indexOf("afterSnapshotListen(", start);
  const block = src.slice(start, end);
  assert.ok(block.includes("catchUpThreads("), block);
  assert.ok(block.includes("reportEnd(ep, t, null, { since })"), block);
  assert.ok(!block.includes("END[t.status]"), block);
  assert.ok(!block.includes("!isBusy(t)"), block); // failed ends must still report when the thread is busy
  assert.ok(!/\b36e5\b/.test(block) && !block.includes("3600000"), block); // no hour cap; buildEnd skips completedAt < since
  assert.ok(src.includes('skip: "ended before the listener\'s last run"'));
  assert.ok(src.includes("sub-task thread that didn't fail"));
  assert.ok(src.includes("thread is going on with its next queued message"));
  assert.ok(src.includes("listening = false"), "socket close freezes lastAlive");
  assert.ok(src.includes("afterSnapshotListen("), "snapshot completion goes through afterSnapshotListen");
});

test("endedAt: missing completedAt uses now, not Date.parse(0)", () => {
  const now = Date.parse("2026-10-25T12:00:00Z");
  assert.equal(l.endedAt({ completedAt: "2026-10-25T11:00:00Z" }, now), Date.parse("2026-10-25T11:00:00Z"));
  assert.equal(l.endedAt({}, now), now);
  assert.equal(l.endedAt({ completedAt: "" }, now), now);
  assert.equal(l.endedAt({ completedAt: "not-a-date" }, now), now);
  assert.ok(l.endedAt({}, now) !== Date.parse(0));
  assert.ok(l.endedAt({}, now) > 1e12); // a real "now", not epoch / year-2000 Date.parse(0)
});

test("tickLastAlive: freeze lastAlive while the socket is down", () => {
  const last = Date.parse("2026-10-25T10:00:00Z"), now = Date.parse("2026-10-25T12:00:00Z");
  assert.equal(l.tickLastAlive(true, last, now), now);
  assert.equal(l.tickLastAlive(false, last, now), last);
  assert.equal(l.tickLastAlive(false, undefined, now), undefined);
});

test("afterSnapshotListen: a close wins over an in-flight snapshot completion", async () => {
  const st = { listening: false, lastAlive: 1000, liveGen: 1 };
  const snapshotGen = st.liveGen;
  let finish;
  const inflight = new Promise((r) => { finish = r; }).then(() => {
    const next = l.afterSnapshotListen({
      socketOpen: false, gen: snapshotGen, liveGen: st.liveGen, lastAlive: st.lastAlive, now: 9999,
    });
    st.listening = next.listening;
    st.lastAlive = next.lastAlive;
  });
  st.listening = false; // onclose first
  st.liveGen += 1;
  finish();
  await inflight;
  assert.equal(st.listening, false);
  assert.equal(st.lastAlive, 1000);
});

test("afterSnapshotListen: still-open same generation advances lastAlive; gen mismatch does not", () => {
  assert.deepEqual(l.afterSnapshotListen({ socketOpen: true, gen: 3, liveGen: 3, lastAlive: 1000, now: 2000 }),
    { listening: true, lastAlive: 2000 });
  assert.deepEqual(l.afterSnapshotListen({ socketOpen: true, gen: 1, liveGen: 2, lastAlive: 1000, now: 2000 }),
    { listening: false, lastAlive: 1000 });
  assert.deepEqual(l.afterSnapshotListen({ socketOpen: false, gen: 1, liveGen: 1, lastAlive: 1000, now: 2000 }),
    { listening: false, lastAlive: 1000 });
});

test("usageLimitFields: busy failed run still carries usageLimit / autoResumeSet / resumeAt", () => {
  const reset = "2026-01-01T05:00:00Z";
  const ended = { id: "r1", status: "failed", lastErrorClass: "usage_limit", usageLimitResetAt: reset };
  const busy = { id: "t", status: "running", activeRunId: "r2", latestRunId: "r2" };
  const a = l.usageLimitFields(busy, ended);
  assert.equal(a.usageLimit, true);
  assert.equal(a.autoResumeSet, false);
  assert.equal(a.resumeAt, reset);
  assert.equal(a.autoResumeNote, "thread is already busy");
  const armed = l.usageLimitFields({ ...busy, limitRecovery: { runId: "r1", resetAt: reset, autoResume: true } }, ended);
  assert.equal(armed.usageLimit, true);
  assert.equal(armed.autoResumeSet, true);
  assert.equal(armed.resumeAt, reset);
  const fromRun = l.usageLimitFields({ id: "t", status: "running", activeRunId: "r2" }, { id: "r1", status: "failed", lastErrorClass: "usage_limit", usageLimitResetAt: reset });
  assert.equal(fromRun.usageLimit, true);
  assert.equal(fromRun.resumeAt, reset);
  assert.equal(l.usageLimitFields({ id: "t", status: "failed", lastErrorClass: "other" }, { id: "r", status: "failed" }), null);
});

test("usageLimitFields: ended-run lastErrorClass / reset; leftover shell + server_error is not usage_limit", () => {
  const reset = "2026-01-01T05:00:00Z";
  const ended = { id: "r1", status: "failed", lastErrorClass: "usage_limit", usageLimitResetAt: reset };
  const moved = { id: "t", status: "running", activeRunId: "r2", latestRunId: "r2", lastErrorClass: "server_error" };
  const a = l.usageLimitFields(moved, ended);
  assert.equal(a.usageLimit, true);
  assert.equal(a.resumeAt, reset);
  assert.equal(a.autoResumeSet, false);
  const leftover = { id: "t", status: "failed", lastErrorClass: "server_error", usageLimitResetAt: reset, latestRunId: "r1" };
  assert.equal(l.usageLimitFields(leftover, { id: "r1", status: "failed", lastErrorClass: "server_error" }), null);
  assert.equal(l.usageLimitFields(leftover, { id: "r1", status: "failed" }), null);
});

test("usageLimitFields: autoResumeSet matches the ended run id, not a later latestRunId record", () => {
  const reset = "2026-01-01T05:00:00Z";
  const ended = { id: "r1", status: "failed", lastErrorClass: "usage_limit", usageLimitResetAt: reset };
  const later = l.usageLimitFields({
    id: "t", status: "running", activeRunId: "r2", latestRunId: "r2",
    limitRecovery: { runId: "r2", resetAt: reset, autoResume: true },
  }, ended);
  assert.equal(later.usageLimit, true);
  assert.equal(later.autoResumeSet, false);
  const same = l.usageLimitFields({
    id: "t", status: "failed", latestRunId: "r1",
    limitRecovery: { runId: "r1", resetAt: reset, autoResume: true },
  }, ended);
  assert.equal(same.autoResumeSet, true);
});

test("usageLimitFields: server_error text mentioning usage limit is not a usage limit", () => {
  const reset = "2026-01-01T05:00:00Z";
  const run = { id: "r1", status: "failed", lastErrorClass: "server_error",
    lastError: { message: "upstream said usage limit" }, usageLimitResetAt: reset };
  const t = { id: "t", status: "failed", latestRunId: "r1", lastErrorClass: "server_error",
    lastError: { message: "upstream said usage limit" }, usageLimitResetAt: reset };
  assert.equal(l.usageLimitFields(t, run), null);
  assert.equal(l.usageLimitFields(t, { ...run, error: "upstream said usage limit" }), null);
  const noClass = { id: "r2", status: "failed", lastError: { message: "hit a usage limit" }, usageLimitResetAt: reset };
  assert.equal(l.usageLimitFields({ id: "t", status: "failed", latestRunId: "r2" }, noClass).usageLimit, true);
});

test("canArmResume: only the latest ended run; shellReadyToArm retries while busy", () => {
  const ended = { id: "r1", status: "failed", lastErrorClass: "usage_limit", usageLimitResetAt: "2026-01-01T05:00:00Z" };
  const olderFailed = { id: "t", status: "failed", latestRunId: "r2", lastErrorClass: "server_error" };
  assert.equal(l.usageLimitFields(olderFailed, ended).usageLimit, true);
  assert.equal(l.canArmResume(olderFailed, ended), false);
  assert.equal(l.canArmResume({ id: "t", status: "failed", latestRunId: "r1" }, ended), true);
  assert.equal(l.canArmResume({ id: "t", status: "failed" }, ended), true);
  assert.equal(l.shellReadyToArm({ id: "t", status: "running", activeRunId: "r2", latestRunId: "r2" }), false);
  assert.equal(l.shellReadyToArm({ id: "t", status: "failed", latestRunId: "r1" }), true);
  assert.equal(l.shellReadyToArm(null), false);
  assert.equal(l.canArmResume({ id: "t", status: "running", activeRunId: "r2", latestRunId: "r2" }, ended), false);
  const src = require("fs").readFileSync(path.join(__dirname, "..", "tools", "t3listen"), "utf8");
  const start = src.indexOf("async function armResume");
  const end = src.indexOf("\n}\n", start);
  const body = src.slice(start, end);
  assert.ok(body.includes("!shellReadyToArm(t)"), body);
  assert.ok(body.includes("canArmResume(t, run)"), body);
  assert.ok(!/for \(let i = 0; i < 3 && !t;/.test(body), body);
});

test("catchUpThreads: includes a busy thread so a failed downtime end is still seen", () => {
  const since = Date.parse("2026-10-25T10:00:00Z");
  const idle = { id: "a", status: "idle", updatedAt: "2026-10-25T11:00:00Z" };
  const busy = { id: "b", status: "running", activeRunId: "r2", updatedAt: "2026-10-25T11:30:00Z" };
  const old = { id: "c", status: "idle", updatedAt: "2026-10-25T09:00:00Z" };
  const got = l.catchUpThreads([idle, busy, old], since).map((t) => t.id);
  assert.deepEqual(got, ["a", "b"]);
});

test("restart catch-up: reportEnd with since and no run id reports every ended run, not only ended.at(-1)", () => {
  const src = require("fs").readFileSync(path.join(__dirname, "..", "tools", "t3listen"), "utf8");
  const start = src.indexOf("async function reportEnd");
  const end = src.indexOf("\n}\n", start);
  const body = src.slice(start, end);
  assert.ok(body.includes("!runId && opts.since"), body);
  assert.ok(body.includes("for (const run of ended) await reportEnd(ep, t, run.id, opts)"), body);
  assert.ok(!/ended\.at\(-1\)/.test(body), body);
});

test("idLike: a full id or an 8+ character prefix, never a title with spaces", () => {
  for (const q of ["abcdefgh", "thread-0b6e2f1c-full-id"]) assert.equal(l.idLike(q), true, q);
  for (const q of ["abcdefg", "fix the login bug", "a/b/c/d/e/f"]) assert.equal(l.idLike(q), false, q);
});
test("idLike: no whitespace, length >= 8, colons allowed (thread:project:…, thread:delegated-task:…)", () => {
  for (const q of ["thread:project:abc12345", "thread:delegated-task:deadbeef", "thread:p"]) assert.equal(l.idLike(q), true, q);
  for (const q of ["thread:", "a:b:c", "fix the login"]) assert.equal(l.idLike(q), false, q);
});

test("systemdUnit: quotes and escapes paths and env values so spaces, quotes, % and $ survive", () => {
  const u = l.systemdUnit("/opt/my node/node", ["/srv/a b/100%/t3listen", "run"], "/srv/a b/100%", { T3_HOME: '/x "y" $HOME\\z' });
  assert.match(u, /^ExecStart="\/opt\/my node\/node" "\/srv\/a b\/100%%\/t3listen" "run"$/m);
  assert.match(u, /^WorkingDirectory=\/srv\/a b\/100%%$/m);
  assert.ok(u.split("\n").includes('Environment="T3_HOME=/x \\"y\\" $HOME\\\\z"'), u);
  assert.ok(l.systemdUnit("/n", ["/a$b"], "/d").includes('ExecStart="/n" "/a$$b"'));
});

test("preview-finish: NOT_FOUND in the shell list still reads an id-like query from T3; AMBIGUOUS and titles still stop", async () => {
  const fs = require("fs"), os = require("os"), http = require("http"), { execFile } = require("child_process");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "t3listen-preview-"));
  fs.copyFileSync(path.join(__dirname, "..", "tools", "t3listen"), path.join(tmp, "t3listen"));
  fs.copyFileSync(path.join(__dirname, "..", "tools", "thread-match.js"), path.join(tmp, "thread-match.js"));
  fs.writeFileSync(path.join(tmp, "token"), "test-fixture");
  const threads = [{ id: "abcdefgh-1", title: "One" }, { id: "abcdefgh-2", title: "Two" }];
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url);
    if (u === "/api/orchestration/shell") return res.end(JSON.stringify({ projects: [], threads }));
    if (u === "/api/orchestration/threads/hidden-thread-42") return res.end(JSON.stringify({ projection: { thread: { id: "hidden-thread-42", title: "Hidden" }, runs: [] } }));
    res.statusCode = 404; res.end("{}");
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  fs.mkdirSync(path.join(tmp, "t3")); fs.writeFileSync(path.join(tmp, "t3", "server-runtime.json"), JSON.stringify({ host: "127.0.0.1", port: srv.address().port }));
  const run = (q) => new Promise((r) => execFile(process.execPath, [path.join(tmp, "t3listen"), "preview-finish", "--dry-run", "--thread", q],
    { env: { ...process.env, T3_HOME: path.join(tmp, "t3") } }, (err, out, errOut) => r({ code: err ? err.code : 0, out: out + errOut })));
  try {
    let r = await run("hidden-thread-42"); assert.equal(r.code, 0, r.out); assert.match(r.out, /would not report: no run/);
    r = await new Promise((res) => execFile(process.execPath, [path.join(tmp, "t3listen"), "preview-finish", "--dry-run", "--thread=hidden-thread-42"], { env: { ...process.env, T3_HOME: path.join(tmp, "t3") } },
      (err, out, errOut) => res({ code: err ? err.code : 0, out: out + errOut }))); assert.equal(r.code, 0, r.out); assert.match(r.out, /would not report: no run/); // --key=value works too
    r = await run("abcdefgh"); assert.equal(r.code, 1); assert.match(r.out, /AMBIGUOUS/);
    r = await run("some missing title"); assert.equal(r.code, 1); assert.match(r.out, /NOT_FOUND/);
    r = await run("missing-id-999"); assert.equal(r.code, 1); assert.match(r.out, /NOT_FOUND/);
  } finally { srv.close(); }
});

test("preview-finish: archivedThreads are searched; colon ids are id-like; AMBIGUOUS still stops", async () => {
  const fs = require("fs"), os = require("os"), http = require("http"), { execFile } = require("child_process");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "t3listen-preview-arch-"));
  fs.copyFileSync(path.join(__dirname, "..", "tools", "t3listen"), path.join(tmp, "t3listen"));
  fs.copyFileSync(path.join(__dirname, "..", "tools", "thread-match.js"), path.join(tmp, "thread-match.js"));
  fs.writeFileSync(path.join(tmp, "token"), "test-fixture");
  const threads = [{ id: "abcdefgh-1", title: "Live One" }, { id: "abcdefgh-2", title: "Live Two" }];
  const archivedThreads = [{ id: "arch-thread-99", title: "Old archived" }];
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url);
    if (u === "/api/orchestration/shell") return res.end(JSON.stringify({ projects: [], threads, archivedThreads }));
    const known = [...threads, ...archivedThreads, { id: "thread:project:abc12345", title: "By id" }, { id: "thread:delegated-task:deadbeef", title: "Delegated" }];
    const hit = known.find((t) => u === "/api/orchestration/threads/" + t.id);
    if (hit) return res.end(JSON.stringify({ projection: { thread: hit, runs: [] } }));
    res.statusCode = 404; res.end("{}");
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  fs.mkdirSync(path.join(tmp, "t3")); fs.writeFileSync(path.join(tmp, "t3", "server-runtime.json"), JSON.stringify({ host: "127.0.0.1", port: srv.address().port }));
  const run = (q) => new Promise((r) => execFile(process.execPath, [path.join(tmp, "t3listen"), "preview-finish", "--dry-run", "--thread", q],
    { env: { ...process.env, T3_HOME: path.join(tmp, "t3") } }, (err, out, errOut) => r({ code: err ? err.code : 0, out: out + errOut })));
  try {
    let r = await run("Old archived"); assert.equal(r.code, 0, r.out); assert.match(r.out, /would not report: no run/);
    r = await run("thread:project:abc12345"); assert.equal(r.code, 0, r.out); assert.match(r.out, /would not report: no run/);
    r = await run("thread:delegated-task:deadbeef"); assert.equal(r.code, 0, r.out); assert.match(r.out, /would not report: no run/);
    r = await run("Live One"); assert.equal(r.code, 0, r.out);
    r = await run("abcdefgh"); assert.equal(r.code, 1); assert.match(r.out, /AMBIGUOUS/);
  } finally { srv.close(); }
});

test("preview-finish: usage-limit fields come from the ended run; armResume is not called", async () => {
  const fs = require("fs"), os = require("os"), http = require("http"), { execFile } = require("child_process");
  const src = fs.readFileSync(path.join(__dirname, "..", "tools", "t3listen"), "utf8");
  const start = src.indexOf("async function previewFinish");
  const end = src.indexOf("\n}", start);
  const body = src.slice(start, end);
  assert.ok(body.includes("usageLimitFields("), body);
  assert.ok(!body.includes("armResume("), body);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "t3listen-preview-limit-"));
  fs.copyFileSync(path.join(__dirname, "..", "tools", "t3listen"), path.join(tmp, "t3listen"));
  fs.copyFileSync(path.join(__dirname, "..", "tools", "thread-match.js"), path.join(tmp, "thread-match.js"));
  fs.writeFileSync(path.join(tmp, "token"), "test-fixture");
  const reset = "2026-01-01T05:00:00Z";
  const thread = { id: "limit-thread-01", title: "Limited", status: "running", activeRunId: "r2", latestRunId: "r2" };
  const ended = { id: "r1", status: "failed", startedAt: "2026-01-01T04:00:00Z", completedAt: "2026-01-01T04:05:00Z",
    lastErrorClass: "usage_limit", usageLimitResetAt: reset };
  const hits = [];
  const srv = http.createServer((req, res) => {
    hits.push(req.method + " " + decodeURIComponent(req.url));
    const u = decodeURIComponent(req.url);
    if (u === "/api/orchestration/shell") return res.end(JSON.stringify({ projects: [], threads: [thread] }));
    if (u === "/api/orchestration/threads/" + thread.id) {
      return res.end(JSON.stringify({ projection: { thread, turnItems: [], runs: [ended] } }));
    }
    res.statusCode = 404; res.end("{}");
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  fs.mkdirSync(path.join(tmp, "t3")); fs.writeFileSync(path.join(tmp, "t3", "server-runtime.json"), JSON.stringify({ host: "127.0.0.1", port: srv.address().port }));
  const r = await new Promise((done) => execFile(process.execPath, [path.join(tmp, "t3listen"), "preview-finish", "--dry-run", "--thread", thread.id],
    { env: { ...process.env, T3_HOME: path.join(tmp, "t3") } }, (err, out, errOut) => done({ code: err ? err.code : 0, out: out + errOut })));
  srv.close();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /PREVIEW payload/);
  const json = r.out.slice(r.out.indexOf("{"));
  const payload = JSON.parse(json);
  assert.equal(payload.usageLimit, true);
  assert.equal(payload.resumeAt, reset);
  assert.equal(payload.autoResumeSet, false);
  assert.ok(!hits.some((h) => /dispatch|ws/i.test(h)), hits.join("\n"));
});

test("retry queue: when it is full, events are saved in state and come back as room frees up, not left until a restart", () => {
  const S = { sent: { "req-a": { threadId: "t1", delivered: false }, "req-b": { threadId: "t1", closing: true } }, finished: { "run-1": { threadId: "t2", at: 1 } } };
  const full = Array.from({ length: l.MAX_RETRY_QUEUE }, (_, i) => ({ e: { event: "thread.finished", runId: `old-${i}` }, rounds: 1, since: 0 }));
  const opened = { e: { event: "request.opened", requestId: "req-a" }, rounds: 0, since: 0 };
  const closedA = { e: { event: "request.resolved", requestId: "req-a" }, rounds: 0, since: 0 };
  const resolved = { e: { event: "request.resolved", requestId: "req-b" }, rounds: 0, since: 0 };
  const finished = { e: { event: "thread.finished", runId: "run-1" }, rounds: 7, since: 4242 };
  const unknown = { e: { event: "thread.finished", runId: "run-unknown" }, rounds: 0, since: 0 };
  for (const item of [opened, closedA, resolved, finished]) assert.equal(l.keepForRetry(full, S, item), "parked");
  assert.equal(l.keepForRetry(full, S, unknown), "dropped");
  assert.equal(full.length, l.MAX_RETRY_QUEUE);
  assert.deepEqual(Object.keys(S.sent["req-a"].parked).sort(), ["request.opened", "request.resolved"], "an opened and a resolved event of one request are both kept");
  const q = full.slice(0, l.MAX_RETRY_QUEUE - 3);
  assert.equal(l.refillFromState(q, S, 123), 3);
  assert.equal(q.length, l.MAX_RETRY_QUEUE);
  assert.equal(l.refillFromState(q, S, 124), 0, "a full queue takes nothing more");
  const rest = [];
  assert.equal(l.refillFromState(rest, S, 125), 1);
  assert.deepEqual([...q.slice(-3), ...rest].map((x) => `${x.e.requestId || x.e.runId} ${x.e.event}`).sort(),
    ["req-a request.opened", "req-a request.resolved", "req-b request.resolved", "run-1 thread.finished"]);
  const back = [...q.slice(-3), ...rest].find((x) => x.e.runId === "run-1");
  assert.deepEqual([back.rounds, back.since], [7, 4242], "a saved event keeps its retry count and start time, so the 24h and 10-try limits still hold");
  assert.equal(l.refillFromState([], S, 126), 0, "each saved event is queued once");
  assert.ok([S.sent["req-a"], S.sent["req-b"], S.finished["run-1"]].every((s) => !s.parked));
  assert.equal(l.keepForRetry([], S, opened), "queued");
});
test("redaction: quoted passwords with spaces and Bearer/Basic credentials are hidden; ordinary words are not", () => {
  for (const s of ['password = "correct horse battery staple"', 'password="abcd\\"efghijkl"', "Authorization: Bearer abcdefghijklmnopqrstuvwxyz", "Authorization: Basic dXNlcjpwYXNz", "api_key='two words here'", "passwd: 'hunter2 hunter2'", "Authorization: Bearer abcDEF1234567890xyz", "curl -H 'Authorization: Basic dXNlcjpwYXNzMTIzNDU2'", "passwords: hunter2hunter2", "tokens = abcdefghijkl",
    '{"password": "correct horse battery staple"}', '{"api_key":"abcdefghijklmnopQRST"}', 'password: "say \\"hunter2\\" please"', "password: hunter2",
    "Bearer abcdefghijklmnop", "secret_key=supersecretvalue", "client_secret: 'abc def ghi'"]) {
    const out = l.clean(s);
    assert.match(out, /\[redacted\]/, s);
    assert.doesNotMatch(out, /horse|efghijkl|two words|hunter2|abcDEF1234567890xyz|abcdefghijkl|dXNlcjpwYXNz|QRST|supersecret|def ghi/, s);
  }
  for (const s of ["we use basic authentication here", "Bearer tokens are fine to mention", "a token: short", "Authorization: required for this endpoint", "the Authorization header is missing",
    "topsecret: value12345", "basic 0123456789abcdef is the sample", "the bearer 123456789012345 is late"]) assert.equal(l.clean(s), s);
});
test("redaction: export.js, survey.js and t3listen use the same pattern", () => {
  const fs = require("fs");
  const red = (f) => fs.readFileSync(path.join(__dirname, "..", "tools", f), "utf8").match(/const RED ?= ?new RegExp\((.*)\);/)[1];
  assert.equal(red("export.js"), red("t3listen"));
  assert.equal(red("survey.js"), red("t3listen"));
});

test("preview-finish: a thread only in T3's archived list is found by its title", async () => {
  const fs = require("fs"), os = require("os"), http = require("http"), crypto = require("crypto"), { execFile } = require("child_process");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "t3listen-preview-archived-"));
  fs.copyFileSync(path.join(__dirname, "..", "tools", "t3listen"), path.join(tmp, "t3listen"));
  fs.copyFileSync(path.join(__dirname, "..", "tools", "thread-match.js"), path.join(tmp, "thread-match.js"));
  fs.writeFileSync(path.join(tmp, "token"), "test-fixture");
  const archived = { id: "arch-only-thread-42", title: "Shipped last week" };
  const asked = [];
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url);
    if (u === "/api/orchestration/shell") return res.end(JSON.stringify({ projects: [], threads: [{ id: "live-thread-001", title: "Live" }], archivedThreads: [] }));
    if (u === "/api/orchestration/threads/" + archived.id) return res.end(JSON.stringify({ projection: { thread: archived, runs: [] } }));
    res.statusCode = 404; res.end("{}");
  });
  srv.on("upgrade", (req, sock) => {
    const accept = crypto.createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    sock.on("data", (d) => {
      if ((d[0] & 15) === 8) return sock.end();
      if ((d[0] & 15) !== 1) return;
      let len = d[1] & 127, off = 2; if (len === 126) { len = d.readUInt16BE(2); off = 4; }
      const mask = d.subarray(off, off + 4), m = JSON.parse(Buffer.from(d.subarray(off + 4, off + 4 + len)).map((b, i) => b ^ mask[i % 4]).toString("utf8"));
      asked.push(m.tag);
      const value = m.tag === "orchestration.getArchivedShellSnapshot" ? { schemaVersion: 1, snapshotSequence: 1, projects: [], threads: [archived] } : {};
      const out = Buffer.from(JSON.stringify({ _tag: "Exit", requestId: m.id, exit: { _tag: "Success", value } }));
      sock.write(Buffer.concat([Buffer.from(out.length < 126 ? [0x81, out.length] : [0x81, 126, out.length >> 8, out.length & 255]), out]));
    });
    sock.on("error", () => {});
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  fs.mkdirSync(path.join(tmp, "t3")); fs.writeFileSync(path.join(tmp, "t3", "server-runtime.json"), JSON.stringify({ host: "127.0.0.1", port: srv.address().port }));
  const run = (q) => new Promise((r) => execFile(process.execPath, [path.join(tmp, "t3listen"), "preview-finish", "--dry-run", "--thread", q],
    { env: { ...process.env, T3_HOME: path.join(tmp, "t3") } }, (err, out, errOut) => r({ code: err ? err.code : 0, out: out + errOut })));
  try {
    let r = await run("Shipped last week"); assert.equal(r.code, 0, r.out); assert.match(r.out, /would not report: no run/);
    assert.ok(asked.includes("orchestration.getArchivedShellSnapshot"), asked.join());
    r = await run("never existed"); assert.equal(r.code, 1, r.out); assert.match(r.out, /NOT_FOUND/);
    assert.doesNotMatch(r.out, /couldn't be checked/);
  } finally { srv.close(); }
});

test("preview-finish: a failed archived-list read is named on NOT_FOUND, and a weak live match is still used", async () => {
  const fs = require("fs"), os = require("os"), http = require("http"), crypto = require("crypto"), { execFile } = require("child_process");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "t3listen-preview-archive-down-"));
  fs.copyFileSync(path.join(__dirname, "..", "tools", "t3listen"), path.join(tmp, "t3listen"));
  fs.copyFileSync(path.join(__dirname, "..", "tools", "thread-match.js"), path.join(tmp, "thread-match.js"));
  fs.writeFileSync(path.join(tmp, "token"), "test-fixture");
  const live = { id: "live-thread-001", title: "Release follow up" };
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url);
    if (u === "/api/orchestration/shell") return res.end(JSON.stringify({ projects: [], threads: [live], archivedThreads: [] }));
    if (u === "/api/orchestration/threads/" + live.id) return res.end(JSON.stringify({ projection: { thread: live, runs: [] } }));
    res.statusCode = 404; res.end("{}");
  });
  srv.on("upgrade", (req, sock) => {
    const accept = crypto.createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    sock.on("data", (d) => {
      if ((d[0] & 15) === 8) return sock.end();
      if ((d[0] & 15) !== 1) return;
      let len = d[1] & 127, off = 2; if (len === 126) { len = d.readUInt16BE(2); off = 4; }
      const mask = d.subarray(off, off + 4), m = JSON.parse(Buffer.from(d.subarray(off + 4, off + 4 + len)).map((b, i) => b ^ mask[i % 4]).toString("utf8"));
      const exit = m.tag === "orchestration.getArchivedShellSnapshot"
        ? { _tag: "Failure", cause: { message: "archive rpc down" } }
        : { _tag: "Success", value: {} };
      const out = Buffer.from(JSON.stringify({ _tag: "Exit", requestId: m.id, exit }));
      sock.write(Buffer.concat([Buffer.from(out.length < 126 ? [0x81, out.length] : [0x81, 126, out.length >> 8, out.length & 255]), out]));
    });
    sock.on("error", () => {});
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  fs.mkdirSync(path.join(tmp, "t3")); fs.writeFileSync(path.join(tmp, "t3", "server-runtime.json"), JSON.stringify({ host: "127.0.0.1", port: srv.address().port }));
  const run = (q) => new Promise((r) => execFile(process.execPath, [path.join(tmp, "t3listen"), "preview-finish", "--dry-run", "--thread", q],
    { env: { ...process.env, T3_HOME: path.join(tmp, "t3") } }, (err, out, errOut) => r({ code: err ? err.code : 0, out: out + errOut })));
  try {
    let r = await run("follow"); assert.equal(r.code, 0, r.out); assert.match(r.out, /would not report: no run/); assert.doesNotMatch(r.out, /couldn't be checked/);
    r = await run("Shipped last week"); assert.equal(r.code, 1, r.out);
    assert.match(r.out, /^NOT_FOUND: no thread matches "Shipped last week"[\s\S]*T3's archived threads couldn't be checked:.*archive rpc down/);
    r = await run("missing-id-999"); assert.equal(r.code, 1, r.out);
    assert.match(r.out, /^NOT_FOUND: no thread matches "missing-id-999"[\s\S]*T3's archived threads couldn't be checked:.*archive rpc down/);
  } finally { srv.close(); }
});

const { startFake, copyTools, sleep } = require("./fake-t3");
const EXAMPLE_FILTERS = {
 "finished": { "postWhen": [
  "^[ \\t>*_`#-]*(STUCK|BLOCKED)\\b(?!-)",
  { "pattern": "^[ \\t>*_`#-]*(stuck|blocked|error)\\b(?!-)", "flags": "i", "lines": "edge" },
  { "pattern": "usage.?limit|(?<![#\\d])\\b429\\b|too many requests", "flags": "i", "lines": "edge", "notNegated": true },
  { "pattern": "\\b(needs?|requires?) (a |an |your )?decisions?\\b|\\bdecision (is )?needed\\b", "flags": "i", "notNegated": true }
 ] },
 "cancelled": { "skipWhen": [
  "\\bWAITING\\b[^\\n]*\\b([Ww]atch|[Ww]akes?\\b|[Ww]ake-?up|[Mm]onitor|[Pp]oll)"
 ] }
};
test("filters: the README example is the one these tests check", () => {
  const md = require("fs").readFileSync(path.join(__dirname, "..", "README.md"), "utf8"), sec = md.slice(md.indexOf("### Filters"));
  assert.deepEqual(JSON.parse(`{${sec.match(/```json\n([\s\S]*?)```/)[1]}}`).filters, EXAMPLE_FILTERS);
});
test("filters: none set means every event is sent as before", () => {
  assert.equal(l.compileFilters(undefined), null); assert.equal(l.compileFilters(null), null);
  for (const ev of ["thread.finished", "thread.cancelled", "thread.failed", "request.resolved", "request.opened"]) assert.equal(l.filterSkip(null, ev, "anything"), null, ev);
  const F = l.compileFilters({}); for (const ev of ["thread.finished", "thread.cancelled", "request.resolved"]) assert.equal(l.filterSkip(F, ev, "Done."), null, ev);
  assert.equal(l.filtersLine(undefined), "off"); assert.equal(l.filtersLine({ finished: true }), "off");
});
test("filters: the README example keeps only finishes that need action and cancels without a live watch", () => {
  const F = l.compileFilters(EXAMPLE_FILTERS), fin = (t) => l.filterSkip(F, "thread.finished", t), can = (t) => l.filterSkip(F, "thread.cancelled", t);
  assert.equal(l.filterSkip(F, "request.resolved"), null, "the example keeps request.resolved");
  assert.equal(l.filterSkip(F, "thread.failed", "All good."), null, "failures are never filtered");
  assert.equal(l.filterSkip(F, "request.opened", ""), null, "questions are never filtered");
  assert.match(fin("Done. Tests pass and the PR is open."), /no filters\.finished\.postWhen/);
  assert.equal(fin("Summary of the work.\nSTUCK: the migration needs a running database"), null, "an uppercase STUCK line anywhere");
  assert.match(fin("Fixed the stuck job runner.\nAll green."), /no filters/, "lowercase stuck in the middle of a line is not a status");
  assert.equal(fin("blocked on review access\nmore details"), null, "stuck/blocked/error opening the first or last line");
  assert.equal(fin("Partial work.\nError: build fails on node 18"), null);
  assert.match(fin("Done.\nNote: BLOCKED-ON-NOTHING tag removed"), /no filters/, "BLOCKED- is a tag, not a status");
  assert.equal(fin("Stopped early.\nHit the usage limit at 14:02"), null);
  assert.match(fin("Stopped early.\nNo usage limit was hit"), /no filters/, "a negated usage limit is not one");
  assert.match(fin("See issue #429 for context.\nDone"), /no filters/, "#429 is an issue number");
  assert.equal(fin("Ready.\nThis needs a decision: keep v1 or move to v2?"), null);
  assert.match(fin("Ready. Nothing needs a decision from you."), /no filters/, "negated in the same clause");
  assert.equal(fin("Nothing else changed, but the schema change needs your decision."), null, "the negation is in another clause");
  assert.match(can("Stopped.\nWAITING: the CI watch reports back when the run ends"), /skipWhen\[0\]/);
  assert.equal(can("Stopped by the user."), null);
  assert.equal(can("waiting for the watch"), null, "WAITING must be uppercase");
  assert.equal(l.filtersLine(EXAMPLE_FILTERS), "on (finished, cancelled)");
});
test("filters: false turns an event off; bad settings are named", () => {
  const F = l.compileFilters({ finished: false, negations: [] });
  assert.match(l.filterSkip(F, "thread.finished", "STUCK"), /filters\.finished is false/); assert.equal(l.filterSkip(F, "thread.cancelled", "x"), null);
  assert.match(l.filterSkip(F, "thread.finished", null), /filters\.finished is false/, "false holds the event back even when the run said nothing");
  assert.match(l.filterSkip(l.compileFilters({ resolved: false }), "request.resolved"), /filters\.resolved is false/);
  for (const [bad, re] of [["x", /must be an object/], [{ resolved: {} }, /resolved must be true or false/], [{ finished: [] }, /finished must be/],
    [{ finished: { postWhen: "STUCK" } }, /postWhen must be a list/], [{ cancelled: { skipWhen: ["("] } }, /cancelled\.skipWhen\[0\] is not a valid pattern/],
    [{ finished: { postWhen: [{ pattern: "x", lines: "middle" }] } }, /lines must be/], [{ finished: { postWhen: [{}] } }, /needs a pattern/], [{ negations: "no" }, /negations must be/],
    [{ finished: { postWhen: [{ pattern: "x", notNegated: "true" }] } }, /postWhen\[0\]\.notNegated must be true or false/]])
    assert.throws(() => l.compileFilters(bad), re, JSON.stringify(bad));
  const G = l.compileFilters({ finished: { postWhen: [{ pattern: "decision", notNegated: true }] }, negations: ["hardly"] });
  assert.equal(l.filterSkip(G, "thread.finished", "no decision yet"), null, "custom negations replace the default list");
  assert.match(l.filterSkip(G, "thread.finished", "hardly a decision"), /no filters/);
});
test("filters: curly apostrophes negate like straight ones; a dot inside a word or number doesn't end a clause", () => {
  const F = l.compileFilters({ finished: { postWhen: [{ pattern: "needs? (a |your )?decision", flags: "i", notNegated: true }, { pattern: "usage.?limit", flags: "i", notNegated: true }] } });
  const fin = (t) => l.filterSkip(F, "thread.finished", t);
  assert.match(fin("This doesn't need a decision."), /no filters/);
  assert.match(fin("This doesn’t need a decision."), /no filters/, "right single quotation mark");
  assert.match(fin("This doesnʼt need a decision."), /no filters/, "modifier letter apostrophe");
  assert.equal(fin("Hit the usage.limit on v1.4 today"), null, "usage.limit and v1.4 stay in one clause");
  assert.equal(fin("No tests broke. It needs your decision."), null, "a sentence end still ends a clause");
  assert.equal(fin("Nothing else changed,but it needs your decision"), null, "a comma ends a clause even without a space");
});
test("filters: unknown keys are ignored and listed, never fatal; status tells what the listener will do", () => {
  const F = l.compileFilters({ finshed: false, finished: { postWhen: ["STUCK"], postwhen: ["x"] }, cancelled: { skipWhen: [{ pattern: "WAITING", flag: "i" }] } });
  assert.deepEqual(F.ignored, ["filters.finshed", "filters.finished.postwhen", "filters.cancelled.skipWhen[0].flag"]);
  assert.match(l.filterSkip(F, "thread.finished", "Done"), /no filters\.finished\.postWhen/);
  assert.equal(l.filtersLine({ finshed: false, finished: { postWhen: ["STUCK"] } }), "on (finished); ignored: filters.finshed");
  assert.equal(l.filtersLine({ finished: {} }), "off", "a rule with no patterns holds nothing back");
  assert.match(l.filtersLine({ finished: { postWhen: ["("] } }), /^invalid, the listener won't start: listen\.json filters\.finished\.postWhen\[0\] is not a valid pattern/);
  assert.match(l.filtersLine("on"), /^invalid, the listener won't start: listen\.json filters must be an object/);
});
const now = () => new Date().toISOString();
const busy = (id, runId) => ({ id, title: `Thread ${id}`, status: "running", activeRunId: runId, latestRunId: runId });
const idle = (id, runId) => ({ id, title: `Thread ${id}`, status: "idle", activeRunId: null, latestRunId: runId });
test("filters, live: a held-back finish is not posted, is saved as reported, and catch-up after a restart doesn't post it", async () => {
  const f = await startFake({ filters: { finished: { postWhen: ["^BLOCKED"] }, finshed: false } });
  try {
    const r1 = { id: "r1", status: "running", startedAt: now() };
    f.setThread(busy("A", "r1"), { runs: [r1], turnItems: [] });
    f.start(); await f.waitFor(() => /watching 1 threads/.test(f.out), 8000, "first snapshot");
    assert.match(f.out, /listen\.json: filters\.finshed is not a setting/, "an unknown key is logged, and the listener runs");
    f.update(idle("A", "r1"), { runs: [{ ...r1, status: "completed", completedAt: now() }], turnItems: [{ type: "assistant_message", runId: "r1", text: "All done, tests pass." }] });
    await f.waitFor(() => /not sent: thread\.finished "Thread A"/.test(f.out), 8000, "the filter decision");
    assert.deepEqual(f.posts, []);
    assert.deepEqual(Object.keys(f.state().finished), ["r1"]); assert.equal(f.state().finished.r1.e, undefined, "nothing is kept to resend");
    assert.ok(!JSON.stringify(f.state()).includes("tests pass"), "the reply is never saved");
    await f.stop(); f.start();
    await f.waitFor(() => f.count(/watching 1 threads/) === 2, 8000, "the restart's snapshot");
    await sleep(200);
    assert.deepEqual(f.posts, [], "catch-up after the restart sends nothing for the held-back finish");
  } finally { await f.close(); }
});
test("filters, live: resolved false drops request.resolved and forgets the question", async () => {
  const f = await startFake({ filters: { resolved: false } });
  try {
    const req = { id: "req-1", kind: "user_input", status: "pending", createdAt: now(), responseCapability: { type: "resumable" } };
    const item = { type: "user_input_request", requestId: "req-1", questions: [{ id: "q", header: "Pick", question: "Which one?", options: [{ label: "Blue" }] }] };
    f.setThread({ ...busy("Q", "r1"), pendingRuntimeRequest: { id: "req-1" } }, { runs: [], turnItems: [item], runtimeRequests: [req] });
    f.start(); await f.waitFor(() => f.posts.length === 1, 8000, "request.opened");
    assert.equal(f.posts[0].event, "request.opened");
    f.update({ ...busy("Q", "r1"), pendingRuntimeRequest: null }, { runs: [], turnItems: [item], runtimeRequests: [{ ...req, status: "resolved", resolvedAt: now(), answers: { q: "Blue" } }] });
    await f.waitFor(() => { const s = f.state(); return !!s && Object.keys(s.sent).length === 0; }, 8000, "the question to be forgotten");
    await sleep(200);
    assert.deepEqual(f.posts.map((e) => e.event), ["request.opened"]);
  } finally { await f.close(); }
});
test("filters, live: only the ended run's own reply is judged; a run with no reply of its own is posted", async () => {
  const f = await startFake({ filters: { cancelled: { skipWhen: ["\\bWAITING\\b[^\\n]*\\b[Ww]atch"] } } });
  try {
    const waiting = "Kicked off CI.\nWAITING: the CI watch reports back when the run ends";
    const a1 = { id: "a1", ordinal: 1, status: "completed", startedAt: "2026-11-07T04:00:00Z", completedAt: "2026-11-07T04:05:00Z" };
    const a2 = { id: "a2", ordinal: 2, status: "running", startedAt: now() }, b1 = { id: "b1", ordinal: 1, status: "running", startedAt: now() };
    f.setThread(busy("A", "a2"), { runs: [a1, a2], turnItems: [{ type: "assistant_message", runId: "a1", text: waiting }] });
    f.setThread(busy("B", "b1"), { runs: [b1], turnItems: [] });
    f.start(); await f.waitFor(() => /watching 2 threads/.test(f.out), 8000, "first snapshot");
    f.update(idle("A", "a2"), { runs: [a1, { ...a2, status: "interrupted", completedAt: now() }], turnItems: [{ type: "assistant_message", runId: "a1", text: waiting }] });
    f.update(idle("B", "b1"), { runs: [{ ...b1, status: "interrupted", completedAt: now() }], turnItems: [{ type: "assistant_message", runId: "b1", text: waiting }] });
    await f.waitFor(() => f.posts.length >= 1 && /not sent: thread\.cancelled "Thread B"/.test(f.out), 8000, "both cancels to be handled");
    await sleep(200);
    assert.deepEqual(f.posts.map((e) => [e.event, e.runId]), [["thread.cancelled", "a2"]], "the earlier run's WAITING line doesn't hold back the later cancel");
    assert.match(f.out, /thread\.cancelled "Thread A" a2 is sent: the run left no reply for filters\.cancelled to check/);
  } finally { await f.close(); }
});
test("filters: a bad pattern stops the listener at startup with BAD_LISTEN_CONFIG and names the setting", async () => {
  const f = await startFake({ filters: { finished: { postWhen: ["("] } } });
  try {
    assert.equal(await f.start().exited, 1);
    assert.match(f.out, /BAD_LISTEN_CONFIG: listen\.json filters\.finished\.postWhen\[0\] is not a valid pattern/);
  } finally { await f.close(); }
});
test("preview-finish: filters see the whole last reply, not the 600-character lastReply", async () => {
  const fs = require("fs"), os = require("os"), http = require("http"), { execFile } = require("child_process");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "t3listen-preview-filters-"));
  copyTools(tmp);
  fs.writeFileSync(path.join(tmp, "token"), "test-fixture");
  fs.writeFileSync(path.join(tmp, "listen.json"), JSON.stringify({ url: "http://127.0.0.1:9/", headers: {}, machine: "m", filters: EXAMPLE_FILTERS }));
  const thread = { id: "filter-thread-01", title: "Long reply", status: "idle" };
  let reply = "";
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url);
    if (u === "/api/orchestration/shell") return res.end(JSON.stringify({ projects: [], threads: [thread] }));
    if (u === "/api/orchestration/threads/" + thread.id) return res.end(JSON.stringify({ projection: { thread,
      turnItems: [{ type: "assistant_message", runId: "r1", text: reply }], runs: [{ id: "r1", status: "completed", startedAt: "2026-01-01T04:00:00Z", completedAt: "2026-01-01T04:05:00Z" }] } }));
    res.statusCode = 404; res.end("{}");
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  fs.mkdirSync(path.join(tmp, "t3")); fs.writeFileSync(path.join(tmp, "t3", "server-runtime.json"), JSON.stringify({ host: "127.0.0.1", port: srv.address().port }));
  const run = () => new Promise((done) => execFile(process.execPath, [path.join(tmp, "t3listen"), "preview-finish", "--dry-run", "--thread", thread.id],
    { env: { ...process.env, T3_HOME: path.join(tmp, "t3") } }, (err, out, errOut) => done({ code: err ? err.code : 0, out: out + errOut })));
  try {
    reply = "Worked through the list.\n" + "x".repeat(900) + "\nBLOCKED: needs the staging database password";
    let r = await run(); assert.equal(r.code, 0, r.out);
    assert.ok(!/would not report/.test(r.out), r.out);
    assert.ok(!JSON.parse(r.out.slice(r.out.indexOf("{"))).lastReply.includes("BLOCKED"), "the status line is past lastReply's 600 characters");
    reply = "All done, tests pass.";
    r = await run(); assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^would not report \(listen\.json filters\): last reply matches no filters\.finished\.postWhen pattern/);
  } finally { srv.closeAllConnections(); srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
