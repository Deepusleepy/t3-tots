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
  const start = src.indexOf("const since = catchUpSince(S.lastAlive");
  assert.ok(start > 0, "catch-up starts from catchUpSince");
  const end = src.indexOf("afterSnapshotListen(", start);
  const block = src.slice(start, end);
  assert.ok(block.includes("catchUpThreads("), block);
  assert.ok(block.includes("reportEnd(ep, t, null, { since, failedSince })"), block);
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
  } finally { srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
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
  } finally { srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
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
  srv.close(); fs.rmSync(tmp, { recursive: true, force: true });
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
  } finally { srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
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
  } finally { srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("reliability settings: off unless listen.json sets them; bad values fall back to the defaults", () => {
  assert.deepEqual(l.reliability({}), { catchUpMinutes: null, failureWaveMs: 0, failureWaveMaxMs: 120000, repeatFailureMs: 0 });
  assert.deepEqual(l.reliability({ catchUpMinutes: 2, failureWaveSeconds: 20, failureWaveMaxSeconds: 90, repeatFailureHours: 6 }),
    { catchUpMinutes: 2, failureWaveMs: 20000, failureWaveMaxMs: 90000, repeatFailureMs: 6 * 3600e3 });
  assert.deepEqual(l.reliability({ catchUpMinutes: "x", failureWaveSeconds: -1, repeatFailureHours: null }), l.reliability({}));
  assert.equal(l.reliability({ catchUpMinutes: 0 }).catchUpMinutes, 0, "0 is a real limit: nothing from before the start");
});
test("catchUpSince: back to the last connection by default; catchUpMinutes caps it; no lastAlive means no catch-up", () => {
  const start = Date.parse("2026-11-03T12:00:00Z"), lastAlive = Date.parse("2026-11-03T08:00:00Z");
  assert.equal(l.catchUpSince(lastAlive, start, null), lastAlive - 120000);
  assert.equal(l.catchUpSince(lastAlive, start, 2), start - 120000);
  assert.equal(l.catchUpSince(lastAlive, start, 0), start);
  assert.equal(l.catchUpSince(lastAlive, start, 600), lastAlive - 120000, "a cap wider than the outage changes nothing");
  assert.equal(l.catchUpSince(0, start, 2), 0);
});
const fakeT3 = require("./fake-t3");
test("repeatCheck: the same thread and error inside the window is held; the next sent one counts what was held", () => {
  const h = 3600e3, t0 = Date.parse("2026-11-03T10:00:00Z");
  const fail = (runId, error) => ({ event: "thread.failed", threadId: "t1", runId, error });
  let r = l.repeatCheck(undefined, fail("r1", "Provider error 503 (req 9f8e7d6c5b4a) at 2026-11-03T10:00:00Z"), t0, 6 * h);
  assert.equal(r.hold, false); assert.equal(r.repeats, undefined);
  r = l.repeatCheck(r.rec, fail("r2", "provider error 503 (req 0a1b2c3d4e5f) at 2026-11-03T11:00:07Z"), t0 + h, 6 * h);
  assert.equal(r.hold, true, "request ids and timestamps don't make an error different"); assert.equal(r.rec.held, 1);
  r = l.repeatCheck(r.rec, fail("r3", "Provider error 503 (req 77aa88bb99cc) at 2026-11-03T12:00:00Z"), t0 + 2 * h, 6 * h);
  assert.equal(r.hold, true); assert.equal(r.rec.held, 2);
  assert.equal(l.repeatCheck(r.rec, fail("r1", "Provider error 503 (req 9f8e7d6c5b4a)"), t0 + 3 * h, 6 * h).hold, false, "the same run resent after a restart is not a repeat");
  const other = l.repeatCheck(r.rec, fail("r4", "context window exceeded"), t0 + 3 * h, 6 * h);
  assert.equal(other.hold, false); assert.deepEqual(other.repeats, { repeatsSuppressed: 2, repeatsSince: new Date(t0).toISOString() });
  const later = l.repeatCheck(r.rec, fail("r5", "Provider error 503 (req 1)"), t0 + 7 * h, 6 * h);
  assert.equal(later.hold, false, "after the window the same error is sent again"); assert.equal(later.repeats.repeatsSuppressed, 2);
});
test("repeatCheck: a status code is a difference; a usage limit that wasn't set to resume is never held", () => {
  const h = 3600e3, t0 = Date.parse("2026-11-07T00:00:00Z");
  const sent = l.repeatCheck(undefined, { threadId: "t", runId: "a", error: "Provider returned HTTP 503" }, t0, 6 * h);
  assert.equal(l.repeatCheck(sent.rec, { threadId: "t", runId: "b", error: "Provider returned HTTP 401" }, t0 + h, 6 * h).hold, false, "401 after 503 is a new problem");
  assert.notEqual(l.failureKey({ error: "HTTP 503" }), l.failureKey({ error: "HTTP 401" }));
  assert.equal(l.failureKey({ error: "Rate limited until 5:00 PM, retry in 12000ms" }), l.failureKey({ error: "Rate limited until 10:30 am, retry in 30000ms" }), "clock times and long numbers don't count");
  const limit = (runId, autoResumeSet, resets) => ({ threadId: "t", runId, error: `You've hit your usage limit. Resets at ${resets}`, usageLimit: true, autoResumeSet });
  const armed = l.repeatCheck(undefined, limit("u1", true, "5:00 AM"), t0, 6 * h);
  assert.equal(l.repeatCheck(armed.rec, limit("u2", true, "10:00 AM"), t0 + 5 * h, 6 * h).hold, true, "a second stop that resumes on its own needs nothing from you");
  const notArmed = l.repeatCheck(armed.rec, limit("u2", false, "10:00 AM"), t0 + 5 * h, 6 * h);
  assert.equal(notArmed.hold, false, "a stop that won't resume on its own needs you");
  assert.equal(l.repeatCheck(notArmed.rec, limit("u3", false, "3:00 PM"), t0 + 5.5 * h, 6 * h).hold, false, "and so does the next one");
});
test("failure waves: the wait restarts with each failure but never past the cap; a batch lists every failure", () => {
  const t0 = 1e12;
  assert.equal(l.waveDelay(t0, t0, 20000, 120000), 20000);
  assert.equal(l.waveDelay(t0, t0 + 110000, 20000, 120000), 10000);
  assert.equal(l.waveDelay(t0, t0 + 130000, 20000, 120000), 0);
  assert.equal(l.waveDelay(t0, t0, 3e9, 4e9), 2147483647, "never longer than a timer can wait");
  const f = (n, at) => ({ event: "thread.failed", kind: "thread-failed", machine: "m", threadId: `t${n}`, title: `Thread ${n}`, project: "p", runId: `r${n}`, status: "failed",
    error: "boom", completedAt: at, text: "x", eventId: "e", sentAt: "s", usageLimit: n === 2 ? true : undefined });
  const b = l.batchEvent([f(1, "2026-11-03T10:00:05Z"), f(2, "2026-11-03T10:00:01Z"), f(3, "2026-11-03T10:00:09Z")], "m");
  assert.equal(b.event, "thread.failed.batch"); assert.equal(b.kind, "thread-failed-batch"); assert.equal(b.count, 3);
  assert.equal(b.firstAt, "2026-11-03T10:00:01Z"); assert.equal(b.lastAt, "2026-11-03T10:00:09Z");
  assert.deepEqual(b.failures.map((x) => x.runId), ["r1", "r2", "r3"]);
  for (const x of b.failures) for (const k of ["event", "kind", "machine", "text", "eventId", "sentAt"]) assert.ok(!(k in x), `${k} is per post, not per failure`);
  const text = l.summary(b);
  assert.match(text, /^T3 failure wave on m: 3 threads failed between /);
  assert.match(text, /- "Thread 2" \(p\): boom \(usage limit, not auto-resumed\)/);
  assert.match(l.summary({ ...f(4, "2026-11-03T10:00:00Z"), completedAtLocal: "now", repeatsSuppressed: 3, repeatsSince: "2026-11-03T04:00:00Z" }), /3 more failure\(s\) of this thread with the same error were held back since/);
});
test("retry queue full: a batch keeps each failure it carries in listen-state.json, and they come back one by one", () => {
  const st = { sent: {}, finished: { r1: { threadId: "a", at: 1, e: { event: "thread.failed", runId: "r1" } }, r2: { threadId: "b", at: 1, e: { event: "thread.failed", runId: "r2" } } } };
  const q = Array.from({ length: l.MAX_RETRY_QUEUE }, (_, i) => ({ e: { event: "x", runId: `q${i}` } }));
  const batch = { e: { event: "thread.failed.batch", failures: [{ runId: "r1" }, { runId: "r2" }, { runId: "gone" }] }, rounds: 3, since: 5 };
  assert.equal(l.keepForRetry(q, st, batch), "parked");
  assert.deepEqual(Object.keys(st.finished.r1.parked), ["thread.failed"]); assert.equal(st.finished.r1.parked["thread.failed"].e, st.finished.r1.e);
  assert.equal(l.refillFromState([], st, 9), 2);
  assert.equal(l.keepForRetry(q, { sent: {}, finished: {} }, batch), "dropped", "nothing saved to keep");
});
test("settingsLine: status names the optional listener settings that are on", () => {
  assert.equal(l.settingsLine({}), "defaults");
  assert.equal(l.settingsLine({ catchUpMinutes: 2, failureWaveSeconds: 20, repeatFailureHours: 6 }), "catch-up of finishes and cancels capped at 2 min, failure waves 20s (up to 120s), repeat holds 6h");
});
const isoNow = () => new Date().toISOString();
const busyT = (id, runId) => ({ id, title: `Thread ${id}`, status: "running", activeRunId: runId, latestRunId: runId });
const failedT = (id, runId, extra = {}) => ({ id, title: `Thread ${id}`, status: "failed", activeRunId: null, latestRunId: runId, ...extra });
const failRun = (id, extra = {}) => ({ id, status: "failed", startedAt: "2026-11-07T04:00:00Z", completedAt: isoNow(), ...extra });
const errItem = (runId, text) => ({ type: "error", runId, text });
test("failure waves, live: off by default, a failure is posted once as a plain thread.failed", async () => {
  const f = await fakeT3.startFake();
  try {
    f.setThread(busyT("A", "r1"), { runs: [{ id: "r1", status: "running", startedAt: isoNow() }], turnItems: [] });
    f.start(); await f.waitFor(() => /watching 1 threads/.test(f.out), 8000, "first snapshot");
    f.update(failedT("A", "r1"), { runs: [failRun("r1")], turnItems: [errItem("r1", "Provider error 503")] });
    await f.waitFor(() => f.posts.length === 1, 8000, "the failure");
    await fakeT3.sleep(300);
    assert.deepEqual(f.posts.map((e) => [e.event, e.runId, e.error]), [["thread.failed", "r1", "Provider error 503"]]);
  } finally { await f.close(); }
});
test("failure waves, live: a reconnect while a wave is open doesn't send the failure twice", async () => {
  const f = await fakeT3.startFake({ failureWaveSeconds: 4 });
  try {
    f.setThread(busyT("A", "r1"), { runs: [{ id: "r1", status: "running", startedAt: isoNow() }], turnItems: [] });
    f.start(); await f.waitFor(() => /watching 1 threads/.test(f.out), 8000, "first snapshot");
    f.update(failedT("A", "r1"), { runs: [failRun("r1")], turnItems: [errItem("r1", "Provider error 503")] });
    await f.waitFor(() => !!f.state() && !!(f.state().finished.r1 || {}).e, 8000, "the failure to be held in the wave");
    f.dropSockets();
    await f.waitFor(() => f.count(/connected to T3/) === 2 && f.count(/watching 1 threads/) === 2, 8000, "the reconnect");
    await f.waitFor(() => f.posts.length >= 1, 9000, "the wave to be sent");
    await fakeT3.sleep(500);
    assert.deepEqual(f.posts.map((e) => [e.event, e.runId]), [["thread.failed", "r1"]]);
  } finally { await f.close(); }
});
test("failure waves, live: two failures close together are one batch; a restart while it is open sends it once", async () => {
  const f = await fakeT3.startFake({ failureWaveSeconds: 3 });
  try {
    for (const id of ["A", "B"]) f.setThread(busyT(id, `${id}1`), { runs: [{ id: `${id}1`, status: "running", startedAt: isoNow() }], turnItems: [] });
    f.start(); await f.waitFor(() => /watching 2 threads/.test(f.out), 8000, "first snapshot");
    for (const id of ["A", "B"]) f.update(failedT(id, `${id}1`), { runs: [failRun(`${id}1`)], turnItems: [errItem(`${id}1`, `boom ${id}`)] });
    await f.waitFor(() => { const s = f.state(); return !!s && !!(s.finished.A1 || {}).e && !!(s.finished.B1 || {}).e; }, 8000, "both failures to be saved");
    await f.stop(); assert.deepEqual(f.posts, [], "nothing was sent before the restart");
    f.start();
    await f.waitFor(() => f.posts.length >= 1, 9000, "the batch after the restart");
    await fakeT3.sleep(800);
    assert.equal(f.posts.length, 1);
    assert.equal(f.posts[0].event, "thread.failed.batch"); assert.equal(f.posts[0].count, 2);
    assert.deepEqual(f.posts[0].failures.map((x) => x.runId).sort(), ["A1", "B1"]);
    assert.equal(f.state().finished.A1.e, undefined, "each run is marked delivered");
  } finally { await f.close(); }
});
test("catch-up, live: catchUpMinutes caps finishes, but a failure from the outage is still sent and its usage limit armed", async () => {
  const f = await fakeT3.startFake({ catchUpMinutes: 0 });
  try {
    f.start(); await f.waitFor(() => /watching 0 threads/.test(f.out), 8000, "first snapshot");
    await f.stop();
    require("fs").writeFileSync(require("path").join(f.dir, "autoresume.json"), JSON.stringify({ projects: ["proj"] }));
    const reset = new Date(Date.now() + 3600e3).toISOString();
    f.setThread(failedT("F", "f1", { usageLimitResetAt: reset, lastErrorClass: "usage_limit" }), { runs: [failRun("f1", { lastErrorClass: "usage_limit", usageLimitResetAt: reset })], turnItems: [errItem("f1", "You've hit your usage limit")] });
    f.setThread({ id: "G", title: "Thread G", status: "idle", activeRunId: null, latestRunId: "g1" }, { runs: [{ id: "g1", status: "completed", startedAt: "2026-11-07T04:00:00Z", completedAt: isoNow() }], turnItems: [{ type: "assistant_message", runId: "g1", text: "Done." }] });
    await fakeT3.sleep(50);
    f.start();
    await f.waitFor(() => f.count(/watching 2 threads/) === 1 && f.posts.length >= 1, 9000, "catch-up");
    await fakeT3.sleep(300);
    assert.deepEqual(f.posts.map((e) => [e.event, e.runId, e.usageLimit, e.autoResumeSet]), [["thread.failed", "f1", true, true]], "the finish is capped, the failure is not");
    assert.deepEqual(f.commands.map((c) => [c.payload.type, c.payload.limitRecovery && c.payload.limitRecovery.runId]), [["thread.metadata.update", "f1"]]);
  } finally { await f.close(); }
});
test("repeat holds, live: a held count survives a restart after the window and rides on the next sent failure", async () => {
  const f = await fakeT3.startFake({ repeatFailureHours: 1.5 / 3600 });
  try {
    const fail = async (runId, n) => {
      f.update(busyT("A", runId), { runs: [{ id: runId, status: "running", startedAt: isoNow() }], turnItems: [] });
      await fakeT3.sleep(150);
      f.update(failedT("A", runId), { runs: [failRun(runId)], turnItems: [errItem(runId, "Provider error 503 (req 9f8e7d6c5b4a)")] });
      await f.waitFor(() => !!f.state() && !!f.state().finished[runId], 8000, `failure ${n}`);
    };
    f.setThread(busyT("A", "r0"), { runs: [{ id: "r0", status: "running", startedAt: isoNow() }], turnItems: [] });
    f.start(); await f.waitFor(() => /watching 1 threads/.test(f.out), 8000, "first snapshot");
    await fail("r1", 1); await f.waitFor(() => f.posts.length === 1, 8000, "the first failure");
    await fail("r2", 2); await f.waitFor(() => /held back thread\.failed/.test(f.out), 8000, "the repeat to be held");
    await fakeT3.sleep(1800); await f.stop(); f.start();
    await f.waitFor(() => f.count(/watching 1 threads/) === 2, 8000, "the restart");
    await fail("r3", 3); await f.waitFor(() => f.posts.length === 2, 8000, "the third failure");
    assert.deepEqual(f.posts.map((e) => [e.runId, e.repeatsSuppressed]), [["r1", undefined], ["r3", 1]]);
  } finally { await f.close(); }
});
test("retry, live: a failure the webhook refused is kept across a crash and sent once after the restart", async () => {
  const f = await fakeT3.startFake();
  try {
    f.setHookStatus((e) => (e.event === "thread.failed" ? 400 : 200));
    f.setThread(busyT("A", "r1"), { runs: [{ id: "r1", status: "running", startedAt: isoNow() }], turnItems: [] });
    f.start(); await f.waitFor(() => /watching 1 threads/.test(f.out), 8000, "first snapshot");
    f.update(failedT("A", "r1"), { runs: [failRun("r1")], turnItems: [errItem("r1", "Provider error 503")] });
    await f.waitFor(() => /webhook answered HTTP 400 for thread\.failed/.test(f.out), 8000, "the refused send");
    assert.ok(f.state().finished.r1.e, "the unsent failure is saved");
    await f.stop(); f.setHookStatus(() => 200); f.start();
    await f.waitFor(() => f.posts.length === 1, 8000, "the resend after the restart");
    await fakeT3.sleep(500);
    assert.deepEqual(f.posts.map((e) => [e.event, e.runId]), [["thread.failed", "r1"]]);
    assert.equal(f.state().finished.r1.e, undefined, "marked delivered");
  } finally { await f.close(); }
});
test("retry queue full, live: a batch that can't be queued is saved per failure, survives a crash, and is sent once", async () => {
  const f = await fakeT3.startFake({ failureWaveSeconds: 1.5 });
  try {
    f.setHookStatus((e) => (e.event === "request.opened" || e.event === "thread.failed.batch" ? 400 : 200));
    for (let i = 0; i < 100; i++) {
      const id = `Q${i}`, req = { id: `req-${i}`, kind: "user_input", status: "pending", createdAt: isoNow(), responseCapability: { type: "resumable" } };
      f.setThread({ ...busyT(id, `${id}r`), pendingRuntimeRequest: { id: req.id } }, { runs: [], runtimeRequests: [req], turnItems: [{ type: "user_input_request", requestId: req.id, questions: [{ id: "q", question: `Q ${i}?`, options: [{ label: "Yes" }] }] }] });
    }
    for (const id of ["A", "B"]) f.setThread(busyT(id, `${id}1`), { runs: [{ id: `${id}1`, status: "running", startedAt: isoNow() }], turnItems: [] });
    f.start(); await f.waitFor(() => /watching 102 threads/.test(f.out), 20000, "100 refused questions to fill the retry queue");
    for (const id of ["A", "B"]) f.update(failedT(id, `${id}1`), { runs: [failRun(`${id}1`)], turnItems: [errItem(`${id}1`, `boom ${id}`)] });
    await f.waitFor(() => /retry queue is full; thread\.failed\.batch/.test(f.out), 10000, "the batch to meet the full queue");
    const s = f.state();
    for (const r of ["A1", "B1"]) assert.ok(s.finished[r].parked && s.finished[r].parked["thread.failed"], `${r} is parked in listen-state.json`);
    assert.ok(!/has no saved state, so it is dropped/.test(f.out), "nothing is dropped");
    await f.stop(); f.setHookStatus(() => 200); f.start();
    await f.waitFor(() => f.posts.filter((e) => e.event === "request.opened").length === 100 && f.posts.some((e) => e.event === "thread.failed.batch"), 20000, "everything after the restart");
    await fakeT3.sleep(2500);
    const failures = f.posts.filter((e) => e.event.startsWith("thread.failed")).flatMap((e) => (e.failures || [e]).map((x) => x.runId)).sort();
    assert.deepEqual(failures, ["A1", "B1"], "each failure arrives once");
    assert.equal(f.posts.filter((e) => e.event === "request.opened").length, 100, "each question arrives once");
  } finally { await f.close(); }
});
test("repeat holds, live: a usage limit set to resume is held when it repeats; one that isn't set is always sent", async () => {
  const f = await fakeT3.startFake({ repeatFailureHours: 6 });
  try {
    require("fs").writeFileSync(require("path").join(f.dir, "autoresume.json"), JSON.stringify({ projects: ["proj"] }));
    const reset = new Date(Date.now() + 3600e3).toISOString();
    const limitFail = async (id, runId, projectId) => {
      f.update({ ...busyT(id, runId), projectId }, { runs: [{ id: runId, status: "running", startedAt: isoNow() }], turnItems: [] });
      await fakeT3.sleep(150);
      f.update({ ...failedT(id, runId, { usageLimitResetAt: reset, lastErrorClass: "usage_limit" }), projectId }, { runs: [failRun(runId, { lastErrorClass: "usage_limit", usageLimitResetAt: reset })], turnItems: [errItem(runId, `You've hit your usage limit. Resets at ${runId === "u1" || runId === "v1" ? "5:00 AM" : "10:00 AM"}`)] });
      await f.waitFor(() => !!f.state() && !!f.state().finished[runId], 8000, `run ${runId}`);
    };
    f.setThread({ ...busyT("U", "u0"), projectId: "p1" }, { runs: [], turnItems: [] });
    f.setThread({ ...busyT("V", "v0"), projectId: "p2" }, { runs: [], turnItems: [] });
    f.start(); await f.waitFor(() => /watching 2 threads/.test(f.out), 8000, "first snapshot");
    await limitFail("U", "u1", "p1"); await limitFail("V", "v1", "p2");
    await f.waitFor(() => f.posts.length === 2, 8000, "the first stops");
    await limitFail("U", "u2", "p1"); await limitFail("V", "v2", "p2");
    await f.waitFor(() => f.posts.length === 3 && /held back thread\.failed "Thread U"/.test(f.out), 8000, "the second stops");
    await fakeT3.sleep(300);
    assert.deepEqual(f.posts.map((e) => [e.runId, e.usageLimit, e.autoResumeSet]), [["u1", true, true], ["v1", true, false], ["v2", true, false]]);
    assert.deepEqual(f.commands.map((c) => c.payload.limitRecovery.runId), ["u1", "u2"], "both of U's stops were armed; V's never");
  } finally { await f.close(); }
});
test("preview-finish: says when a failure would be held back as a repeat", async () => {
  const f = await fakeT3.startFake({ repeatFailureHours: 6 });
  try {
    f.setThread(failedT("A", "r1"), { runs: [failRun("r1")], turnItems: [errItem("r1", "Provider error 503 (req 9f8e7d6c5b4a)")] });
    const fs = require("fs"), path = require("path"), { execFile } = require("child_process");
    const preview = () => new Promise((done) => execFile(process.execPath, [path.join(f.dir, "t3listen"), "preview-finish", "--dry-run", "--thread", "A"],
      { env: { ...process.env, T3_HOME: path.join(f.dir, "t3") } }, (err, out, errOut) => done({ code: err ? err.code : 0, out: out + errOut })));
    let r = await preview(); assert.equal(r.code, 0, r.out); assert.ok(!/would hold back/.test(r.out), r.out);
    fs.writeFileSync(path.join(f.dir, "listen-state.json"), JSON.stringify({ sent: {}, finished: {}, failRepeat: { A: { err: "provider error 503 (req #id)", at: Date.now() - 3600e3, runId: "r0" } } }));
    r = await preview(); assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^would hold back: the same error as this thread's last sent failure, inside repeatFailureHours/m);
  } finally { await f.close(); }
});
