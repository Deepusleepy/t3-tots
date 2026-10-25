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
  for (const q of ["aaaa1111-0000", "cccc3333", "pr review", "OTHER", "snig", "aaaa", "ccc", "nothing like it", "aaaa"]) {
    const run = (f) => { try { return f(ts, q).id; } catch (e) { return e.message.split(":")[0]; } };
    assert.equal(run(l.pickThread), run(t3ctl.pickThread), `t3listen and t3ctl disagree on "${q}"`);
  }
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
