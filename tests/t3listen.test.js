// Unit tests for t3listen's pure helpers. Run: node --test tests/*.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const l = require(path.join(__dirname, "..", "tools", "t3listen"));

test("pickThread: id, id prefix, or newest title match", () => {
  const ts = [{ id: "aaa111", title: "Snig PR review", updatedAt: "2026-01-01T00:00:00Z" }, { id: "bbb222", title: "Snig fixes", updatedAt: "2026-01-03T00:00:00Z" }, { id: "ccc333", title: "Other", updatedAt: "2026-01-02T00:00:00Z" }];
  assert.equal(l.pickThread(ts, "aaa111").id, "aaa111");
  assert.equal(l.pickThread(ts, "ccc").id, "ccc333");
  assert.equal(l.pickThread(ts, "snig").id, "bbb222");
  assert.equal(l.pickThread(ts, "pr review").id, "aaa111");
  assert.equal(l.pickThread(ts, "nothing like it"), null);
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
