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
        self.assertIn(f"@('manifest.json','manifest.json','{sha((self.dst / 'manifest.json').read_bytes())}')", win)
        self.assertIn("  manifest.json\n", run(self.f, "hashes", "linux", dst=self.dst).stdout)
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
        self.assertEqual((mac / "manifest.json").read_bytes(), (ROOT / "manifest.json").read_bytes())
        self.assertEqual((mac / "VERSION").read_text().strip(), MANIFEST["version"])

    def test_linux_install_chmods_only_what_it_installs(self):
        if not shutil.which("curl"):
            self.skipTest("no curl")
        run(self.f, "box", "--from", str(ROOT), dst=self.dst)
        sh = run(self.f, "emit", "linux", str(self.tmp / "lin"), dst=self.dst, env={"T3TOTS_RAW_BASE": ROOT.as_uri() + "/"}).stdout
        self.assertNotIn("t3ui", sh)
        r = subprocess.run(["sh", "-c", sh], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertTrue(os.access(self.tmp / "lin" / "t3ctl", os.X_OK)); self.assertTrue((self.tmp / "lin" / "manifest.json").is_file())


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
        (self.live / name / "SKILL.md").write_bytes(f"---\nname: {name}\ndescription: >-\n  Test skill. Use for tests.\n---\n{body}".encode())

    def sync(self, *a):
        env = {k: v for k, v in os.environ.items() if k != "T3TOTS_PRIVATE_WORDS"}
        env["HOME"] = str(self.tmp)  # no private-words file
        return subprocess.run([sys.executable, str(self.repo / "scripts" / "sync-skills"), "--from", str(self.live), *a], capture_output=True, text=True, env=env)

    def test_copies_and_normalizes_only_line_endings(self):
        self.skill("t3-a", "Line one.\r\nLine two.")
        r = self.sync()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual((self.repo / "skills" / "t3-a" / "SKILL.md").read_bytes(), b"---\nname: t3-a\ndescription: >-\n  Test skill. Use for tests.\n---\nLine one.\nLine two.\n")
        m = json.loads((self.repo / "manifest.json").read_text())
        self.assertTrue(any(f["path"] == "skills/t3-a/SKILL.md" and f["dest"] == "t3-a/SKILL.md" for f in m["files"]))

    def test_leak_blocks_and_copies_nothing(self):
        self.skill("t3-a", "Ask someone" + "@gmail.com or look in /Users" + "/alice/x\n")  # split so the repo scan passes
        r = self.sync()
        self.assertEqual(r.returncode, 1); self.assertIn("SYNC_BLOCKED", r.stdout); self.assertIn("email", r.stdout)
        self.assertIn(str(self.live), r.stdout); self.assertFalse((self.repo / "skills").exists())

    def test_source_is_required(self):
        env = {k: v for k, v in os.environ.items() if k not in ("T3TOTS_PRIVATE_WORDS", "T3TOTS_SKILLS_SRC")}
        r = subprocess.run([sys.executable, str(self.repo / "scripts" / "sync-skills")], capture_output=True, text=True, env=env)
        self.assertEqual(r.returncode, 1); self.assertIn("NO_SKILLS", r.stdout); self.assertFalse((self.repo / "skills").exists())

    def test_description_must_say_when(self):
        (self.live / "t3-a").mkdir(parents=True)
        (self.live / "t3-a" / "SKILL.md").write_text("---\nname: t3-a\ndescription: >-\n  Does a thing.\n---\nbody\n")
        r = self.sync(); self.assertEqual(r.returncode, 1); self.assertIn("say when to use", r.stdout)

    def test_name_must_match_folder(self):
        self.skill("t3-a", "ok\n"); (self.live / "t3-b").mkdir(); shutil.copy(self.live / "t3-a" / "SKILL.md", self.live / "t3-b")
        r = self.sync(); self.assertEqual(r.returncode, 1); self.assertIn("frontmatter name must be t3-b", r.stdout)

    def test_dry_run_and_prune(self):
        self.skill("t3-a", "a\n"); self.skill("t3-b", "b\n"); self.sync()
        shutil.move(str(self.live / "t3-b"), str(self.tmp / "gone"))
        r = self.sync("--dry-run"); self.assertIn("in repo only", r.stdout); self.assertTrue((self.repo / "skills" / "t3-b").exists())
        r = self.sync("--prune"); self.assertEqual(r.returncode, 0, r.stdout + r.stderr); self.assertFalse((self.repo / "skills" / "t3-b").exists())

    def test_cleans_its_staging_folder_and_shows_the_no_words_warning(self):
        tmpdir = self.tmp / "tmp"; tmpdir.mkdir()
        self.skill("t3-a", "a\n")
        for extra in ([], ["--dry-run"]):
            env = {k: v for k, v in os.environ.items() if k != "T3TOTS_PRIVATE_WORDS"}; env.update(HOME=str(self.tmp), TMPDIR=str(tmpdir))
            r = subprocess.run([sys.executable, str(self.repo / "scripts" / "sync-skills"), "--from", str(self.live), *extra], capture_output=True, text=True, env=env)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr); self.assertIn("warning: no private words", r.stdout)
            self.assertEqual([p.name for p in tmpdir.glob("t3tots-sync-*") if not p.name.startswith("t3tots-sync-old-")], [], extra)
        self.skill("t3-b", "Ask someone" + "@gmail.com\n")  # a blocked sync cleans up too
        r = subprocess.run([sys.executable, str(self.repo / "scripts" / "sync-skills"), "--from", str(self.live)], capture_output=True, text=True, env=env)
        self.assertEqual(r.returncode, 1); self.assertEqual([p for p in tmpdir.glob("t3tots-sync-*") if not p.name.startswith("t3tots-sync-old-")], [])



