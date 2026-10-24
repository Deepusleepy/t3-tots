#!/usr/bin/env python3
"""The box fetcher (embedded in skills/t3-install-tools/SKILL.md) and scripts/sync-skills.
Fetcher: pins match this release, tools land flat at their manifest dest, a bad hash installs nothing,
pre-1.4.0 manifests (no dest) still install. sync-skills: blocks on leaks and bad frontmatter, copies otherwise."""
import hashlib, json, os, pathlib, re, shutil, stat, subprocess, sys, tempfile, unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
SKILL = (ROOT / "skills" / "t3-install-tools" / "SKILL.md").read_text(encoding="utf-8")
FETCHER = re.search(r"````python\n(.*?)````", SKILL, re.S).group(1)
MANIFEST = json.loads((ROOT / "manifest.json").read_text())
TOOLS = [f for f in MANIFEST["files"] if f["kind"] == "tool"]
sha = lambda b: hashlib.sha256(b).hexdigest()


def fetcher(tmp):
    """The fetcher with PIN/PINNED set to this checkout, so the tests run before a release is pinned."""
    code = re.sub(r'PIN = "[^"]*"', f'PIN = "{MANIFEST["version"]}"', FETCHER, count=1)
    pins = ",\n".join(f' "{f["path"]}": ["{f["dest"]}", "{f["sha256"]}"]' for f in TOOLS)
    code = re.sub(r"PINNED = \{.*?\n\}", lambda _: "PINNED = {\n" + pins + "\n}", code, count=1, flags=re.S)
    p = pathlib.Path(tmp) / "fetch.py"; p.write_text(code); return p


def run(script, *a, dst, env=None):
    e = {**os.environ, "T3TOTS_DST": str(dst), **(env or {})}
    return subprocess.run([sys.executable, str(script), *a], capture_output=True, text=True, env=e)


class Fetcher(unittest.TestCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp(prefix="t3tots-fetch-")); self.f = fetcher(self.tmp); self.dst = self.tmp / "box"

    def test_pins_match_this_release(self):
        pin = re.search(r'PIN = "([^"]*)"', FETCHER).group(1)
        if pin != MANIFEST["version"]:
            self.skipTest(f"skill pins {pin}, repo is {MANIFEST['version']}")
        pinned = dict(re.findall(r'^ "([^"]+)": (\[[^\]]+\])', FETCHER, re.M))
        self.assertEqual({k: json.loads(v) for k, v in pinned.items()}, {f["path"]: [f["dest"], f["sha256"]] for f in TOOLS},
                         "t3-install-tools pins differ from manifest.json: re-pin the fetcher, then run scripts/sync-skills")

    def test_box_install_is_flat_and_verified(self):
        r = run(self.f, "box", "--from", str(ROOT), dst=self.dst)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        for f in TOOLS:
            self.assertEqual(sha((self.dst / f["dest"]).read_bytes()), f["sha256"], f["dest"])
        for name in ("t3ctl.cmd", "t3listen.cmd", "ui-press.applescript", "cleanup/scan.py", "report/report.py", "manifest.json", "VERSION"):
            self.assertTrue((self.dst / name).is_file(), name)
        self.assertFalse((self.dst / "tools").exists()); self.assertFalse((self.dst / "skills").exists())
        self.assertTrue(os.stat(self.dst / "t3ctl").st_mode & stat.S_IXUSR)
        h = run(self.f, "hashes", "windows", dst=self.dst).stdout
        self.assertIn("  t3ctl.cmd\n", h); self.assertNotIn("tools/", h); self.assertNotIn("t3ui", h)

    def test_bad_hash_installs_nothing(self):
        src = self.tmp / "src"; shutil.copytree(ROOT / "tools", src / "tools"); shutil.copy(ROOT / "manifest.json", src)
        (src / "tools" / "t3q.py").write_text("tampered\n")
        r = run(self.f, "box", "--from", str(src), dst=self.dst)
        self.assertNotEqual(r.returncode, 0); self.assertIn("HASH_MISMATCH", r.stdout + r.stderr); self.assertFalse(self.dst.exists())

    def test_old_manifest_without_dest_still_installs(self):
        src = self.tmp / "old"; src.mkdir(); body = b"print('old')\n"
        (src / "t3q.py").write_bytes(body)
        (src / "manifest.json").write_text(json.dumps({"version": "v1.3.1", "files": [{"path": "t3q.py", "sha256": sha(body), "targets": ["box"]}]}))
        r = run(self.f, "update", "v1.3.1", "--from", str(src), dst=self.dst)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr); self.assertEqual((self.dst / "t3q.py").read_bytes(), body)

    def test_emitted_commands_map_repo_paths_to_flat_names(self):
        run(self.f, "box", "--from", str(ROOT), dst=self.dst)
        win = run(self.f, "emit", "windows", "~\\t3-tots", dst=self.dst).stdout
        self.assertIn("@('tools/windows/t3ctl.cmd','t3ctl.cmd',", win); self.assertNotIn("applescript", win)
        if not shutil.which("curl"):
            self.skipTest("no curl")
        sh = run(self.f, "emit", "macos", str(self.tmp / "mac"), dst=self.dst, env={"T3TOTS_RAW_BASE": ROOT.as_uri() + "/"}).stdout
        r = subprocess.run(["sh", "-c", sh], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr); self.assertIn("files verified", r.stdout)
        mac = self.tmp / "mac"
        for f in TOOLS:
            if "macos" in f["targets"]:
                self.assertEqual(sha((mac / f["dest"]).read_bytes()), f["sha256"], f["dest"])
        self.assertFalse((mac / "t3ctl.cmd").exists()); self.assertFalse((mac / "tools").exists()); self.assertFalse((mac / ".t3tots-staging").exists())
        self.assertTrue(os.access(mac / "t3ui", os.X_OK))


