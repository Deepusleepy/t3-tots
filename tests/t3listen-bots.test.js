// Bots and subscriptions: who gets which events, and that one bot's trouble never reaches another.
// Live tests run the real t3listen against the stand-in T3 server and one webhook per bot (tests/fake-t3.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const l = require(path.join(__dirname, "..", "tools", "t3listen"));
const { startFake, sleep } = require("./fake-t3");

const isoNow = () => new Date().toISOString();
const busy = (id, projectId) => ({ id, title: `Thread ${id}`, status: "running", activeRunId: `${id}1`, latestRunId: `${id}1`, projectId });
const done = (id, projectId) => ({ id, title: `Thread ${id}`, status: "idle", activeRunId: null, latestRunId: `${id}1`, projectId });
const failed = (id, projectId) => ({ id, title: `Thread ${id}`, status: "failed", activeRunId: null, latestRunId: `${id}1`, projectId });
const running = (id) => ({ runs: [{ id: `${id}1`, status: "running", startedAt: isoNow() }], turnItems: [] });
const doneRun = (id) => ({ runs: [{ id: `${id}1`, status: "completed", startedAt: "2026-11-07T04:00:00Z", completedAt: isoNow() }], turnItems: [{ type: "assistant_message", runId: `${id}1`, text: "Done." }] });
const failRun = (id) => ({ runs: [{ id: `${id}1`, status: "failed", startedAt: "2026-11-07T04:00:00Z", completedAt: isoNow() }], turnItems: [{ type: "error", runId: `${id}1`, text: `boom ${id}` }] });
const P1 = [{ id: "p1", title: "proj" }], P2 = [{ id: "p2", title: "other" }];
const runIds = (posts) => posts.map((e) => e.runId).sort();
async function finish(f, id, projectId, how = "done") {
  f.update(busy(id, projectId), running(id)); await sleep(150);
  if (how === "failed") f.update(failed(id, projectId), failRun(id)); else f.update(done(id, projectId), doneRun(id));
}

