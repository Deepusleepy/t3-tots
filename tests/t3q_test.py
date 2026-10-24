"""Tests for t3q.py against a tiny fake T3 database. Run: python3 tests/t3q_test.py"""
import json, os, sqlite3, subprocess, sys, tempfile, datetime as dt, unittest

HERE = os.path.dirname(os.path.abspath(__file__)); T3Q = os.path.join(HERE, "..", "t3q.py")
NOW = dt.datetime.now(dt.timezone.utc)
iso = lambda h=0: (NOW - dt.timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M:%S.000Z")

def make_db(folder, legacy_approvals=False):
    db = sqlite3.connect(os.path.join(folder, "statev2.sqlite"))
    db.executescript("""
    create table projection_projects (project_id text, title text, workspace_root text);
    create table orchestration_v2_projection_threads (thread_id text, project_id text, title text, created_at text, updated_at text, archived_at text, deleted_at text, payload_json text);
    create table orchestration_v2_projection_runs (run_id text, thread_id text, ordinal int, status text, requested_at text, payload_json text);
    create table orchestration_v2_projection_runtime_requests (thread_id text, kind text, status text, created_at text, payload_json text);
    create table orchestration_v2_projection_messages (thread_id text, role text, created_at text, payload_json text);""")
    if legacy_approvals: db.execute("create table projection_pending_approvals (thread_id text, status text)")
    db.execute("insert into projection_projects values ('p1', 'Demo', '/tmp/demo')")
    def thread(tid, title, run_status, held=False, reply="Done."):
        db.execute("insert into orchestration_v2_projection_threads values (?,?,?,?,?,null,null,?)", (tid, "p1", title, iso(5), iso(1), json.dumps({"creationSource": "web"})))
        db.execute("insert into orchestration_v2_projection_runs values (?,?,1,?,?,?)", ("r-" + tid, tid, run_status, iso(3), json.dumps({"queueHeld": held})))
        db.execute("insert into orchestration_v2_projection_messages values (?,?,?,?)", (tid, "assistant", iso(1), json.dumps({"text": reply})))
    thread("t-held", "Held queue", "queued", held=True)
    thread("t-queued", "Behind a run", "queued")
    thread("t-done", "Finished work", "completed")
    thread("t-ask", "Asks a question", "completed", reply="Should I merge it?")
    db.execute("insert into orchestration_v2_projection_runtime_requests values ('t-done', 'command', 'pending', ?, '{}')", (iso(2),))
    db.commit(); db.close()

def run(folder, cmd):
    env = {**os.environ, "T3_HOME": folder}
    return subprocess.run([sys.executable, T3Q, cmd], capture_output=True, text=True, env=env, timeout=60).stdout

class T3qTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup); self.dir = tmp.name

    def test_waiting_works_without_the_old_approvals_table(self):
        make_db(self.dir)
        out = run(self.dir, "waiting")
        self.assertNotIn("T3_SCHEMA_CHANGED", out)
        self.assertIn("pending command", out)          # approvals now live in runtime_requests
        self.assertIn("Asks a question", out)
        self.assertIn("3 thread(s) waiting on you", out)

    def test_waiting_still_reads_the_old_approvals_table(self):
        make_db(self.dir, legacy_approvals=True)
        self.assertNotIn("T3_SCHEMA_CHANGED", run(self.dir, "waiting"))

    def test_held_queue_is_waiting_not_running(self):
        make_db(self.dir)
        out = run(self.dir, "waiting")
        self.assertIn("Held queue", out); self.assertIn("queue held", out)
        self.assertNotIn("Behind a run", out)            # an ordinary queued run is still live
        ov = run(self.dir, "overview")
        self.assertIn("Held queue | needs you", ov); self.assertIn("Behind a run | running", ov)

    def test_health_reports_held_queue_not_stuck(self):
        make_db(self.dir)
        out = run(self.dir, "health")
        self.assertIn("queue held: Held queue", out)
        self.assertNotIn("STUCK? live run: Held queue", out)
        self.assertNotIn("\u2014", out)                  # no em dashes in output

if __name__ == "__main__": unittest.main(verbosity=1)
