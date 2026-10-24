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