test("rules: every bot gets an event unless it has only-rules and none matches, or a skip-rule matches", () => {
  const routing = l.compileRouting({
    main: { skip: [{ projects: P2 }] },
    bots: { site: { url: "https://a.example/h", only: [{ projects: ["p1"] }] }, fails: { url: "https://b.example/h", only: [{ events: ["failed"] }], skip: [{ projects: ["p1"], events: ["failed"] }] } },
  });
  const to = (pid, group) => l.routeNames(routing, pid, group).join(",");
  assert.equal(to("p1", "finished"), "main,site");
  assert.equal(to("p1", "failed"), "main,site", "fails skips p1's failures");
  assert.equal(to("p2", "finished"), "", "the main bot unsubscribed and no other bot wants it: nobody gets it");
  assert.equal(to("p2", "failed"), "fails");
  assert.equal(to("p3", "questions"), "main");
  assert.equal(to(null, "failed"), "main,fails", "an event with no project still follows the event rules");
  assert.equal(l.routeNames(l.compileRouting({}), "p9", "finished").join(","), "main", "no bots and no rules: the main bot gets everything, as before");
});
test("rules: event groups, and config mistakes are named without showing a URL or key", () => {
  assert.deepEqual([{ event: "thread.finished" }, { event: "thread.cancelled" }, { event: "thread.failed" }, { event: "thread.failed.batch" }, { event: "request.opened", kind: "user_input" },
    { event: "request.resolved", kind: "user_input" }, { event: "request.opened", kind: "command" }, { event: "thread.missed.summary" }, { event: "test" }].map(l.eventGroup),
  ["finished", "cancelled", "failed", "failed", "questions", "questions", "approvals", null, null]);
  for (const [conf, re] of [[{ bots: { main: { url: "https://a.example/secret-path" } } }, /"main" is not a usable bot name/], [{ bots: { "a b": { url: "https://a.example/secret-path" } } }, /not a usable bot name/],
    [{ bots: { x: { url: "http://evil.example/secret-path" } } }, /bots\.x\.url must start with https/], [{ bots: { x: {} } }, /bots\.x\.url/],
    [{ main: { skip: [{ events: ["finish"] }] } }, /main\.skip\[0\]\.events has "finish"/], [{ main: { only: [{ projects: [] }] } }, /main\.only\[0\]\.projects/], [{ main: { skip: [7] } }, /main\.skip\[0\] must be an object/]]) {
    assert.throws(() => l.compileRouting(conf), (err) => re.test(err.message) && !/secret-path/.test(err.message), JSON.stringify(conf));
  }
});
test("bots, live: a project bot gets its project, a second bot may share it, the main bot stops when it unsubscribes, and a project nobody wants is silent", async () => {
  const f = await startFake();
  try {
    const site = await f.addHook(), team = await f.addHook();
    f.writeConfig({ main: { skip: [{ projects: P1 }, { projects: P2, events: ["finished"] }] }, bots: { site: { url: site.url, only: [{ projects: P1 }] }, team: { url: team.url, only: [{ projects: P1, events: ["failed"] }] } } });
    f.start(); await f.waitFor(() => /watching 0 threads/.test(f.out), 8000, "first snapshot");
    await finish(f, "A", "p1"); await finish(f, "B", "p1", "failed"); await finish(f, "C", "p2"); await finish(f, "D", "p2", "failed");
    await f.waitFor(() => site.posts.length === 2 && team.posts.length === 1 && f.posts.length === 1, 9000, "each bot's events");
    await sleep(400);
    assert.deepEqual(runIds(site.posts), ["A1", "B1"], "the project bot gets its whole project");
    assert.deepEqual(runIds(team.posts), ["B1"], "a second bot on the same project gets its own copy of what it asked for");
    assert.deepEqual(runIds(f.posts), ["D1"], "the main bot keeps what it didn't unsubscribe from");
    assert.equal(f.count(/no bot is subscribed: thread\.finished/), 1, "p2's finish goes to nobody, and the log says so");
    assert.equal(site.posts[0].projectId, "p1", "events carry the project id");
    assert.deepEqual(Object.values(f.state().finished).filter((x) => x.e), [], "nothing is left to resend");
  } finally { await f.close(); }
});
test("bots, live: an unreachable bot keeps its own events and delivers them later; the main bot is not held up", async () => {
  const f = await startFake();
  try {
    const site = await f.addHook(); site.status = () => 503;
    f.writeConfig({ bots: { site: { url: site.url, only: [{ projects: P1 }] } } });
    f.start(); await f.waitFor(() => /watching 0 threads/.test(f.out), 8000, "first snapshot");
    await finish(f, "A", "p1", "failed"); await finish(f, "B", "p1", "failed");
    await f.waitFor(() => f.posts.length === 2, 6000, "the main bot got both at once");
    await f.waitFor(() => Object.keys(((f.state().bots || {}).site || {}).pending || {}).length === 2, 6000, "the bot's two events are kept");
    assert.equal(site.hits, 1, "the second event didn't try the dead webhook again");
    await f.stop(); site.status = () => 200; f.start();
    await f.waitFor(() => site.posts.length === 2, 9000, "kept events are sent right after a restart");
    await sleep(300);
    assert.deepEqual(runIds(site.posts), ["A1", "B1"]);
    assert.equal(f.posts.length, 2, "the main bot got nothing twice");
    assert.deepEqual(Object.keys(f.state().bots.site.pending), []);
  } finally { await f.close(); }
});
test("bots, live: a rate limit pauses only the bot that got it, and that bot's finishes are combined", async () => {
  const f = await startFake();
  try {
    const site = await f.addHook(); site.status = () => ({ status: 429, headers: { "retry-after": "3600" }, body: "rate limit exceeded" });
    f.writeConfig({ bots: { site: { url: site.url, only: [{ projects: P1 }] } } });
    f.start(); await f.waitFor(() => /watching 0 threads/.test(f.out), 8000, "first snapshot");
    await finish(f, "A", "p1"); await finish(f, "B", "p1"); await finish(f, "C", "p2");
    await f.waitFor(() => f.posts.length === 3 && ((f.state().bots || {}).site || {}).missed && f.state().bots.site.missed.count === 2, 9000, "main got all three; the bot counted its two");
    assert.equal(site.hits, 1);
    assert.equal(f.count(/webhook is rate limited; nothing is sent until .* \[bot site\]/), 1);
    assert.equal(f.state().pausedUntil || 0, 0, "the main bot is not paused");
    assert.ok(f.state().bots.site.pausedUntil > Date.now());
  } finally { await f.close(); }
});
test("bots, live: after an outage each bot gets one summary of its own old run ends", async () => {
  const f = await startFake({ catchUpMinutes: 0 });
  try {
    const site = await f.addHook();
    f.writeConfig({ bots: { site: { url: site.url, only: [{ projects: P1 }] } } });
    f.start(); await f.waitFor(() => /watching 0 threads/.test(f.out), 8000, "first snapshot");
    await f.stop();
    f.setThread(done("A", "p1"), doneRun("A")); f.setThread(done("B", "p2"), doneRun("B")); f.setThread(done("C", "p2"), doneRun("C"));
    await sleep(50);
    f.start(); await f.waitFor(() => f.posts.length >= 1 && site.posts.length >= 1, 9000, "both summaries"); await sleep(300);
    assert.deepEqual(f.posts.map((e) => [e.event, e.count]), [["thread.missed.summary", 3]]);
    assert.deepEqual(site.posts.map((e) => [e.event, e.count, e.threads]), [["thread.missed.summary", 1, ["Thread A"]]]);
  } finally { await f.close(); }
});
test("bots, live: a question's close goes to the bots that got its opening", async () => {
  const f = await startFake();
  try {
    const site = await f.addHook();
    f.writeConfig({ main: { skip: [{ projects: P1 }] }, bots: { site: { url: site.url, only: [{ projects: P1, events: ["questions"] }] } } });
    f.start(); await f.waitFor(() => /watching 0 threads/.test(f.out), 8000, "first snapshot");
    const req = (status) => ({ id: "q1", kind: "user_input", status, createdAt: isoNow(), responseCapability: { type: "resumable" }, ...(status === "resolved" ? { answers: { a: "Yes" }, resolvedAt: isoNow() } : {}) });
    const item = { type: "user_input_request", requestId: "q1", questions: [{ id: "a", header: "Go", question: "Ship it?", options: [{ label: "Yes" }, { label: "No" }] }] };
    f.update({ id: "Q", title: "Thread Q", status: "running", activeRunId: "Q1", latestRunId: "Q1", projectId: "p1", pendingRuntimeRequest: { id: "q1" } }, { runs: [{ id: "Q1", status: "running", startedAt: isoNow() }], runtimeRequests: [req("pending")], turnItems: [item] });
    await f.waitFor(() => site.posts.length === 1, 8000, "the question");
    assert.deepEqual(f.state().sent.q1.to, ["site"]);
    f.update({ id: "Q", title: "Thread Q", status: "running", activeRunId: "Q1", latestRunId: "Q1", projectId: "p1", pendingRuntimeRequest: null }, { runs: [{ id: "Q1", status: "running", startedAt: isoNow() }], runtimeRequests: [req("resolved")], turnItems: [item] });
    await f.waitFor(() => site.posts.length === 2, 8000, "its close"); await sleep(300);
    assert.deepEqual(site.posts.map((e) => e.event), ["request.opened", "request.resolved"]);
    assert.deepEqual(f.posts, [], "the main bot unsubscribed from this project and got neither");
  } finally { await f.close(); }
});
test("bot commands: add, list, subscribe and unsubscribe edit listen.json, look projects up in T3, and never print a URL or key", async () => {
  const f = await startFake();
  try {
    const hook = "https://hooks.example/secret-path\nAuthorization: Bearer topsecretkey123\n";
    const out = (r) => `${r.stdout}${r.stderr}`;
    let r = await f.cli(["bot", "add", "site", "--project", "PROJ"], hook);
    assert.equal(r.status, 0, out(r)); assert.match(r.stdout, /^main: gets everything\nsite: gets every event from proj\n/);
    assert.ok(!/secret-path|topsecretkey123|hooks\.example/.test(out(r)), "nothing of the webhook is printed");
    const conf = () => JSON.parse(require("fs").readFileSync(path.join(f.dir, "listen.json"), "utf8"));
    assert.deepEqual(conf().bots.site, { url: "https://hooks.example/secret-path", headers: { Authorization: "Bearer topsecretkey123" }, only: [{ projects: [{ id: "p1", title: "proj" }] }], skip: [] });
    assert.equal(conf().url, f.hookUrl(), "the main bot's webhook is untouched");

    r = await f.cli(["unsubscribe", "main", "--project", "proj"]); assert.equal(r.status, 0, out(r));
    assert.match(r.stdout, /^main: gets everything; not every event from proj\n/);
    r = await f.cli(["unsubscribe", "main", "--events", "finished,cancelled"]); assert.equal(r.status, 0, out(r));
    r = await f.cli(["subscribe", "site", "--project", "other", "--events", "failed"]); assert.equal(r.status, 0, out(r));
    r = await f.cli(["bots"]);
    assert.equal(r.stdout.trim(), "main: gets everything; not every event from proj; nor finished, cancelled from every project\nsite: gets every event from proj; and failed from other");
    r = await f.cli(["subscribe", "main", "--project", "proj"]); assert.equal(r.status, 0, out(r));
    assert.match(r.stdout, /^main: gets everything; not finished, cancelled from every project\n/, "subscribing again undoes the unsubscribe");
    r = await f.cli(["status"]); assert.match(r.stdout, /bots:\n {2}main: gets everything; not finished, cancelled from every project\n {2}site: gets/);
    assert.ok(!/secret-path|topsecretkey123/.test(out(r)));

    for (const [args, word] of [[["subscribe", "main", "--project", "proj"], "ALREADY_SUBSCRIBED"], [["unsubscribe", "ghost", "--project", "proj"], "NOT_FOUND"], [["subscribe", "site", "--project", "nope"], "NOT_FOUND"],
      [["subscribe", "site", "--events", "finish"], "USAGE"], [["subscribe", "site"], "USAGE"], [["bot", "remove", "ghost"], "NOT_FOUND"], [["test", "--bot", "ghost"], "NOT_FOUND"]]) {
      r = await f.cli(args); assert.equal(r.status, 1, args.join(" ")); assert.match(out(r), new RegExp(`^${word}`), args.join(" "));
    }
    r = await f.cli(["bot", "add", "main"], hook); assert.match(out(r), /^USAGE/);
    r = await f.cli(["bot", "add", "bad", "--events", "failed"], "http://evil.example/x\n"); assert.match(out(r), /^BAD_URL/);
    r = await f.cli(["bot", "add", "copy"], hook); assert.match(out(r), /^USAGE: say what "copy" gets/, "a bot is never subscribed to everything by leaving the options out");
    r = await f.cli(["bot", "add", "copy", "--everything"], hook); assert.equal(r.status, 0, out(r)); assert.match(r.stdout, /copy: gets everything/);
    r = await f.cli(["bot", "add", "site", "--events", "failed"], hook); assert.match(out(r), /^EXISTS/, "an existing bot's webhook is not replaced without --replace");
    assert.deepEqual(conf().bots.site.only, [{ projects: [{ id: "p1", title: "proj" }] }, { projects: [{ id: "p2", title: "other" }], events: ["failed"] }]);
    r = await f.cli(["bot", "add", "site", "--replace"], "https://hooks.example/new-path\nAuthorization: Bearer newkey12345\n"); assert.equal(r.status, 0, out(r));
    assert.equal(conf().bots.site.url, "https://hooks.example/new-path"); assert.equal(conf().bots.site.only.length, 2, "--replace keeps what the bot gets");
    r = await f.cli(["bot", "remove", "copy"]); assert.equal(r.status, 0, out(r));
    r = await f.cli(["unsubscribe", "main", "--project", "proj", "--events", "finished"]); assert.equal(r.status, 0, out(r));
    r = await f.cli(["subscribe", "main", "--project", "proj"]); assert.match(out(r), /^ALREADY_SUBSCRIBED: "main" has no unsubscribe that matches exactly\. It leaves out: .*finished from proj/, "the message says how to undo");
    r = await f.cli(["subscribe", "main", "--project", "proj", "--events", "finished"]); assert.equal(r.status, 0, out(r));
    r = await f.cli(["unsubscribe", "site", "--project", "other", "--events", "failed"]); assert.equal(r.status, 0, out(r));
    r = await f.cli(["unsubscribe", "site", "--project", "proj"]); assert.match(out(r), /^LAST_SUBSCRIPTION/, "a bot is removed, not left subscribed to everything by accident");
    r = await f.cli(["bot", "remove", "site"]); assert.equal(r.status, 0, out(r)); assert.equal(conf().bots.site, undefined);
  } finally { await f.close(); }
});

