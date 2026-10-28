// Shared thread lookup used by t3ctl and t3listen. Run: node --test tests/thread-match.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const tm = require(path.join(__dirname, "..", "tools", "thread-match"));

const live = { id: "live-1", title: "Release follow up", updatedAt: "2026-10-02" };
const old = { id: "arch-1", title: "Release", updatedAt: "2026-10-01" };
const notes = { id: "arch-2", title: "Release notes", updatedAt: "2026-09-01" };
const down = async () => { throw new Error("archive rpc down"); };

test("lookupThread: exact archived title wins, and a failed archive read is named only on NOT_FOUND", async () => {
  const listed = [live];
  assert.equal((await tm.lookupThread("Release", listed, async () => [old, notes])).id, "arch-1");
  assert.equal((await tm.lookupThread("follow", listed, down)).id, "live-1");
  await assert.rejects(() => tm.lookupThread("Shipped last week", listed, down),
    /^Error: NOT_FOUND: no thread matches "Shipped last week"[\s\S]*T3's archived threads couldn't be checked: archive rpc down\)$/);
  await assert.rejects(() => tm.lookupThread("Rel", [live, { id: "live-2", title: "Release notes", updatedAt: "2026-09-01" }], down),
    /^Error: AMBIGUOUS: 2 threads/);
  await assert.rejects(() => tm.lookupThread("missing", listed, async () => []),
    (err) => err.message.startsWith("NOT_FOUND:") && !/couldn't be checked/.test(err.message));
});
