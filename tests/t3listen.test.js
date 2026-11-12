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
  assert.ok(body.includes("for (const run of ended) await reportEnd(ep, t, run.id, { ...opts, snap: p })"), body);
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
test("filters: the README example stays fast on a 64 KB reply full of dashes, markdown or one long line", () => {
  const F = l.compileFilters(EXAMPLE_FILTERS), K = 64 * 1024;
  const replies = { dashes: "-----\n".repeat(K / 6), table: "| --- | --- |\n".repeat(K / 14), markdown: " \t> * _ # -\n".repeat(K / 12),
    longLine: "-".repeat(K), waiting: `WAITING ${"-".repeat(200)}\n`.repeat(K / 209), words: "no usage limit, nothing needs a decision. ".repeat(K / 42) };
  for (const [name, text] of Object.entries(replies)) for (const event of ["thread.finished", "thread.cancelled"]) {
    const t0 = process.hrtime.bigint(), d = l.filterDecision(F, event, text, 60000), ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(ms < 200, `${event} on the ${name} reply took ${ms.toFixed(0)} ms`); assert.equal(d.note, null);
  }
});
test("docs: resolved false says the phone's question card stays open and t3ctl answer says NOT_PENDING", () => {
  const read = (...p) => require("fs").readFileSync(path.join(__dirname, "..", ...p), "utf8");
  assert.match(read("README.md").match(/^\| `resolved` \| `false` \|.*$/m)[0], /card stays[\s\S]*NOT_PENDING/);
  assert.match(read("skills", "t3-phone-answers", "SKILL.md"), /With `resolved` off,[^\n]*card can outlive its question[^\n]*NOT_PENDING/);
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
test("filters: a pattern that backtracks without end is cut off at the budget and the event is sent", () => {
  const F = l.compileFilters({ finished: { postWhen: ["(a+)+b"] } }), text = "a".repeat(40), t0 = Date.now();
  const d = l.filterDecision(F, "thread.finished", text, 200);
  const took = Date.now() - t0;
  assert.equal(d.skip, null, "over budget means sent");
  assert.match(d.note, /filters\.finished took longer than 200 ms/);
  assert.ok(took >= 150 && took < 2000, `stopped near the budget (${took} ms)`);
  assert.deepEqual(l.filterDecision(F, "thread.finished", "aab", 200), { skip: null, note: null }, "a fast match is decided normally");
  assert.match(l.filterDecision(F, "thread.finished", "nothing", 200).skip, /no filters\.finished\.postWhen/);
});
test("filters, live: a runaway pattern doesn't stall the listener; the finish is sent and the next one is still judged", async () => {
  const f = await startFake({ filters: { finished: { postWhen: ["(a+)+b"] } } });
  try {
    const run = (id) => ({ id, status: "running", startedAt: now() });
    f.setThread(busy("A", "a1"), { runs: [run("a1")], turnItems: [] });
    f.setThread(busy("B", "b1"), { runs: [run("b1")], turnItems: [] });
    f.start(); await f.waitFor(() => /watching 2 threads/.test(f.out), 8000, "first snapshot");
    f.update(idle("A", "a1"), { runs: [{ ...run("a1"), status: "completed", completedAt: now() }], turnItems: [{ type: "assistant_message", runId: "a1", text: "a".repeat(60) }] });
    f.update(idle("B", "b1"), { runs: [{ ...run("b1"), status: "completed", completedAt: now() }], turnItems: [{ type: "assistant_message", runId: "b1", text: "All done." }] });
    await f.waitFor(() => /not sent: thread\.finished "Thread B"/.test(f.out), 8000, "the second finish to be judged");
    assert.deepEqual(f.posts.map((e) => [e.event, e.runId]), [["thread.finished", "a1"]]);
    assert.match(f.out, /thread\.finished "Thread A" a1 is sent: filters\.finished took longer than 1000 ms on this reply/);
  } finally { await f.close(); }
});
test("filters, live: off by default, every run end and question event is posted as before", async () => {
  const f = await startFake();
  try {
    const run = (id, status = "running", extra = {}) => ({ id, status, startedAt: "2026-11-07T04:00:00Z", ...extra });
    const req = { id: "req-9", kind: "user_input", status: "pending", createdAt: now(), responseCapability: { type: "resumable" } };
    const item = { type: "user_input_request", requestId: "req-9", questions: [{ id: "q", question: "Which?", options: [{ label: "Blue" }] }] };
    f.setThread(busy("F", "f1"), { runs: [run("f1")], turnItems: [] });
    f.setThread(busy("C", "c1"), { runs: [run("c1")], turnItems: [] });
    f.setThread(busy("X", "x1"), { runs: [run("x1")], turnItems: [] });
    f.setThread({ ...busy("Q", "q1"), pendingRuntimeRequest: { id: "req-9" } }, { runs: [run("q1")], turnItems: [item], runtimeRequests: [req] });
    f.start(); await f.waitFor(() => f.posts.length === 1, 8000, "the open question");
    f.update(idle("F", "f1"), { runs: [run("f1", "completed", { completedAt: now() })], turnItems: [{ type: "assistant_message", runId: "f1", text: "Done." }] });
    f.update(idle("C", "c1"), { runs: [run("c1", "interrupted", { completedAt: now() })], turnItems: [] });
    f.update({ ...busy("X", "x1"), status: "failed", activeRunId: null }, { runs: [run("x1", "failed", { completedAt: now() })], turnItems: [{ type: "error", runId: "x1", text: "boom" }] });
    f.update({ ...busy("Q", "q1"), pendingRuntimeRequest: null }, { runs: [run("q1")], turnItems: [item], runtimeRequests: [{ ...req, status: "resolved", resolvedAt: now() }] });
    await f.waitFor(() => f.posts.length === 5, 8000, "all five events");
    await sleep(300);
    assert.deepEqual(f.posts.map((e) => e.event).sort(), ["request.opened", "request.resolved", "thread.cancelled", "thread.failed", "thread.finished"]);
    assert.ok(!/is not a setting|filters/.test(f.out), "nothing about filters is logged");
  } finally { await f.close(); }
});
test("filters, live: a T3 that puts no run ids on its items still judges the newest run by the newest reply", async () => {
  const f = await startFake({ filters: { finished: { postWhen: ["^BLOCKED"] } } });
  try {
    const r1 = { id: "o1", ordinal: 1, status: "completed", startedAt: "2026-11-07T04:00:00Z", completedAt: "2026-11-07T04:05:00Z" };
    const r2 = { id: "o2", ordinal: 2, status: "running", startedAt: now() };
    f.setThread(busy("O", "o2"), { runs: [r1, r2], turnItems: [{ type: "assistant_message", text: "BLOCKED: old run" }] });
    f.start(); await f.waitFor(() => /watching 1 threads/.test(f.out), 8000, "first snapshot");
    f.update(idle("O", "o2"), { runs: [r1, { ...r2, status: "completed", completedAt: now() }], turnItems: [{ type: "assistant_message", text: "BLOCKED: old run" }, { type: "assistant_message", text: "All done." }] });
    await f.waitFor(() => /not sent: thread\.finished "Thread O"/.test(f.out), 8000, "the filter decision");
    assert.deepEqual(f.posts, []);
    assert.ok(!/no reply/.test(f.out), "the newest reply counts as the newest run's own reply");
  } finally { await f.close(); }
});
test("state, live: a save Windows refuses while another process has listen-state.json open is retried, so the event isn't lost", async () => {
  const f = await startFake();
  try {
    f.setThread(busy("W", "w1"), { runs: [{ id: "w1", status: "running", startedAt: now() }], turnItems: [] });
    f.start(); await f.waitFor(() => /watching 1 threads/.test(f.out), 8000, "first snapshot");
    const fs = require("fs"), fd = fs.openSync(path.join(f.dir, "listen-state.json"), "r");
    setTimeout(() => fs.closeSync(fd), 300);
    f.update(idle("W", "w1"), { runs: [{ id: "w1", status: "completed", startedAt: now(), completedAt: now() }], turnItems: [{ type: "assistant_message", runId: "w1", text: "Done." }] });
    await f.waitFor(() => f.posts.length === 1, 8000, "the finish");
    assert.equal(f.posts[0].runId, "w1"); assert.ok(!/EPERM|error:/.test(f.out), f.out);
  } finally { await f.close(); }
});
test("reliability settings: catch-up is capped at 30 minutes by default, the rest are off; bad values fall back to the defaults", () => {
  assert.deepEqual(l.reliability({}), { catchUpMinutes: 30, runEndsPerMinute: 10, failureWaveMs: 0, failureWaveMaxMs: 120000, repeatFailureMs: 0 });
  assert.equal(l.reliability({ runEndsPerMinute: 3 }).runEndsPerMinute, 3);
  assert.equal(l.reliability({ runEndsPerMinute: 0 }).runEndsPerMinute, 0, "0 combines every run end");
  assert.equal(l.settingsLine({ runEndsPerMinute: 3 }), "run ends combined above 3 a minute");
  assert.equal(l.reliability({ catchUpMinutes: 100000 }).catchUpMinutes, 100000, "a large number brings back the old reach");
  assert.deepEqual(l.reliability({ catchUpMinutes: 2, failureWaveSeconds: 20, failureWaveMaxSeconds: 90, repeatFailureHours: 6 }),
    { catchUpMinutes: 2, runEndsPerMinute: 10, failureWaveMs: 20000, failureWaveMaxMs: 90000, repeatFailureMs: 6 * 3600e3 });
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
  const carried = l.summary({ ...f(4, "2026-11-03T10:00:00Z"), completedAtLocal: "now", error: "context window exceeded", repeatsSuppressed: 3, repeatsSince: "2026-11-03T04:00:00Z" });
  assert.match(carried, /3 repeat\(s\) of this thread's previous failure were held back since/);
  assert.doesNotMatch(carried, /same error/, "the count can ride on a failure with a different error");
  assert.match(l.summary(l.batchEvent([{ ...f(5, "2026-11-03T10:00:00Z"), repeatsSuppressed: 2 }, f(6, "2026-11-03T10:00:01Z")], "m")), /"Thread 5" \(p\): boom \(2 repeat\(s\) of its previous failure held back\)/);
  const mixed = l.batchEvent([f(7, "2026-11-03T10:00:10Z"), f(8, "2026-11-03T10:00:09.500Z")], "m");
  assert.deepEqual([mixed.firstAt, mixed.lastAt], ["2026-11-03T10:00:09.500Z", "2026-11-03T10:00:10Z"], "times are compared as instants, not as text");
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
    assert.deepEqual(f.posts.map((e) => [e.event, e.runId, e.usageLimit, e.autoResumeSet, e.count]), [["thread.failed", "f1", true, true, undefined], ["thread.missed.summary", undefined, undefined, undefined, 1]], "the finish is capped and only counted, the failure is not");
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
test("repeat holds, live: the failure that carries the held count keeps it when the listener crashes before sending it", async () => {
  const f = await fakeT3.startFake({ repeatFailureHours: 1.5 / 3600 });
  try {
    const fail = async (runId) => {
      f.update(busyT("A", runId), { runs: [{ id: runId, status: "running", startedAt: isoNow() }], turnItems: [] });
      await fakeT3.sleep(150);
      f.update(failedT("A", runId), { runs: [failRun(runId)], turnItems: [errItem(runId, "Provider error 503")] });
      await f.waitFor(() => !!f.state() && !!f.state().finished[runId], 8000, `failure ${runId}`);
    };
    f.setThread(busyT("A", "r0"), { runs: [], turnItems: [] });
    f.start(); await f.waitFor(() => /watching 1 threads/.test(f.out), 8000, "first snapshot");
    await fail("r1"); await f.waitFor(() => f.posts.length === 1, 8000, "the first failure");
    await fail("r2"); await f.waitFor(() => /held back thread\.failed/.test(f.out), 8000, "the repeat to be held");
    await fakeT3.sleep(1800);
    f.setHookStatus((e) => (e.event === "thread.failed" ? 400 : 200));
    await fail("r3"); await f.waitFor(() => /webhook answered HTTP 400 for thread\.failed/.test(f.out), 8000, "the refused send");
    await f.stop(); f.setHookStatus(() => 200); f.start();
    await f.waitFor(() => f.posts.length === 2, 8000, "the resend after the restart");
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
test("repeat holds, live: a sub-task's usage-limit stop is never held, since sub-tasks are never resumed on their own", async () => {
  const f = await fakeT3.startFake({ repeatFailureHours: 6 });
  try {
    const S = "thread:delegated-task:S", reset = new Date(Date.now() + 3600e3).toISOString();
    const limitFail = async (runId, resets) => {
      f.update(busyT(S, runId), { runs: [{ id: runId, status: "running", startedAt: isoNow() }], turnItems: [] });
      await fakeT3.sleep(150);
      f.update(failedT(S, runId, { usageLimitResetAt: reset, lastErrorClass: "usage_limit" }), { runs: [failRun(runId, { lastErrorClass: "usage_limit", usageLimitResetAt: reset })], turnItems: [errItem(runId, `You've hit your usage limit. Resets at ${resets}`)] });
      await f.waitFor(() => !!f.state() && !!f.state().finished[runId], 8000, `run ${runId}`);
    };
    f.setThread(busyT(S, "s0"), { runs: [], turnItems: [] });
    f.start(); await f.waitFor(() => /watching 1 threads/.test(f.out), 8000, "first snapshot");
    await limitFail("s1", "5:00 AM"); await f.waitFor(() => f.posts.length === 1, 8000, "the first stop");
    await limitFail("s2", "10:00 AM"); await f.waitFor(() => f.posts.length === 2 || /held back thread\.failed/.test(f.out), 8000, "the second stop");
    await fakeT3.sleep(300);
    assert.deepEqual(f.posts.map((e) => [e.runId, e.delegated]), [["s1", true], ["s2", true]]);
    assert.deepEqual(f.commands, [], "sub-tasks are never armed");
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
test("state, live: a save Windows refuses while another process has listen-state.json open is retried, so the failure isn't lost", async () => {
  const f = await fakeT3.startFake();
  try {
    f.setThread(busyT("W", "w1"), { runs: [{ id: "w1", status: "running", startedAt: isoNow() }], turnItems: [] });
    f.start(); await f.waitFor(() => /watching 1 threads/.test(f.out), 8000, "first snapshot");
    const fs = require("fs"), fd = fs.openSync(path.join(f.dir, "listen-state.json"), "r");
    setTimeout(() => fs.closeSync(fd), 300);
    f.update(failedT("W", "w1"), { runs: [failRun("w1")], turnItems: [errItem("w1", "boom")] });
    await f.waitFor(() => f.posts.length === 1, 8000, "the failure");
    assert.equal(f.posts[0].runId, "w1"); assert.ok(!/EPERM|error:/.test(f.out), f.out);
  } finally { await f.close(); }
});

test("macOS presence: exact T3 bundle family, bounded command, unknown on failure", () => {
  let calls = 0;
  const exec = (file, args, options) => {
    calls++;
    assert.equal(file, "/usr/bin/osascript");
    assert.equal(options.timeout, 2000);
    assert.deepEqual(options.stdio, ["ignore", "pipe", "ignore"]);
    const vm = require("node:vm");
    for (const [bundle, expected] of [["com.t3tools.t3code", true], ["com.t3tools.t3code.nightly", true],
      ["com.t3tools.T3Code.dev", true], ["com.t3tools.t3code-other", false], ["com.apple.Terminal", false]]) {
      const result = JSON.parse(vm.runInNewContext(args[3], {
        ObjC: { import() {} },
        $: { NSWorkspace: { sharedWorkspace: { frontmostApplication: { bundleIdentifier: { js: bundle } } } },
          CGEventSourceSecondsSinceLastEventType: () => 5 },
      }));
      assert.equal(result.t3, expected, bundle);
      assert.equal(result.idleSeconds, 5);
    }
    return '{"t3":true,"idleSeconds":5}';
  };
  assert.deepEqual(l.readPresence("darwin", exec), { t3: true, idleSeconds: 5 });
  assert.equal(l.readPresence("linux", exec), null);
  assert.equal(calls, 1);
  assert.equal(l.readPresence("darwin", () => { throw new Error("timeout"); }), null);
  assert.equal(l.readPresence("darwin", () => "invalid"), null);
});

test("presence requires foreground T3 and recent input; idle foreground is away", () => {
  for (const idleSeconds of [0, 10, 59.99, 60, 600, l.PRESENT_IDLE_SECONDS - 0.01]) assert.equal(l.presentInT3({ t3: true, idleSeconds }), true);
  for (const p of [null, {}, { t3: false, idleSeconds: 0 }, ...[l.PRESENT_IDLE_SECONDS, l.PRESENT_IDLE_SECONDS + 1, 3600, -1, NaN, Infinity, "5", undefined].map(idleSeconds => ({ t3: true, idleSeconds }))]) {
    assert.equal(l.presentInT3(p), false);
  }
});

test("webhook boundary suppresses all notification kinds while active, sends away and test events", async () => {
  let sends = 0;
  const state = { sent: {}, finished: {} };
  const send = async () => { sends++; return { ok: true, status: 200 }; };
  const config = { url: "https://example.com/events", headers: {}, ...l.presenceSettings({ suppressWhileActive: true }) };
  for (const event of ["request.opened", "thread.finished", "thread.failed", "thread.cancelled"]) {
    assert.deepEqual(await l.post({ event }, { state, config, send, presence: () => ({ t3: true, idleSeconds: 1 }) }), { ok: true, suppressed: true });
  }
  assert.equal(sends, 0);
  for (const presence of [() => null, () => ({ t3: false, idleSeconds: 1 }), () => ({ t3: true, idleSeconds: l.PRESENT_IDLE_SECONDS })]) {
    assert.equal((await l.post({ event: "thread.finished" }, { state, config, send, presence })).status, 200);
  }
  await l.post({ event: "test" }, { state, config, send, presence: () => { throw new Error("test must bypass presence"); } });
  assert.equal(sends, 4);
});

test("failed delivery rechecks presence on retry; suppression survives restart and hides unseen resolution", async () => {
  let active = false, sends = 0;
  const state = { sent: { q: { delivered: false } }, finished: { r: { e: { event: "thread.finished" }, parked: {} } } };
  const opts = { state, config: { url: "https://example.com", headers: {}, ...l.presenceSettings({ suppressWhileActive: true }) },
    presence: () => ({ t3: active, idleSeconds: 1 }),
    send: async () => { sends++; return { ok: false, status: 503, text: async () => "unavailable" }; } };
  const e = { event: "request.opened", requestId: "q" };
  assert.equal((await l.post(e, opts)).retry, true);
  active = true;
  const retry = await l.post(e, opts);
  assert.equal(retry.suppressed, true);
  l.settleDelivery(state, e, retry.suppressed);
  l.settleDelivery(state, { event: "thread.finished", runId: "r" }, true);
  const restored = JSON.parse(JSON.stringify(state));
  assert.equal(restored.sent.q.delivered, true);
  assert.equal(restored.sent.q.suppressed, true);
  assert.deepEqual(restored.finished.r, { suppressed: true }); // no catch-up or parked payload left
  active = false;
  assert.equal((await l.post({ event: "request.resolved", requestId: "q" }, { ...opts, state: restored })).suppressed, true);
  assert.equal(sends, 1);
  restored.sent.q.closing = true;
  l.settleDelivery(restored, { event: "request.resolved", requestId: "q" }, true);
  assert.deepEqual(restored.sent, {});
});

test("presence settings are opt-in with a configurable positive idle window", () => {
  assert.deepEqual(l.presenceSettings({}), { suppressWhileActive: false, activeIdleSeconds: 900 });
  assert.deepEqual(l.presenceSettings({ suppressWhileActive: false }), { suppressWhileActive: false, activeIdleSeconds: 900 });
  assert.deepEqual(l.presenceSettings({ suppressWhileActive: true, activeIdleMinutes: 2.5 }), { suppressWhileActive: true, activeIdleSeconds: 150 });
  for (const value of [null, "true", 1]) assert.throws(() => l.presenceSettings({ suppressWhileActive: value }), /suppressWhileActive/);
  for (const value of [null, "15", 0, -1, NaN, Infinity, Number.MAX_VALUE]) assert.throws(() => l.presenceSettings({ activeIdleMinutes: value }), /activeIdleMinutes/);
  assert.equal(l.presentInT3({ t3: true, idleSeconds: 149 }, 150), true);
  assert.equal(l.presentInT3({ t3: true, idleSeconds: 150 }, 150), false);
});

test("disabled presence does not probe the OS; enabled presence honors the configured window", async () => {
  let sends = 0;
  const opts = { state: { sent: {}, finished: {} }, config: { url: "https://example.com", headers: {}, ...l.presenceSettings({}) },
    send: async () => { sends++; return { ok: true, status: 200 }; },
    presence: () => { throw new Error("disabled setting must not probe the OS"); } };
  assert.equal((await l.post({ event: "thread.finished" }, opts)).status, 200);
  opts.config = { ...opts.config, ...l.presenceSettings({ suppressWhileActive: true, activeIdleMinutes: 1 }) };
  opts.presence = () => ({ t3: true, idleSeconds: 60 });
  assert.equal((await l.post({ event: "thread.finished" }, opts)).status, 200);
  opts.presence = () => ({ t3: true, idleSeconds: 59 });
  assert.equal((await l.post({ event: "thread.finished" }, opts)).suppressed, true);
  assert.equal(sends, 2);
});

test("presence suppresses failure batches and clears each member's retry/catch-up payload", async () => {
  const state = { sent: {}, finished: { a: { e: {}, parked: {} }, b: { e: {} } } };
  const e = { event: "thread.failed.batch", failures: [{ runId: "a" }, { runId: "b" }] };
  const r = await l.post(e, { state, config: l.presenceSettings({ suppressWhileActive: true }),
    presence: () => ({ t3: true, idleSeconds: 0 }), send: () => { throw new Error("batch must not be posted"); } });
  assert.equal(r.suppressed, true);
  l.settleDelivery(state, e, r.suppressed);
  assert.deepEqual(state.finished, { a: { suppressed: true }, b: { suppressed: true } });
});

// Run a real listener against the fake server/webhook; only the native presence
// boundary is replaced in the disposable tool copy. This works on every OS.
const presenceRun = (id, status = "running", extra = {}) => ({ id, status, startedAt: "2026-11-07T04:00:00Z", ...extra });
function mockNativePresence(f, value) {
  const fs = require("fs"), file = path.join(f.dir, "presence-fixture.json"), script = path.join(f.dir, "t3listen");
  fs.writeFileSync(file, JSON.stringify(value));
  const preload = `\n(() => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    const cp = require("child_process"), exec = cp.execFileSync;
    cp.execFileSync = (file, ...args) => file === "/usr/bin/osascript"
      ? require("fs").readFileSync(require("path").join(__dirname, "presence-fixture.json"), "utf8") : exec(file, ...args);
  })();\n`;
  fs.writeFileSync(script, fs.readFileSync(script, "utf8").replace(/^(#![^\n]*\n)/, "$1" + preload));
  return (next) => fs.writeFileSync(file, JSON.stringify(next));
}

test("presence, live: suppression survives restart, unseen question closes quietly, away finish posts", async () => {
  const f = await startFake({ suppressWhileActive: true });
  const setPresence = mockNativePresence(f, { t3: true, idleSeconds: 1 });
  const req = { id: "q-presence", kind: "user_input", status: "pending", createdAt: now(), responseCapability: { type: "resumable" } };
  const item = { type: "user_input_request", requestId: req.id, questions: [{ id: "q", question: "Which?", options: [{ label: "Blue" }] }] };
  try {
    f.setThread(busy("F", "rf"), { runs: [presenceRun("rf")], turnItems: [] });
    f.setThread({ ...busy("Q", "rq"), pendingRuntimeRequest: { id: req.id } }, { runs: [presenceRun("rq")], turnItems: [item], runtimeRequests: [req] });
    f.start(); await f.waitFor(() => f.state()?.sent[req.id]?.suppressed, 8000, "suppressed question");
    f.update(idle("F", "rf"), { runs: [presenceRun("rf", "completed", { completedAt: now() })], turnItems: [] });
    await f.waitFor(() => f.state()?.finished.rf?.suppressed, 8000, "suppressed finish");
    assert.equal(f.posts.length, 0);
    await f.stop(); setPresence({ t3: false, idleSeconds: 1 });
    const watches = f.count(/watching /);
    f.start(); await f.waitFor(() => f.count(/watching /) > watches);
    f.update({ ...busy("Q", "rq"), pendingRuntimeRequest: null }, { runs: [presenceRun("rq")], turnItems: [item], runtimeRequests: [{ ...req, status: "resolved", resolvedAt: now() }] });
    await f.waitFor(() => !f.state()?.sent[req.id], 8000, "quiet resolution");
    f.update(busy("F", "rf2"), { runs: [presenceRun("rf2")], turnItems: [] });
    f.update(idle("F", "rf2"), { runs: [presenceRun("rf2", "completed", { completedAt: now() })], turnItems: [] });
    await f.waitFor(() => f.posts.length === 1);
    assert.equal(f.posts[0].runId, "rf2");
  } finally { await f.close(); }
});

test("presence, live: failure wave batch is suppressed and never replayed after restart", async () => {
  const f = await startFake({ suppressWhileActive: true, failureWaveSeconds: 0.1 });
  const setPresence = mockNativePresence(f, { t3: true, idleSeconds: 1 });
  try {
    for (const id of ["A", "B"]) f.setThread(busy(id, id + "1"), { runs: [presenceRun(id + "1")], turnItems: [] });
    f.start(); await f.waitFor(() => /watching /.test(f.out));
    for (const id of ["A", "B"]) f.update({ ...idle(id, id + "1"), status: "failed" }, { runs: [presenceRun(id + "1", "failed", { completedAt: now() })], turnItems: [] });
    await f.waitFor(() => f.state()?.finished.A1?.suppressed && f.state()?.finished.B1?.suppressed);
    assert.match(f.out, /suppressed thread.failed.batch/);
    assert.equal(f.posts.length, 0);
    await f.stop(); setPresence({ t3: false, idleSeconds: 1 });
    const watches = f.count(/watching /);
    f.start(); await f.waitFor(() => f.count(/watching /) > watches);
    assert.equal(f.posts.length, 0);
  } finally { await f.close(); }
});

test("presence settlement clears only the suppressed run's repeat record, including batch members", () => {
  const state = { sent: {}, finished: { a: { threadId: "A", e: {} }, b: { threadId: "B", e: {} } },
    failRepeat: { A: { runId: "a" }, B: { runId: "newer" } } };
  l.settleDelivery(state, { event: "thread.failed.batch", failures: [{ runId: "a", threadId: "A" }, { runId: "b", threadId: "B" }] }, true);
  assert.deepEqual(state.failRepeat, { B: { runId: "newer" } });
});

test("presence, live: a suppressed failure does not hold back the same error while away after restart", async () => {
  const f = await startFake({ suppressWhileActive: true, repeatFailureHours: 1 });
  const setPresence = mockNativePresence(f, { t3: true, idleSeconds: 1 });
  try {
    f.setThread(busyT("A", "r1"), { runs: [presenceRun("r1")], turnItems: [] });
    f.start(); await f.waitFor(() => /watching /.test(f.out));
    f.update(failedT("A", "r1"), { runs: [failRun("r1")], turnItems: [errItem("r1", "Provider error 503")] });
    await f.waitFor(() => f.state()?.finished.r1?.suppressed);
    assert.equal(f.state().failRepeat.A, undefined);
    assert.equal(f.posts.length, 0);
    await f.stop(); setPresence({ t3: false, idleSeconds: 1 });
    const watches = f.count(/watching /);
    f.start(); await f.waitFor(() => f.count(/watching /) > watches);
    f.update(busyT("A", "r2"), { runs: [presenceRun("r2")], turnItems: [] });
    f.update(failedT("A", "r2"), { runs: [failRun("r2")], turnItems: [errItem("r2", "Provider error 503")] });
    await f.waitFor(() => f.posts.length === 1);
    assert.equal(f.posts[0].runId, "r2");
    assert.equal(f.state().failRepeat.A.runId, "r2");
  } finally { await f.close(); }
});

for (const resolved of [true, false]) test(`presence, live: delivered question cleanup respects filters.resolved=${resolved}`, async () => {
  const f = await startFake({ suppressWhileActive: true, ...(resolved ? {} : { filters: { resolved: false } }) });
  const setPresence = mockNativePresence(f, { t3: false, idleSeconds: 1 });
  const req = { id: "q-close", kind: "user_input", status: "pending", createdAt: now(), responseCapability: { type: "resumable" } };
  const item = { type: "user_input_request", requestId: req.id, questions: [{ id: "q", question: "Which?", options: [{ label: "Blue" }] }] };
  try {
    f.setThread({ ...busy("Q", "rq"), pendingRuntimeRequest: { id: req.id } }, { runs: [presenceRun("rq")], turnItems: [item], runtimeRequests: [req] });
    f.start(); await f.waitFor(() => f.posts.length === 1);
    setPresence({ t3: true, idleSeconds: 1 });
    f.update({ ...busy("Q", "rq"), pendingRuntimeRequest: null }, { runs: [presenceRun("rq")], turnItems: [item], runtimeRequests: [{ ...req, status: "resolved", resolvedAt: now() }] });
    await f.waitFor(() => !f.state()?.sent[req.id]);
    assert.deepEqual(f.posts.map(e => e.event), resolved ? ["request.opened", "request.resolved"] : ["request.opened"]);
  } finally { await f.close(); }
});

test("Windows presence: T3 Code and its Nightly build count, other apps don't; bounded command, unknown on failure", () => {
  const seen = [];
  const exec = (app) => (file, args, options) => { seen.push([file, args.slice(0, 3), options.timeout, options.windowsHide]); return JSON.stringify({ app, idleSeconds: 7.5 }); };
  for (const [app, t3] of [["T3 Code", true], ["T3 Code (Nightly)", true], ["t3 code (nightly)", true], ["T3 Codex", false], ["explorer", false], ["Code", false]]) {
    assert.deepEqual(l.readPresence("win32", exec(app)), { t3, idleSeconds: 7.5 }, app);
  }
  assert.deepEqual(seen[0], ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command"], 5000, true]);
  assert.equal(l.readPresence("win32", () => { throw new Error("timeout"); }), null);
  assert.equal(l.readPresence("win32", () => "not json"), null);
  assert.equal(l.presentInT3(l.readPresence("win32", exec("T3 Code (Nightly)"))), true);
});
test("Windows presence, real probe: on Windows it names the foreground app's state and a non-negative idle time", { skip: process.platform !== "win32" ? "Windows only" : process.env.CI ? "needs a desktop session; a cold CI runner takes longer than the probe's 5 s limit" : false }, () => {
  const p = l.readPresence();
  assert.equal(typeof p.t3, "boolean");
  assert.ok(Number.isFinite(p.idleSeconds) && p.idleSeconds >= 0, JSON.stringify(p));
});
test("presence cache: a burst of events shares one probe; a later event probes again", () => {
  let now = 1000, calls = 0;
  const presence = l.cachedPresence(() => ({ t3: true, idleSeconds: ++calls }), () => now);
  assert.equal(presence().idleSeconds, 1);
  now += l.PRESENCE_CACHE_MS - 1; assert.equal(presence().idleSeconds, 1);
  now += 1; assert.equal(presence().idleSeconds, 2);
  assert.equal(calls, 2);
});
test("settingsLine: active-use suppression is named without an OS, and says when this OS has no probe", () => {
  const line = l.settingsLine({ suppressWhileActive: true });
  assert.match(line, /^active-use suppression \(15 min idle window\)/);
  assert.equal(/no effect on this OS/.test(line), !["darwin", "win32"].includes(process.platform));
  assert.equal(l.settingsLine({ catchUpMinutes: 30 }), "defaults");
});
test("rate limit: 429 or a rate-limit body pauses sending for Retry-After, or 15 minutes; other refusals don't pause", () => {
  const now = Date.parse("2026-11-13T10:00:00Z");
  assert.equal(l.rateLimitPause(200, "", null, now), 0);
  assert.equal(l.rateLimitPause(400, "bad request", null, now), 0);
  assert.equal(l.rateLimitPause(503, "busy", null, now), 0);
  for (const body of ["an accurate limit applies", "too many characters in title", "Last reply: we hit too many errors"]) assert.equal(l.rateLimitPause(400, body, null, now), 0, body);
  assert.equal(l.rateLimitPause(400, "Too Many Requests", null, now), l.RATE_LIMIT_PAUSE_MS);
  assert.equal(l.rateLimitPause(429, "", null, now), l.RATE_LIMIT_PAUSE_MS);
  assert.equal(l.rateLimitPause(400, '{"error":"Automation run rate limit exceeded: 200 per hour"}', null, now), l.RATE_LIMIT_PAUSE_MS);
  assert.equal(l.rateLimitPause(429, "", "1800", now), 1800e3);
  assert.equal(l.rateLimitPause(429, "", "Fri, 13 Nov 2026 10:40:00 GMT", now), 40 * 60000);
  assert.equal(l.rateLimitPause(429, "", "1", now), 60000, "never hammer: at least a minute");
  assert.equal(l.rateLimitPause(429, "", "9999999", now), 864e5, "never silent for more than a day");
  assert.equal(l.rateLimitPause(429, "", "soon", now), l.RATE_LIMIT_PAUSE_MS);
});
test("stale run ends: a finish or cancel older than an hour is counted, a failure or question never is", () => {
  const now = Date.now(), old = now - l.RUN_END_KEEP_MS - 1;
  assert.equal(l.staleRunEnd({ event: "thread.finished" }, old, now), true);
  assert.equal(l.staleRunEnd({ event: "thread.cancelled" }, old, now), true);
  assert.equal(l.staleRunEnd({ event: "thread.finished" }, now - 60000, now), false);
  for (const event of ["thread.failed", "thread.failed.batch", "request.opened", "request.resolved", "thread.missed.summary"]) assert.equal(l.staleRunEnd({ event }, old, now), false, event);
});
test("missed summary: counts every run end, lists each thread once (20 at most), spans first to last", () => {
  const m = l.newMissed();
  l.noteMissed(m, { title: "B", completedAt: "2026-11-13T09:00:00Z" });
  l.noteMissed(m, { title: "A", completedAt: "2026-11-13T07:00:00Z" });
  l.noteMissed(m, { title: "B", completedAt: "2026-11-13T08:00:00Z" });
  for (let i = 0; i < 30; i++) l.noteMissed(m, { title: `T${i}` });
  const e = l.missedEvent(m, "laptop");
  assert.deepEqual([e.event, e.kind, e.machine, e.count, e.firstAt, e.lastAt, e.threads.length, e.threads.slice(0, 2)],
    ["thread.missed.summary", "thread-missed-summary", "laptop", 33, "2026-11-13T07:00:00Z", "2026-11-13T09:00:00Z", 20, ["B", "A"]]);
  assert.match(l.summary(e), /^T3 on laptop: 33 run end\(s\) between .+ were not sent one by one\nThreads: "B", "A", .+, \.\.\.$/);
});
const doneT = (id, runId) => ({ id, title: `Thread ${id}`, status: "idle", activeRunId: null, latestRunId: runId });
const doneRun = (id, completedAt = isoNow()) => ({ runs: [{ id, status: "completed", startedAt: "2026-11-07T04:00:00Z", completedAt }], turnItems: [{ type: "assistant_message", runId: id, text: "Done." }] });
test("issue 40, live: finishes from a long outage arrive as one summary, once, and never as one message each", async () => {
  const f = await fakeT3.startFake({ catchUpMinutes: 0 });
  try {
    f.start(); await f.waitFor(() => /watching 0 threads/.test(f.out), 8000, "first snapshot");
    await f.stop();
    for (const id of ["A", "B", "C"]) f.setThread(doneT(id, `${id}1`), doneRun(`${id}1`));
    await fakeT3.sleep(50);
    f.start(); await f.waitFor(() => f.posts.length >= 1, 9000, "summary"); await fakeT3.sleep(300);
    assert.deepEqual(f.posts.map((e) => [e.event, e.count, [...e.threads].sort()]), [["thread.missed.summary", 3, ["Thread A", "Thread B", "Thread C"]]]);
    assert.match(f.posts[0].text, /3 run end\(s\)/);
    await f.stop(); f.start(); await f.waitFor(() => f.count(/watching 3 threads/) === 2, 9000, "second restart"); await fakeT3.sleep(300);
    assert.equal(f.posts.length, 1, "counted once: a second restart sends nothing more");
  } finally { await f.close(); }
});
test("issue 40, live: with filters.finished false, old finishes aren't even counted", async () => {
  const f = await fakeT3.startFake({ catchUpMinutes: 0, filters: { finished: false } });
  try {
    f.start(); await f.waitFor(() => /watching 0 threads/.test(f.out), 8000, "first snapshot");
    await f.stop();
    f.setThread(doneT("A", "a1"), doneRun("a1")); await fakeT3.sleep(50);
    f.start(); await f.waitFor(() => /watching 1 threads/.test(f.out), 9000, "restart"); await fakeT3.sleep(400);
    assert.deepEqual(f.posts, []);
  } finally { await f.close(); }
});
test("issue 40, live: after a rate-limit reply nothing more is posted; the finishes are combined, also across a restart", async () => {
  const f = await fakeT3.startFake();
  try {
    f.setHookStatus(() => ({ status: 400, body: '{"error":"Automation run rate limit exceeded: 200 per hour"}', headers: { "retry-after": "3600" } }));
    f.start(); await f.waitFor(() => /watching 0 threads/.test(f.out), 8000, "first snapshot");
    const finish = async (id) => {
      f.update(busyT(id, `${id}1`), { runs: [{ id: `${id}1`, status: "running", startedAt: isoNow() }], turnItems: [] });
      await fakeT3.sleep(150);
      f.update(doneT(id, `${id}1`), doneRun(`${id}1`));
    };
    for (const id of ["A", "B", "C"]) await finish(id);
    await f.waitFor(() => ((f.state() || {}).missed || {}).count === 3, 9000, "three finishes combined");
    assert.equal(f.hits, 1, "one refused post, then silence: no in-line retries and no posts for the next events");
    assert.equal(f.count(/webhook is rate limited; nothing is sent until/), 1);
    assert.deepEqual(Object.values(f.state().finished).filter((x) => x.e), [], "no finish is left to be resent on its own");
    await f.stop(); f.start(); await f.waitFor(() => f.count(/watching 3 threads/) === 1, 9000, "restart");
    await finish("D");
    await f.waitFor(() => f.state().missed.count === 4, 9000, "fourth finish combined"); await fakeT3.sleep(400);
    assert.equal(f.hits, 1, "the pause survives a restart: nothing is posted into the rate limit");
    assert.deepEqual(f.posts, []);
  } finally { await f.close(); }
});
test("issue 40, live: a finish the webhook refused more than an hour ago isn't resent after a restart; it goes into the summary", async () => {
  const f = await fakeT3.startFake();
  try {
    f.setHookStatus(() => 400);
    f.start(); await f.waitFor(() => /watching 0 threads/.test(f.out), 8000, "first snapshot");
    f.update(busyT("A", "a1"), { runs: [{ id: "a1", status: "running", startedAt: isoNow() }], turnItems: [] });
    await fakeT3.sleep(150);
    f.update(doneT("A", "a1"), doneRun("a1"));
    await f.waitFor(() => ((f.state() || {}).finished || {}).a1 && f.state().finished.a1.e, 9000, "finish saved");
    await f.stop();
    const file = path.join(f.dir, "listen-state.json"), st = f.state();
    st.finished.a1.at -= 2 * 3600e3; require("fs").writeFileSync(file, JSON.stringify(st));
    f.setHookStatus(() => 200); f.start();
    await f.waitFor(() => f.posts.length >= 1, 9000, "summary"); await fakeT3.sleep(300);
    assert.deepEqual(f.posts.map((e) => [e.event, e.count, e.threads]), [["thread.missed.summary", 1, ["Thread A"]]]);
    assert.equal(f.state().finished.a1.e, undefined, "the stale finish is settled, so no later restart sends it");
  } finally { await f.close(); }
});

test("issue 40, live: a lost connection in the same process is capped like a restart, so its finishes are counted, not sent one by one", async () => {
  const f = await fakeT3.startFake({ catchUpMinutes: 0 });
  try {
    f.start(); await f.waitFor(() => /watching 0 threads/.test(f.out), 8000, "first snapshot");
    await fakeT3.sleep(100);
    for (const id of ["A", "B"]) f.setThread(doneT(id, `${id}1`), doneRun(`${id}1`));
    f.dropSockets();
    await f.waitFor(() => f.posts.length >= 1, 15000, "summary after the reconnect"); await fakeT3.sleep(300);
    assert.deepEqual(f.posts.map((e) => [e.event, e.count]), [["thread.missed.summary", 2]]);
  } finally { await f.close(); }
});
test("issue 40, live: a summary the webhook refused is kept across a restart and sent once it is accepted", async () => {
  const f = await fakeT3.startFake({ catchUpMinutes: 0 });
  try {
    f.start(); await f.waitFor(() => /watching 0 threads/.test(f.out), 8000, "first snapshot");
    await f.stop();
    for (const id of ["A", "B", "C"]) f.setThread(doneT(id, `${id}1`), doneRun(`${id}1`));
    f.setHookStatus(() => 503); await fakeT3.sleep(50);
    f.start(); await f.waitFor(() => /thread\.missed\.summary \(3 run ends\) not sent/.test(f.out), 9000, "refused summary");
    assert.equal(f.state().missed.count, 3, "the count stays saved");
    await f.stop(); f.setHookStatus(() => 200); f.start();
    await f.waitFor(() => f.posts.length >= 1, 9000, "summary after the restart"); await fakeT3.sleep(300);
    assert.deepEqual(f.posts.map((e) => [e.event, e.count, e.threads.length]), [["thread.missed.summary", 3, 3]]);
    assert.equal(f.state().missed.count, 0);
  } finally { await f.close(); }
});

test("run-end budget: 10 a minute go out on their own; the next one must be combined until the minute has passed", () => {
  const sent = [], t0 = 1e6;
  for (let i = 0; i < l.RUN_ENDS_PER_MINUTE; i++) assert.equal(l.runEndBudget(sent, t0 + i * 1000), true, `send ${i}`);
  assert.equal(l.runEndBudget(sent, t0 + 20000), false);
  assert.equal(sent.length, l.RUN_ENDS_PER_MINUTE, "a refused one doesn't use up budget");
  assert.equal(l.runEndBudget(sent, t0 + 59999), false);
  assert.equal(l.runEndBudget(sent, t0 + 60000), true, "the first send has aged out");
  const few = [];
  assert.deepEqual([1, 2, 3].map((i) => l.runEndBudget(few, t0 + i, 2)), [true, true, false], "the limit comes from the setting");
  assert.equal(l.runEndBudget([], t0, 0), false, "0 sends none on its own");
});
test("issue 40, live: a burst of finishes sends 10 on their own and the rest as one summary; a failure in the burst is still sent", async () => {
  const f = await fakeT3.startFake();
  try {
    f.start(); await f.waitFor(() => /watching 0 threads/.test(f.out), 8000, "first snapshot");
    const ids = Array.from({ length: 14 }, (_, i) => `T${i}`);
    for (const id of ids) f.update(busyT(id, `${id}r`), { runs: [{ id: `${id}r`, status: "running", startedAt: isoNow() }], turnItems: [] });
    f.update(busyT("F", "f1"), { runs: [{ id: "f1", status: "running", startedAt: isoNow() }], turnItems: [] });
    await fakeT3.sleep(300);
    for (const id of ids) f.update(doneT(id, `${id}r`), doneRun(`${id}r`));
    f.update(failedT("F", "f1"), { runs: [failRun("f1")], turnItems: [errItem("f1", "boom")] });
    await f.waitFor(() => f.posts.some((e) => e.event === "thread.missed.summary"), 20000, "summary");
    await fakeT3.sleep(300);
    const by = (name) => f.posts.filter((e) => e.event === name);
    assert.equal(by("thread.finished").length, 10);
    assert.deepEqual(by("thread.missed.summary").map((e) => [e.count, e.threads.length]), [[4, 4]]);
    assert.deepEqual(by("thread.failed").map((e) => e.runId), ["f1"]);
    assert.equal(f.posts.length, 12, "14 finishes and a failure cost 12 posts, not 15");
  } finally { await f.close(); }
});

test("catch-up, live: a thread with many old runs is read once, not once per run", async () => {
  const f = await fakeT3.startFake({ catchUpMinutes: 0 });
  try {
    f.start(); await f.waitFor(() => /watching 0 threads/.test(f.out), 8000, "first snapshot");
    await f.stop();
    const runs = Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, ordinal: i, status: "completed", startedAt: "2026-11-07T04:00:00Z", completedAt: isoNow() }));
    f.setThread(doneT("A", "r11"), { runs, turnItems: [] });
    await fakeT3.sleep(50);
    const before = f.reads("A");
    f.start(); await f.waitFor(() => f.posts.length >= 1, 9000, "summary"); await fakeT3.sleep(300);
    assert.deepEqual(f.posts.map((e) => [e.event, e.count]), [["thread.missed.summary", 12]]);
    assert.equal(f.reads("A") - before, 1, "one read of the thread for its 12 runs");
  } finally { await f.close(); }
});

test("autostart node path: a Homebrew Cellar path becomes its opt link when that exists; any other path is kept", () => {
  const yes = () => true, no = () => false;
  assert.equal(l.stableNode("/opt/homebrew/Cellar/node@24/24.22.1/bin/node", yes), "/opt/homebrew/opt/node@24/bin/node");
  assert.equal(l.stableNode("/usr/local/Cellar/node/23.1.0_1/bin/node", yes), "/usr/local/opt/node/bin/node");
  assert.equal(l.stableNode("/home/linuxbrew/.linuxbrew/Cellar/node/23.1.0/bin/node", yes), "/home/linuxbrew/.linuxbrew/opt/node/bin/node");
  assert.equal(l.stableNode("/opt/homebrew/Cellar/node@24/24.22.1/bin/node", no), "/opt/homebrew/Cellar/node@24/24.22.1/bin/node", "no link: keep what runs now");
  for (const p of ["/usr/bin/node", "C:\\Program Files\\nodejs\\node.exe", "/Users/x/.nvm/versions/node/v24.0.0/bin/node"]) assert.equal(l.stableNode(p, yes), p);
});
test("issue 40, live: the summary leaves out old finishes that filters.finished.skipWhen would hold back", async () => {
  const f = await fakeT3.startFake({ catchUpMinutes: 0, filters: { finished: { skipWhen: ["^Nothing to do"] } } });
  try {
    f.start(); await f.waitFor(() => /watching 0 threads/.test(f.out), 8000, "first snapshot");
    await f.stop();
    const reply = (id, text) => ({ runs: [{ id, status: "completed", startedAt: "2026-11-07T04:00:00Z", completedAt: isoNow() }], turnItems: [{ type: "assistant_message", runId: id, text }] });
    f.setThread(doneT("A", "a1"), reply("a1", "Nothing to do here."));
    f.setThread(doneT("B", "b1"), reply("b1", "Shipped the fix."));
    await fakeT3.sleep(50);
    f.start(); await f.waitFor(() => f.posts.length >= 1, 9000, "summary"); await fakeT3.sleep(300);
    assert.deepEqual(f.posts.map((e) => [e.event, e.count, e.threads]), [["thread.missed.summary", 1, ["Thread B"]]]);
  } finally { await f.close(); }
});
test("issue 40, live: old finishes of a thread that is running again are counted, not left for a later restart", async () => {
  const f = await fakeT3.startFake({ catchUpMinutes: 0 });
  try {
    f.start(); await f.waitFor(() => /watching 0 threads/.test(f.out), 8000, "first snapshot");
    await f.stop();
    const done = (id, ordinal) => ({ id, ordinal, status: "completed", startedAt: "2026-11-07T04:00:00Z", completedAt: isoNow() });
    f.setThread(busyT("A", "a3"), { runs: [done("a1", 1), done("a2", 2), { id: "a3", ordinal: 3, status: "running", startedAt: isoNow() }], turnItems: [] });
    await fakeT3.sleep(50);
    f.start(); await f.waitFor(() => f.posts.length >= 1, 9000, "summary"); await fakeT3.sleep(300);
    assert.deepEqual(f.posts.map((e) => [e.event, e.count]), [["thread.missed.summary", 2]]);
  } finally { await f.close(); }
});