test("bots, live: a change to listen.json is picked up while running; a broken file changes nothing", async () => {
  const f = await startFake();
  try {
    const site = await f.addHook();
    f.start(); await f.waitFor(() => /watching 0 threads/.test(f.out), 8000, "first snapshot");
    await sleep(2500); // the file watcher compares modification times
    f.writeConfig({ main: { skip: [{ projects: P1 }] }, bots: { site: { url: site.url, only: [{ projects: P1 }] } } });
    await f.waitFor(() => /listen\.json changed: 1 extra bot/.test(f.out), 9000, "the reload");
    await finish(f, "A", "p1", "failed");
    await f.waitFor(() => site.posts.length === 1, 8000, "the new bot's event");
    require("fs").writeFileSync(path.join(f.dir, "listen.json"), '{ "url": "http://127.0.0.1:1/x", "bots": {'); // a typo while editing by hand
    await f.waitFor(() => /listen\.json changed but can't be used \(it is not valid JSON\); keeping the bots and rules from before/.test(f.out), 9000, "the refusal");
    await finish(f, "B", "p1", "failed");
    await f.waitFor(() => site.posts.length === 2, 8000, "the bot is still there"); await sleep(300);
    assert.deepEqual(f.posts, [], "the main bot did not start getting the project again");
    assert.equal(f.count(/is no longer in listen\.json/), 0, "no bot was dropped");
  } finally { await f.close(); }
});
test("bots, live: a slow bot doesn't hold up the main bot or the live stream", async () => {
  const f = await startFake();
  try {
    const site = await f.addHook(); site.status = () => ({ status: 200, delayMs: 4000 });
    f.writeConfig({ bots: { site: { url: site.url, only: [{ projects: P1 }] } } });
    f.start(); await f.waitFor(() => /watching 0 threads/.test(f.out), 8000, "first snapshot");
    const t0 = Date.now();
    await finish(f, "A", "p1", "failed"); await finish(f, "B", "p1", "failed"); await finish(f, "C", "p2", "failed");
    await f.waitFor(() => f.posts.length === 3, 3000, "the main bot got all three while the slow bot was still answering its first");
    assert.ok(Date.now() - t0 < 3500, `took ${Date.now() - t0} ms`);
    await f.waitFor(() => site.posts.length === 2, 15000, "the slow bot still gets both, in order");
    assert.deepEqual(site.posts.map((e) => e.runId), ["A1", "B1"]);
  } finally { await f.close(); }
});
test("bots, live: a question a bot already has is not sent to it again when the main bot's copy is retried after a restart", async () => {
  const f = await startFake();
  try {
    const site = await f.addHook(); f.setHookStatus(() => 503);
    f.writeConfig({ bots: { site: { url: site.url, only: [{ projects: P1, events: ["questions"] }] } } });
    f.start(); await f.waitFor(() => /watching 0 threads/.test(f.out), 8000, "first snapshot");
    const req = { id: "q1", kind: "user_input", status: "pending", createdAt: isoNow(), responseCapability: { type: "resumable" } };
    const item = { type: "user_input_request", requestId: "q1", questions: [{ id: "a", header: "Go", question: "Ship it?", options: [{ label: "Yes" }, { label: "No" }] }] };
    f.update({ id: "Q", title: "Thread Q", status: "running", activeRunId: "Q1", latestRunId: "Q1", projectId: "p1", pendingRuntimeRequest: { id: "q1" } }, { runs: [{ id: "Q1", status: "running", startedAt: isoNow() }], runtimeRequests: [req], turnItems: [item] });
    await f.waitFor(() => site.posts.length === 1 && f.hits >= 1 && Object.keys(((f.state().bots || {}).site || {}).pending || { x: 1 }).length === 0, 8000, "the bot has it and the listener knows; the main bot's webhook refused");
    await f.stop(); f.setHookStatus(() => 200); f.start();
    await f.waitFor(() => f.posts.length === 1, 9000, "the main bot gets it after the restart"); await sleep(800);
    assert.equal(site.posts.length, 1, "the bot is not sent the question a second time");
  } finally { await f.close(); }
});
test("bots, live: with failure waves, a failure the main bot couldn't take stays saved for it while another bot takes its copy", async () => {
  const f = await startFake({ failureWaveSeconds: 0.5 });
  try {
    const site = await f.addHook(); f.setHookStatus(() => 400);
    f.writeConfig({ failureWaveSeconds: 0.5, bots: { site: { url: site.url, only: [{ projects: P1 }] } } });
    f.start(); await f.waitFor(() => /watching 0 threads/.test(f.out), 8000, "first snapshot");
    await finish(f, "A", "p1", "failed");
    await f.waitFor(() => site.posts.length === 1 && f.hits >= 1 && Object.keys(((f.state().bots || {}).site || {}).pending || { x: 1 }).length === 0, 9000, "the bot took it and the listener knows; the main bot's webhook refused"); await sleep(300);
    assert.ok(f.state().finished.A1.e, "the main bot's copy is still saved");
    await f.stop(); f.setHookStatus(() => 200); f.start();
    await f.waitFor(() => f.posts.length === 1, 9000, "the main bot gets it after the restart"); await sleep(800);
    assert.equal(f.posts[0].runId, "A1"); assert.equal(site.posts.length, 1, "and the other bot is not sent it again");
  } finally { await f.close(); }
});
