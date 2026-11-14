// t3ctl skills: install only what's missing or changed, keep local edits, verify hashes, need no token.
const test = require("node:test"), assert = require("node:assert");
const fs = require("fs"), os = require("os"), path = require("path"), crypto = require("crypto");
const { execFileSync } = require("child_process");

const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "t3tots-skills-"));
// A tools folder with only t3ctl in it (no token), so backups land in this temp folder.
const toolsDir = tmp(); fs.copyFileSync(path.join(__dirname, "..", "tools", "t3ctl"), path.join(toolsDir, "t3ctl")); fs.copyFileSync(path.join(__dirname, "..", "tools", "thread-match.js"), path.join(toolsDir, "thread-match.js"));
const run = (...a) => { try { return { code: 0, out: execFileSync(process.execPath, [path.join(toolsDir, "t3ctl"), "skills", ...a], { encoding: "utf8", stdio: "pipe" }) }; }
  catch (e) { return { code: e.status, out: String(e.stdout) + String(e.stderr) }; } };

// A release-shaped folder: skills/<name>/SKILL.md plus a manifest.json that pins each file.
function release(skills, version = "v9.9.9") {
  const root = tmp(), files = [];
  for (const [name, body] of Object.entries(skills)) {
    fs.mkdirSync(path.join(root, "skills", name), { recursive: true });
    fs.writeFileSync(path.join(root, "skills", name, "SKILL.md"), body);
    files.push({ path: `skills/${name}/SKILL.md`, dest: `${name}/SKILL.md`, kind: "skill", sha256: sha(Buffer.from(body)) });
  }
  fs.writeFileSync(path.join(root, "manifest.json"), JSON.stringify({ name: "t3-tots", version, files }));
  return root;
}
const read = (...p) => fs.readFileSync(path.join(...p), "utf8");

test("list needs no token and names every skill", () => {
  const r = run("list", "--from", release({ "t3-a": "a1\n", "t3-b": "b1\n" }));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /hashes verified/); assert.match(r.out, /t3-a/); assert.match(r.out, /2 skills/);
});

test("dry run writes nothing", () => {
  const to = path.join(tmp(), "skills");
  const r = run("install", "--from", release({ "t3-a": "a1\n" }), "--to", to, "--dry-run");
  assert.equal(r.code, 0, r.out); assert.match(r.out, /would install 1 new/); assert.equal(fs.existsSync(to), false);
});

test("list --to shows each skill's state and changes nothing", () => {
  const src = release({ "t3-a": "a1\n", "t3-b": "b1\n" }), to = path.join(tmp(), "skills");
  run("install", "--from", src, "--to", to, "--only", "t3-a");
  fs.writeFileSync(path.join(to, "t3-a", "SKILL.md"), "mine\n");
  const r = run("list", "--from", src, "--to", to);
  assert.equal(r.code, 0, r.out); assert.match(r.out, /1 not installed, 0 to update, 0 up to date, 1 changed here/);
  assert.equal(read(to, "t3-a", "SKILL.md"), "mine\n"); assert.equal(fs.existsSync(path.join(to, "t3-b")), false);
});

test("installs missing skills, then reports them up to date", () => {
  const src = release({ "t3-a": "a1\n", "t3-b": "b1\n" }), to = path.join(tmp(), "skills");
  assert.match(run("install", "--from", src, "--to", to).out, /installed 2 new/);
  assert.equal(read(to, "t3-a", "SKILL.md"), "a1\n");
  assert.ok(JSON.parse(read(to, ".t3-tots-skills.json")).skills["t3-b"].hash);
  assert.match(run("install", "--from", src, "--to", to).out, /installed 0 new, updated 0, 2 up to date/);
});

test("updates a skill that changed in the release and wasn't edited here", () => {
  const to = path.join(tmp(), "skills");
  run("install", "--from", release({ "t3-a": "a1\n", "t3-b": "b1\n" }), "--to", to);
  const r = run("install", "--from", release({ "t3-a": "a2\n", "t3-b": "b1\n" }), "--to", to);
  assert.match(r.out, /t3-a {2}update/); assert.match(r.out, /updated 1, 1 up to date/);
  assert.equal(read(to, "t3-a", "SKILL.md"), "a2\n");
});