class SyncSkills(unittest.TestCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp(prefix="t3tots-sync-test-"))
        self.repo = self.tmp / "repo"
        for d in ("scripts", "tools"):
            shutil.copytree(ROOT / d, self.repo / d)
        shutil.copy(ROOT / "VERSION", self.repo)
        self.live = self.tmp / "live"

    def skill(self, name, body):
        (self.live / name).mkdir(parents=True, exist_ok=True)
        (self.live / name / "SKILL.md").write_bytes(f"---\nname: {name}\ndescription: >-\n  Test skill.\n---\n{body}".encode())

    def sync(self, *a):
        env = {k: v for k, v in os.environ.items() if k != "T3TOTS_PRIVATE_WORDS"}
        env["HOME"] = str(self.tmp)  # no private-words file
        return subprocess.run([sys.executable, str(self.repo / "scripts" / "sync-skills"), "--from", str(self.live), *a], capture_output=True, text=True, env=env)

    def test_copies_and_normalizes_only_line_endings(self):
        self.skill("t3-a", "Line one.\r\nLine two.")
        r = self.sync()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual((self.repo / "skills" / "t3-a" / "SKILL.md").read_bytes(), b"---\nname: t3-a\ndescription: >-\n  Test skill.\n---\nLine one.\nLine two.\n")
        m = json.loads((self.repo / "manifest.json").read_text())
        self.assertTrue(any(f["path"] == "skills/t3-a/SKILL.md" and f["dest"] == "t3-a/SKILL.md" for f in m["files"]))

    def test_leak_blocks_and_copies_nothing(self):
        self.skill("t3-a", "Ask someone" + "@gmail.com or look in /Users" + "/alice/x\n")  # split so the repo scan passes
        r = self.sync()
        self.assertEqual(r.returncode, 1); self.assertIn("SYNC_BLOCKED", r.stdout); self.assertIn("email", r.stdout)
        self.assertIn(str(self.live), r.stdout); self.assertFalse((self.repo / "skills").exists())

    def test_name_must_match_folder(self):
        self.skill("t3-a", "ok\n"); (self.live / "t3-b").mkdir(); shutil.copy(self.live / "t3-a" / "SKILL.md", self.live / "t3-b")
        r = self.sync(); self.assertEqual(r.returncode, 1); self.assertIn("frontmatter name must be t3-b", r.stdout)

    def test_dry_run_and_prune(self):
        self.skill("t3-a", "a\n"); self.skill("t3-b", "b\n"); self.sync()
        shutil.move(str(self.live / "t3-b"), str(self.tmp / "gone"))
        r = self.sync("--dry-run"); self.assertIn("in repo only", r.stdout); self.assertTrue((self.repo / "skills" / "t3-b").exists())
        r = self.sync("--prune"); self.assertEqual(r.returncode, 0, r.stdout + r.stderr); self.assertFalse((self.repo / "skills" / "t3-b").exists())


if __name__ == "__main__":
    unittest.main(verbosity=1)