class ScanPrivate(unittest.TestCase):
    """Each sample is split so this file itself passes the scan."""
    def setUp(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("scan_private", ROOT / "scripts" / "scan-private.py")
        self.m = importlib.util.module_from_spec(spec); spec.loader.exec_module(self.m)
        self.tmp = pathlib.Path(tempfile.mkdtemp(prefix="t3tots-scan-"))

    def hits(self, text):
        f = self.tmp / "x.md"; f.write_text(text + "\n"); return self.m.scan([f], [])

    def test_catches_personal_details(self):
        for sample in ["cd ~" + "/Developer/app", "cd $HOME" + "/Projects/x", "%USERPROFILE%" + "\\Documents\\y",
                       "/home" + "/box/agent-data", "/Users" + "/alice", "/Users" + "/alice/", "C:" + "\\Users\\bob",
                       "alice-Mac" + "Book-Pro", "Mac" + "BookPro" + ".lo" + "cal", "Mac" + "Book-Pro-2", "DESKTOP-" + "AB12CD3", "LAPTOP-" + "Q1W2E3R",
                       "gho" + "_" + "a" * 36, "npm" + "_" + "b" * 36, "xapp" + "-1-A0B1C2D3E4F5", "xoxb" + "-123456789012-abc",
                       "https://hooks" + ".slack.com/services/T000/B000/XXXX", "https://discord" + ".com/api/webhooks/123/abc-DEF"]:
            self.assertTrue(self.hits(sample), sample)

    def test_allows_placeholders_and_generic_paths(self):
        for sample in ["/Users" + "/you/t3-tots", "/Users" + "/Shared", "/home" + "/user/x", "C:" + "\\Users\\you\\t3-tots",
                       "~/t3-tots", "~/.claude/skills", "$HOME/.t3", "~/Library/Caches", "a MacBook Pro or a Windows PC", "user@example.com",
                       "git" + "@github.com:owner/repo", "123+x" + "@users.noreply.github.com", "desktop-notifications", "LAPTOP-stand"]:
            self.assertEqual(self.hits(sample), [], sample)

    def test_case_and_anchoring_gaps_are_closed(self):
        for sample in ["Mail ME" + "@CORP.COM", "admin" + "@example.com.evil.com", "notgit" + "@github.com.evil", "/users" + "/alice", "/HOME" + "/bob",
                       "c:" + "\\users\\carol", "desktop-" + "ab12cd3", "Laptop-" + "q1w2e3r", "~" + "/projects/x", "~" + "/developer/x", "$HOME" + "/DESKTOP/y",
                       "github_pat_" + "A1" * 15, "glpat-" + "x" * 22]:
            self.assertTrue(self.hits(sample), sample)

    def run_scan(self, *args, words="", optout=False):
        env = {k: v for k, v in os.environ.items() if k not in ("T3TOTS_PRIVATE_WORDS", "T3TOTS_NO_PRIVATE_WORDS")}
        env.update(HOME=str(self.tmp), T3TOTS_PRIVATE_WORDS=words, **({"T3TOTS_NO_PRIVATE_WORDS": "1"} if optout else {}))
        f = self.tmp / "ok.md"; f.write_text("nothing private\n")
        return subprocess.run([sys.executable, str(ROOT / "scripts" / "scan-private.py"), *args, str(f)], capture_output=True, text=True, env=env)

    def test_no_private_words_fails_when_required_unless_opted_out(self):
        r = self.run_scan("--require-words"); self.assertEqual(r.returncode, 1); self.assertIn("NO_PRIVATE_WORDS", r.stdout); self.assertIn("warning:", r.stdout)
        r = self.run_scan("--require-words", optout=True); self.assertEqual(r.returncode, 0, r.stdout); self.assertIn("on purpose", r.stdout)
        self.assertEqual(self.run_scan("--require-words", words="zorbly").returncode, 0)
        r = self.run_scan(); self.assertEqual(r.returncode, 0); self.assertIn("warning:", r.stdout)  # plain scans only warn

    def test_tools_redact_with_the_same_secret_patterns(self):
        for f in ("tools/t3listen", "tools/export.js"):
            m = re.search(r"const SECRET_KEYS = String\.raw`([^`]*)`;", (ROOT / f).read_text())
            self.assertTrue(m, f); self.assertEqual(m.group(1), self.m.SECRET_KEYS, f)


class SmallTools(unittest.TestCase):
    def test_export_and_survey_use_the_same_settled_rule_as_t3ctl(self):
        rule = 't.settledOverride==="settled"||(!!t.settledAt&&t.settledOverride!=="unsettled")'
        self.assertIn("settled:" + rule + ",", (ROOT / "tools/export.js").read_text())
        self.assertIn("if(!(" + rule + ")&&", (ROOT / "tools/survey.js").read_text())
        js = (ROOT / "tools/t3ctl").read_text()
        self.assertIn('const isSettled = (t) => t.settledOverride === "settled" || (!!t.settledAt && t.settledOverride !== "unsettled");', js)
        cases = [{}, {"settledAt": "x"}, {"settledAt": "x", "settledOverride": "unsettled"}, {"settledOverride": "unsettled"}, {"settledOverride": "settled"}]
        out = subprocess.run(["node", "-e", f"const ts={json.dumps(cases)};const a=t=>{rule};const b=require({json.dumps(str(ROOT / 'tools/t3ctl'))}).isSettled;"
                              "console.log(JSON.stringify(ts.map(t=>[a(t),b(t)])))"], capture_output=True, text=True)
        self.assertEqual(json.loads(out.stdout), [[False, False], [True, True], [False, False], [False, False], [True, True]], out.stderr)

    def test_report_tz_without_a_zone_exits_with_usage(self):
        for extra in (["--tz"], ["--tz", "--other"]):
            r = subprocess.run([sys.executable, str(ROOT / "tools/report/report.py"), "in.json", "out.html", *extra], capture_output=True, text=True)
            self.assertEqual(r.returncode, 1); self.assertIn("usage:", r.stderr); self.assertNotIn("Traceback", r.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=1)