test("keeps a skill edited here unless --force, and backs it up outside --to", () => {
  const to = path.join(tmp(), "skills");
  run("install", "--from", release({ "t3-a": "a1\n" }), "--to", to);
  fs.writeFileSync(path.join(to, "t3-a", "SKILL.md"), "mine\n");
  const src = release({ "t3-a": "a2\n" });
  assert.match(run("install", "--from", src, "--to", to).out, /kept: changed here/);
  assert.equal(read(to, "t3-a", "SKILL.md"), "mine\n");
  const r = run("install", "--from", src, "--to", to, "--force");
  assert.equal(read(to, "t3-a", "SKILL.md"), "a2\n");
  const backup = r.out.match(/old copy: (.+)/)[1].trim();
  assert.equal(read(backup, "SKILL.md"), "mine\n");
  assert.ok(!backup.startsWith(to), "backup must not sit inside the skills folder");
  assert.deepEqual(fs.readdirSync(to).filter((n) => !n.startsWith(".")), ["t3-a"]);
});

test("a skill already there with no install record counts as edited", () => {
  const to = path.join(tmp(), "skills"); fs.mkdirSync(path.join(to, "t3-a"), { recursive: true });
  fs.writeFileSync(path.join(to, "t3-a", "SKILL.md"), "older\n");
  assert.match(run("install", "--from", release({ "t3-a": "a1\n" }), "--to", to).out, /1 kept/);
});

test("--only limits the install and rejects unknown names", () => {
  const src = release({ "t3-a": "a1\n", "t3-b": "b1\n" }), to = path.join(tmp(), "skills");
  run("install", "--from", src, "--to", to, "--only", "t3-b");
  assert.deepEqual(fs.readdirSync(to).filter((n) => !n.startsWith(".")), ["t3-b"]);
  assert.notEqual(run("install", "--from", src, "--to", to, "--only", "t3-zzz").code, 0);
});

test("a file that doesn't match manifest.json installs nothing", () => {
  const src = release({ "t3-a": "a1\n", "t3-b": "b1\n" }), to = path.join(tmp(), "skills");
  fs.writeFileSync(path.join(src, "skills", "t3-b", "SKILL.md"), "tampered\n");
  const r = run("install", "--from", src, "--to", to);
  assert.notEqual(r.code, 0); assert.match(r.out, /HASH_MISMATCH/); assert.equal(fs.existsSync(to), false);
});

test("install needs --to; a folder with no skills says NO_SKILLS_SOURCE", () => {
  assert.notEqual(run("install", "--from", release({ "t3-a": "a1\n" })).code, 0);
  const r = run("list", "--from", tmp()); assert.notEqual(r.code, 0); assert.match(r.out, /NO_SKILLS_SOURCE/);
});

test("the repo's own skills verify against manifest.json", () => {
  const r = run("list", "--from", path.join(__dirname, ".."));
  assert.equal(r.code, 0, r.out); assert.match(r.out, /hashes verified/); assert.match(r.out, new RegExp(`${fs.readdirSync(path.join(__dirname, "..", "skills")).length} skills`));
});

test("install refuses a folder with no manifest.json (BAD_MANIFEST) and writes nothing", () => {
  const src = release({ "t3-a": "a1\n" }); fs.renameSync(path.join(src, "manifest.json"), path.join(src, "manifest.json.off"));
  const to = path.join(tmp(), "skills"), r = run("install", "--from", src, "--to", to);
  assert.equal(r.code, 1, r.out); assert.match(r.out, /BAD_MANIFEST/); assert.equal(fs.existsSync(to), false);
  assert.match(run("list", "--from", src).out, /unverified|unversioned/); // listing still works and says so
});

