// Test helper: a stand-in T3 Code server (HTTP API + the WebSocket stream t3listen follows) and a webhook, both on
// 127.0.0.1, with a temp tools folder holding a copy of t3listen. Used by tests/t3listen.test.js.
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http"), crypto = require("crypto"), cp = require("child_process");
const TOOLS = path.join(__dirname, "..", "tools");

function copyTools(dir) {
  fs.copyFileSync(path.join(TOOLS, "t3listen"), path.join(dir, "t3listen"));
  for (const f of fs.readdirSync(TOOLS)) if (f.endsWith(".js")) fs.copyFileSync(path.join(TOOLS, f), path.join(dir, f));
}

function frame(obj) {
  const p = Buffer.from(JSON.stringify(obj)), n = p.length;
  const h = n < 126 ? Buffer.from([0x81, n]) : n < 65536 ? Buffer.from([0x81, 126, n >> 8, n & 255]) : Buffer.concat([Buffer.from([0x81, 127, 0, 0, 0, 0]), Buffer.from([n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255])]);
  return Buffer.concat([h, p]);
}
function readFrames(state, chunk, onText) {
  state.buf = Buffer.concat([state.buf, chunk]);
  for (;;) {
    const b = state.buf; if (b.length < 2) return;
    let len = b[1] & 127, off = 2;
    if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; } else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
    const masked = b[1] & 128, need = off + (masked ? 4 : 0) + len; if (b.length < need) return;
    const mask = masked ? b.subarray(off, off + 4) : null, data = Buffer.from(b.subarray(need - len, need));
    if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
    state.buf = b.subarray(need);
    const op = b[0] & 15; if (op === 8) return "close"; if (op === 1) onText(data.toString());
  }
}

