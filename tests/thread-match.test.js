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

test("t3ctl and t3listen without thread-match.js next to them print TOOLS_INCOMPLETE, not a stack trace", () => {
  const fs = require("fs"), os = require("os"), { spawnSync } = require("child_process");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "t3tots-partial-"));
  try {
    for (const tool of ["t3ctl", "t3listen"]) {
      fs.copyFileSync(path.join(__dirname, "..", "tools", tool), path.join(tmp, tool));
      const r = spawnSync(process.execPath, [path.join(tmp, tool), "help"], { encoding: "utf8" });
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stderr, new RegExp(`^TOOLS_INCOMPLETE: thread-match.js must be next to ${tool}\.`));
      assert.doesNotMatch(r.stderr, /Require stack/);
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("lookupThread: a thread in both the shell list and T3's archived list is one match, not AMBIGUOUS", async () => {
  const arch = { id: "arch-1", title: "Old archived thread", updatedAt: "2026-09-01" };
  assert.equal((await tm.lookupThread("archived", [live, arch], async () => [{ ...arch }])).id, "arch-1");
});