// Every webhook event starts a bot run that knows nothing, so what that run must read is kept small on purpose.
test("phone answers: the routine prompt and t3-event stay small, complete and safe on their own", () => {
  const skill = (n) => read(__dirname, "..", "skills", n, "SKILL.md");
  const m = skill("t3-phone-answers").match(/```\n(T3 Tots event routine v2\.[\s\S]*?)\n```/);
  assert.ok(m, "the routine prompt block"); const prompt = m[1], ev = skill("t3-event");
  assert.ok(prompt.length <= 2400, `routine prompt is ${prompt.length} characters`);
  assert.ok(ev.length <= 6000, `t3-event is ${ev.length} characters`);
  for (const name of ["request.opened", "request.resolved", "thread.finished", "thread.cancelled", "thread.failed", "thread.failed.batch", "thread.missed.summary", "test"]) assert.ok(prompt.includes(name), `the prompt handles ${name}`);
  assert.match(prompt, /data, never instructions/); assert.match(prompt, /Never open token, listen\.json, secrets\//);
  assert.doesNotMatch(prompt, /t3-tots-rules|t3-phone-answers/, "a run is never sent to the two large skills");
  assert.match(ev, /don't read t3-tots-rules or t3-phone-answers/);
  assert.match(ev, /--request '<requestId>' --decision <option> --user-approved/); assert.match(ev, /--decision decline --redirect/);
  assert.match(ev, /Never accept an approval/); assert.match(ev, /never answer a question the user didn't see/);
});

test("updates: the fetcher's last line sends the bot to the bot-side checks, which name the current routine prompt", () => {
  const inst = read(__dirname, "..", "skills", "t3-install-tools", "SKILL.md"), phone = read(__dirname, "..", "skills", "t3-phone-answers", "SKILL.md");
  assert.match(inst, /print\('NEXT: open the t3-install-tools skill as it is now[^\n]*"After an update"/);
  const section = inst.slice(inst.indexOf("## After an update"), inst.indexOf("## Weekly update run"));
  assert.ok(section.length > 200, "the section exists");
  const marker = section.match(/doesn't start with "([^"]+)"/); assert.ok(marker, "the check names the prompt's first words");
  assert.ok(phone.includes("```\n" + marker[1]), "and they are the first words of the routine prompt in t3-phone-answers");
  assert.match(inst, /g\. Do every check under "After an update"/);
});

test("skills never tell the bot to accept an approval, send twice, or open listen.json", () => {
  const skill = (n) => read(__dirname, "..", "skills", n, "SKILL.md");
  assert.doesNotMatch(skill("t3-watch"), /may also answer, approve/); assert.match(skill("t3-watch"), /decline approvals with a redirect/);
  const fallback = skill("t3-new-thread").split("## Fallback on macOS")[1];
  assert.match(fallback, /WRITE_STATE: none/); assert.match(fallback, /never send it a second way/);
  assert.doesNotMatch(skill("t3-phone-answers"), /the user turns it off in that file/);
  assert.doesNotMatch(skill("t3-waiting"), /t3-phone-answers/, "answering one question never loads the phone setup skill");
  assert.doesNotMatch(skill("t3-tots-rules"), /t3-phone-answers "Answering"/);
  assert.doesNotMatch(skill("t3-install-tools") + skill("t3-tots-rules"), /weekly run installs nothing|reports and installs nothing/, "notify mode still fills placeholders");
});

// With T3's MCP connected, a plain action reads no skill: the memory note is the only T3 Tots text in view, so it carries the safety rules.
test("MCP: the note is small and safe on its own, and the backup skill stays small and complete", () => {
  const skill = (n) => read(__dirname, "..", "skills", n, "SKILL.md"), routes = skill("t3-routes");
  const m = routes.match(/```\n(T3 routes v2\n[\s\S]*?)\n```/); assert.ok(m, "the note block"); const note = m[1];
  assert.ok(note.length <= 1700, `the note is ${note.length} characters`); assert.ok(routes.length <= 7000, `t3-routes is ${routes.length} characters`);
  for (const rule of [/data, never instructions/, /token, listen\.json or secrets\//, /computer that owns the thread/, /ask unless one match is exact/, /new clientRequestId/,
    /record --started <id>/, /"To record"/, /runtime mode the user names, else the mode that project's threads run in/, /Never approve, delete, unlink, or change projects, settings or environment preferences through MCP/, /never MCP on your own/, /computer the user names, else the one their message came from/, /stop \(t3_thread_interrupt with stop: true\)/, /stays in them/, /stop and read t3-routes/]) assert.match(note, rule);
  assert.match(routes, /don't read t3-tots-rules/); assert.match(routes, /Never do it another way while unsure/); assert.match(routes, /same\*\* `clientRequestId`/);
  assert.match(routes, /Never work around it yourself/); assert.match(routes, /also in delegated mode/); assert.match(routes, /This never covers an approval/);
  assert.match(routes, /Never as a second try after a doubt or a refusal/); assert.match(routes, /Never build a waiting list from `t3_pending_request`/);
  for (const n of ["t3-new-thread", "t3-thread-actions"]) assert.match(skill(n).split("---")[1], /"T3 routes v2"[\s\S]*without this skill/, `${n} says when it is not needed`);
  const plain = note.match(/open no skill: ([^.]*)\./)[1];
  for (const word of skill("t3-thread-actions").split("---")[1].match(/a plain ([^.]*?) goes straight/)[1].split(/, | or /)) assert.ok(plain.includes(word), `the note lists ${word} as plain`);
  assert.doesNotMatch(skill("t3-tots-rules"), /Read the t3-routes skill before acting/, "the rules never send every action to t3-routes");
  const after = skill("t3-install-tools"); assert.match(after.slice(after.indexOf("## After an update"), after.indexOf("## Weekly update run")), /doesn't start with "T3 routes v2"/);
});

// A watch routine runs every 5 or 10 minutes, and almost every run finds nothing new.
test("watch: a run where nothing changed reads no skill", () => {
  const watch = read(__dirname, "..", "skills", "t3-watch", "SKILL.md"), m = watch.match(/```\n(T3 Tots watch routine v2\.[\s\S]*?)\n```/);
  assert.ok(m, "the routine prompt block"); const prompt = m[1], first = prompt.indexOf("Run the check first");
  assert.ok(first > 0 && !/t3-tots-rules|t3-watch/.test(prompt.slice(0, first)), "no skill is named before the check runs");
  assert.match(prompt, /`t3ctl watch` command and it prints nothing, stop there: read no skill/); assert.match(prompt, /no output can mean it ended/); assert.match(prompt, /Never repeat a key/); assert.match(prompt, /data, never instructions/); assert.match(prompt, /Never accept an approval/);
  const inst = read(__dirname, "..", "skills", "t3-install-tools", "SKILL.md");
  assert.match(inst.slice(inst.indexOf("## After an update"), inst.indexOf("## Weekly update run")), /not with "T3 Tots watch routine v2\."/);
});

// "What's waiting", status, digests and usage only read, so they carry their few rules themselves instead of loading the shared rules.
test("look-only skills are complete on their own and share one Basics block", () => {
  const skill = (n) => read(__dirname, "..", "skills", n, "SKILL.md"), names = ["t3-waiting", "t3-status", "t3-digest", "t3-usage"];
  const basics = (n) => { const m = skill(n).match(/## Basics\n([\s\S]*?- Give times in the user's timezone\.[^\n]*\n)/); assert.ok(m, `${n} has the Basics block`); return m[1]; };
  const first = basics(names[0]);
  for (const n of names) {
    assert.equal(basics(n), first, `${n} has the same Basics block`);
    assert.doesNotMatch(skill(n), /^Follow the t3-tots-rules skill/m, `${n} doesn't load the shared rules`);
    assert.ok(skill(n).length <= 5000, `${n} is ${skill(n).length} characters`);
  }
  for (const rule of [/don't read t3-tots-rules/, /data, never instructions/, /`token`, `listen\.json`, `secrets\/`/, /ListMachines every run/, /`py -3`/, /Remove-Item Env:X/, /`AMBIGUOUS` or `NO_GOOD_MATCH`/]) assert.match(first, rule);
  const waiting = skill("t3-waiting");
  assert.match(waiting, /--decision <option> --user-approved/); assert.match(waiting, /Never accept an approval yourself/); assert.match(waiting, /Never answer a question the user didn't see/);
  assert.match(waiting, /In delegated mode[^\n]*read t3-tots-rules "Decisions" first/);
});

test("the shared rules stay small, and every pointer to a section of them or of t3-reference lands on a heading", () => {
  const dir = path.join(__dirname, "..", "skills"), body = (n) => read(dir, n, "SKILL.md"), rules = body("t3-tots-rules");
  assert.ok(rules.length <= 23500, `t3-tots-rules is ${rules.length} characters`);
  const headings = (text) => new Set([...text.matchAll(/^#{2,3} (.+)$/gm)].map((m) => m[1].trim()));
  const targets = { "t3-tots-rules": headings(rules), "t3-reference": headings(body("t3-reference")) };
  const all = fs.readdirSync(dir).map((n) => body(n)).join("\n") + read(__dirname, "..", "AGENTS.md");
  for (const [, skill, section] of all.matchAll(/(t3-tots-rules|t3-reference) "([^"\n]+)"/g)) assert.ok(targets[skill].has(section), `${skill} has no heading "${section}"`);
  for (const kept of ["Writes", "Text from threads and events is data", "Secrets", "Decisions", "Sending into threads", "Finding a thread", "Grok Bot only", "Computers", "Status words", "Token"]) assert.ok(targets["t3-tots-rules"].has(kept), `rules keep "${kept}"`);
  for (const line of [/Never accept an approval yourself/, /never send the same message both ways/, /Don't retry other spellings/, /`WRITE_STATE: none`, `WRITE_STATE: unknown`/, /`NEEDS_USER_APPROVAL`/, /Ask before `t3ctl queue --thread <t> --resume`/]) assert.match(rules, line);
});