async function startFake(config = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t3listen-fake-"));
  copyTools(dir);
  fs.writeFileSync(path.join(dir, "token"), "test-fixture");
  const posts = [], commands = [], projects = [{ id: "p1", title: "proj" }, { id: "p2", title: "other" }], extraHooks = [], threads = new Map(), projections = new Map(), sockets = new Set(), threadReads = new Map();
  let readDelay = () => 0; // ms to hold a thread read, to stand in for a large thread
  let hookStatus = () => 200, hits = 0; // hookStatus returns a status, or { status, body, headers } for a custom refusal
  const hook = http.createServer((req, res) => {
    let b = ""; req.on("data", (c) => (b += c));
    req.on("end", () => {
      hits++; const e = JSON.parse(b), answer = hookStatus(e), st = typeof answer === "number" ? answer : answer.status;
      if (st === 200) posts.push(e);
      res.writeHead(st, (typeof answer === "object" && answer.headers) || {}); res.end((typeof answer === "object" && answer.body) || (st === 200 ? "ok" : "busy"));
    });
  });
  const t3 = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split("?")[0]);
    if (u === "/api/orchestration/shell") return res.end(JSON.stringify({ projects, threads: [...threads.values()] }));
    const m = u.match(/^\/api\/orchestration\/threads\/(.+)$/);
    if (m) threadReads.set(m[1], (threadReads.get(m[1]) || 0) + 1);
    if (m && projections.has(m[1])) return setTimeout(() => res.end(JSON.stringify({ projection: { thread: threads.get(m[1]), ...projections.get(m[1]) } })), readDelay(m[1]));
    res.statusCode = 404; res.end("{}");
  });
  t3.on("upgrade", (req, sock) => {
    const accept = crypto.createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const st = { buf: Buffer.alloc(0), sub: null }; sock.on("error", () => {});
    sock.on("close", () => sockets.delete(st));
    st.sock = sock;
    sock.on("data", (chunk) => {
      const r = readFrames(st, chunk, (text) => {
        let msg; try { msg = JSON.parse(text); } catch { return; }
        if (msg._tag !== "Request") return;
        if (msg.tag === "orchestration.subscribeShell") {
          st.sub = msg.id; sockets.add(st);
          sock.write(frame({ _tag: "Chunk", requestId: msg.id, values: [{ kind: "snapshot", snapshot: { projects, threads: [...threads.values()] } }] }));
        } else { commands.push({ tag: msg.tag, payload: msg.payload }); sock.write(frame({ _tag: "Exit", requestId: msg.id, exit: { _tag: "Success", value: {} } })); }
      });
      if (r === "close") sock.destroy();
    });
  });
  await new Promise((r) => hook.listen(0, "127.0.0.1", r));
  async function addHook() { // one more webhook, for a bot other than the main one
    const h = { posts: [], hits: 0, status: () => 200 };
    const srv = http.createServer((req, res) => {
      let b = ""; req.on("data", (c) => (b += c));
      req.on("end", () => { h.hits++; const e = JSON.parse(b), a = h.status(e), st = typeof a === "number" ? a : a.status; if (st === 200) h.posts.push(e); setTimeout(() => { res.writeHead(st, (typeof a === "object" && a.headers) || {}); res.end((typeof a === "object" && a.body) || (st === 200 ? "ok" : "busy")); }, (typeof a === "object" && a.delayMs) || 0); });
    });
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    h.url = `http://127.0.0.1:${srv.address().port}/hook`; h.srv = srv; extraHooks.push(h); return h;
  }
  await new Promise((r) => t3.listen(0, "127.0.0.1", r));
  fs.mkdirSync(path.join(dir, "t3"));
  fs.writeFileSync(path.join(dir, "t3", "server-runtime.json"), JSON.stringify({ host: "127.0.0.1", port: t3.address().port }));
  fs.writeFileSync(path.join(dir, "listen.json"), JSON.stringify({ url: `http://127.0.0.1:${hook.address().port}/hook`, headers: {}, machine: "m", ...config }));

  let child = null, out = "";
  const f = {
    dir, posts, commands, threads, projections,
    get out() { return out; },
    get hits() { return hits; },
    addHook, hookUrl: () => `http://127.0.0.1:${hook.address().port}/hook`, t3Home: path.join(dir, "t3"),
    writeConfig(extra) { fs.writeFileSync(path.join(dir, "listen.json"), JSON.stringify({ url: `http://127.0.0.1:${hook.address().port}/hook`, headers: {}, machine: "m", ...config, ...extra })); },
    cli(args, input = "") { // run one t3listen command -> { status, stdout, stderr }; async, so this process's stand-in T3 can answer it
      return new Promise((resolve) => {
        const c = cp.spawn(process.execPath, [path.join(dir, "t3listen"), ...args], { env: { ...process.env, T3_HOME: path.join(dir, "t3") }, stdio: ["pipe", "pipe", "pipe"] });
        let stdout = "", stderr = ""; c.stdout.on("data", (d) => (stdout += d)); c.stderr.on("data", (d) => (stderr += d));
        c.on("exit", (status) => resolve({ status, stdout, stderr })); c.stdin.end(input);
      });
    },
    reads(id) { return threadReads.get(id) || 0; },
    setHookStatus(fn) { hookStatus = fn; },
    setReadDelay(fn) { readDelay = fn; },
    setThread(t, projection) { threads.set(t.id, { updatedAt: new Date().toISOString(), projectId: "p1", ...t }); if (projection) projections.set(t.id, projection); },
    push(values) { for (const s of sockets) s.sock.write(frame({ _tag: "Chunk", requestId: s.sub, values })); },
    update(t, projection) { f.setThread(t, projection); f.push([{ kind: "thread.updated", thread: threads.get(t.id) }]); },
    dropSockets() { for (const s of sockets) s.sock.destroy(); sockets.clear(); },
    state() { try { return JSON.parse(fs.readFileSync(path.join(dir, "listen-state.json"), "utf8")); } catch { return null; } },
    count(re) { return (out.match(new RegExp(re.source, "g")) || []).length; },
    start(args = []) {
      child = cp.spawn(process.execPath, [path.join(dir, "t3listen"), "run", ...args], { env: { ...process.env, T3_HOME: path.join(dir, "t3") }, stdio: ["ignore", "pipe", "pipe"] });
      child.stdout.on("data", (d) => (out += d)); child.stderr.on("data", (d) => (out += d));
      const c = child; c.exited = new Promise((r) => c.on("exit", (code) => r(code)));
      return c;
    },
    async stop() { if (!child) return; const c = child; child = null; if (c.exitCode === null) c.kill(); await c.exited; },
    async waitFor(pred, ms = 8000, what = "condition") {
      const end = Date.now() + ms;
      while (Date.now() < end) { if (pred()) return; await new Promise((r) => setTimeout(r, 40)); }
      throw new Error(`timed out waiting for ${what}\n--- listener output ---\n${out}`);
    },
    async close() {
      await f.stop(); for (const s of sockets) s.sock.destroy();
      hook.closeAllConnections(); t3.closeAllConnections(); for (const h of extraHooks) h.srv.closeAllConnections();
      await Promise.all([new Promise((r) => hook.close(r)), new Promise((r) => t3.close(r)), ...extraHooks.map((h) => new Promise((r) => h.srv.close(r)))]);
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
  return f;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
module.exports = { startFake, copyTools, sleep };
