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
POSIX_MODES = os.name != "nt"


def usable_shell(name):
    b = shutil.which(name)
    if not b:
        return None
    try:
        sees_this_checkout = subprocess.run([b, "-c", '[ -r "$1" ]', name, pathlib.Path(__file__).resolve().as_posix()], capture_output=True, timeout=30)
        return b if sees_this_checkout.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired):
        return None


BASH = usable_shell("bash")
SH = usable_shell("sh")


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
        self.assertEqual(pin, MANIFEST["version"], "t3-install-tools PIN differs from VERSION: re-pin the fetcher, then run scripts/sync-skills")
        prose = re.findall(r"This skill pins release `([^`]+)`", SKILL)
        self.assertEqual(prose, [pin], "the t3-install-tools text names a different release than its PIN")
        pinned = dict(re.findall(r'^ "([^"]+)": (\[[^\]]+\])', FETCHER, re.M))
        self.assertEqual({k: json.loads(v) for k, v in pinned.items()}, {f["path"]: [f["dest"], f["sha256"]] for f in TOOLS},
                         "t3-install-tools pins differ from manifest.json: re-pin the fetcher, then run scripts/sync-skills")
        started = (ROOT / "skills" / "t3-getting-started" / "SKILL.md").read_text(encoding="utf-8")
        self.assertTrue(started.isascii(), "t3-getting-started must stay ASCII (no em dashes)")
        url = f"https://raw.githubusercontent.com/Deepusleepy/t3-tots/{pin}/assets/avatar.png"
        fallback = "https://raw.githubusercontent.com/Deepusleepy/t3-tots/v1.4.33/assets/avatar.png"
        self.assertIn(url, started, "t3-getting-started must try the pinned-release avatar first")
        self.assertIn(fallback, started)
        if url != fallback:
            self.assertLess(started.index(url), started.index(fallback), "a 404 on the pinned tag falls back to v1.4.33")
        self.assertIn("UpdateAvatar", started)
        self.assertIn("action `set`", started)
        face = started.index("## Official face")
        self.assertLess(face, started.index("If none is registered or connected"), "official face runs before the no-computer stop")
        on_yes = started.index("## 3. On yes")
        self.assertLess(face, on_yes)
        self.assertNotIn("assets/avatar.png", started[on_yes:], "On yes must not download the avatar again")
        avatar = (ROOT / "assets" / "avatar.png").read_bytes()
        self.assertLess(len(avatar), 5 * 1024 * 1024)
        self.assertTrue(avatar.startswith(b"\x89PNG\r\n\x1a\n"))
        self.assertEqual(avatar[16:24], (1024).to_bytes(4, "big") + (1024).to_bytes(4, "big"))
        self.assertIn(hashlib.sha256(avatar).hexdigest(), started)

    def test_shipped_routine_count_matches_the_list(self):
        started = (ROOT / "skills" / "t3-getting-started" / "SKILL.md").read_text(encoding="utf-8")
        section = started[started.index("## 6. Routines"):started.index("## 7.")]
        said = re.search(r"ships with (\w+) routines", section).group(1)
        listed = re.findall(r"^- \*\*([^*]+)\*\*:", section, re.M)
        words = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]
        self.assertEqual(said, words[len(listed) - 1], f"section 6 says {said} routines but lists {len(listed)}: {listed}")
        self.assertIn("T3 Tots weekly update", listed)
        install = (ROOT / "skills" / "t3-install-tools" / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("## Weekly update run", install, "the T3 Tots weekly update routine needs its section in t3-install-tools")

    def test_box_install_is_flat_and_verified(self):
        r = run(self.f, "box", "--from", str(ROOT), dst=self.dst)
        self.assertIn('NEXT: open the t3-install-tools skill as it is now', r.stdout)  # the one line an older skill's update flow is sure to see
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        for f in TOOLS:
            self.assertEqual(sha((self.dst / f["dest"]).read_bytes()), f["sha256"], f["dest"])
        for name in ("t3ctl.cmd", "t3listen.cmd", "ui-press.applescript", "cleanup/scan.py", "report/report.py", "manifest.json", "VERSION"):
            self.assertTrue((self.dst / name).is_file(), name)
        self.assertFalse((self.dst / "tools").exists()); self.assertFalse((self.dst / "skills").exists())
        if POSIX_MODES: self.assertTrue(os.stat(self.dst / "t3ctl").st_mode & stat.S_IXUSR)
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
        if not SH:
            self.skipTest("no working sh on PATH")
        sh = run(self.f, "emit", "macos", (self.tmp / "mac").as_posix(), dst=self.dst, env={"T3TOTS_RAW_BASE": ROOT.as_uri() + "/"}).stdout
        r = subprocess.run([SH, "-c", sh], capture_output=True, text=True)
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
        if not SH:
            self.skipTest("no working sh on PATH")
        run(self.f, "box", "--from", str(ROOT), dst=self.dst)
        sh = run(self.f, "emit", "linux", (self.tmp / "lin").as_posix(), dst=self.dst, env={"T3TOTS_RAW_BASE": ROOT.as_uri() + "/"}).stdout
        self.assertNotIn("t3ui", sh)
        r = subprocess.run([SH, "-c", sh], capture_output=True, text=True)
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

    def test_stripe_style_keys_are_flagged(self):
        for sample in ["sk_" + "live_" + "a1B2" * 6, "sk_" + "test_" + "Z9y8" * 5, "rk_" + "live_" + "q" * 24, "whsec_" + "w" * 24]:
            self.assertTrue(self.hits(sample), sample)
        self.assertEqual(self.hits("task_list_items"), [])   # ordinary snake_case words are not keys

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
        for f in ("tools/t3listen", "tools/export.js", "tools/survey.js"):
            m = re.search(r"const SECRET_KEYS = String\.raw`([^`]*)`;", (ROOT / f).read_text())
            self.assertTrue(m, f); self.assertEqual(m.group(1), self.m.SECRET_KEYS, f)
        m = re.search(r'^SECRET_KEYS = r"(.*)"$', (ROOT / "tools/t3q.py").read_text(encoding="utf-8"), re.M)
        self.assertTrue(m, "tools/t3q.py"); self.assertEqual(m.group(1), self.m.SECRET_KEYS, "tools/t3q.py")

    def test_t3q_redacts_what_it_prints(self):
        src = (ROOT / "tools/t3q.py").read_text(encoding="utf-8"); ns = {"re": re, "os": os}
        exec(src[src.index("SECRET_KEYS = r"):src.index("def env_int")], ns)
        out = ns["flat"]("key sk-ant-api03-" + "abcdefghijklmnopqrstuvwxyz012345" + " then ghp_" + "abcdefghijklmnopqrstuvwxyz0123" + " then Bearer " + "abcdefghijklmnop1234" + " done", 400)
        self.assertEqual(out, "key [redacted] then [redacted] then [redacted] done")
        self.assertEqual(ns["flat"]("nothing secret here, just words", 400), "nothing secret here, just words")
        import io, contextlib
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):  # titles, git remotes and commit subjects are printed without flat()
            ns["print"]("THREAD Use ghp_" + "abcdefghijklmnopqrstuvwxyz0123" + " for CI | remote https://deploy:" + "s3cretpass" + "@github.com/a/b.git | head 1a2b3c fix basic auth | Authorization: Basic " + "dXNlcjpwYXNzd29yZDEyMw==")
        self.assertEqual(buf.getvalue(), "THREAD Use [redacted] for CI | remote https://[redacted]@github.com/a/b.git | head 1a2b3c fix basic auth | Authorization: Basic [redacted]\n")
        for plain in ("Add basic IPv4-and-IPv6-support", "http://localhost:3000?user=a@b.com"):
            self.assertEqual(ns["RED"].sub("[redacted]", plain), plain)
        for plain in ("Fix task-scheduler-retry-backoff-logic", "C:\\worktrees\\risk-assessment-for-payments-v2", "desk-booking-system-redesign", "Bearer authentication-middleware", "thread:project:20b7dd6b-aecd-42a3-a4dc-85fbcdee5f59"):
            self.assertEqual(ns["flat"](plain, 400), plain, plain)

    def test_secret_patterns_catch_base64_webhook_secrets_and_underscored_stripe_keys(self):
        keys = re.compile(self.m.SECRET_KEYS)
        for s in ("whsec_" + "MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw+/=_-", "sk_live_" + "51H8abc_DEF_ghi_jkl_mno", "rk_test_" + "abc_def_ghi_jkl_mno_pq"):
            m = keys.search("value " + s + " end"); self.assertTrue(m, s); self.assertEqual(m.group(0), s)

    def test_sensitive_names_are_the_same_in_t3ctl_t3q_and_scan(self):
        js = re.search(r"const SENSITIVE_NAME = String\.raw`([^`]*)`;", (ROOT / "tools/t3ctl").read_text()).group(1)
        for f in ("tools/t3q.py", "tools/cleanup/scan.py"):
            m = re.search(r'^SENSITIVE_NAME = r"([^"]*)"$', (ROOT / f).read_text(), re.M)
            self.assertTrue(m, f); self.assertEqual(m.group(1), js, f)

    def test_sensitive_name_split_breaks_acronyms_before_camelcase(self):
        acro, camel = r"([A-Z]+)([A-Z][a-z])", r"([a-z0-9])([A-Z])"
        for f in ("tools/t3ctl", "tools/t3q.py", "tools/cleanup/scan.py"):
            src = (ROOT / f).read_text()
            self.assertIn(acro, src, f); self.assertIn(camel, src, f)
            self.assertLess(src.index(acro), src.index(camel), f)


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
        for extra in (["--tz"], ["--tz", "--other"], ["--tz="]):
            r = subprocess.run([sys.executable, str(ROOT / "tools/report/report.py"), "in.json", "out.html", *extra], capture_output=True, text=True)
            self.assertEqual(r.returncode, 1); self.assertIn("usage:", r.stderr); self.assertNotIn("Traceback", r.stderr)

    def test_make_manifest_works_without_git_installed(self):
        no_git = {**os.environ, "PATH": tempfile.mkdtemp(prefix="t3tots-no-git-")}
        check = lambda root: subprocess.run([sys.executable, str(root / "scripts" / "make-manifest.py"), "--check"], capture_output=True, text=True, env=no_git)
        r = check(ROOT)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr); self.assertIn("manifest ok", r.stdout)
        copy = pathlib.Path(tempfile.mkdtemp(prefix="t3tots-manifest-"))
        for d in ("scripts", "tools", "skills"):
            shutil.copytree(ROOT / d, copy / d)
        for f in ("VERSION", "manifest.json"):
            shutil.copy(ROOT / f, copy)
        (copy / "tools" / "loose.py").write_text("print('not in TOOLS')\n")
        r = check(copy)
        self.assertEqual(r.returncode, 1); self.assertIn("UNLISTED_TOOL", r.stdout + r.stderr); self.assertIn("tools/loose.py", r.stdout + r.stderr)
        shutil.rmtree(copy, ignore_errors=True)


class SkillOsascript(unittest.TestCase):
    """Shell snippets that launch AppleScript helpers: paths stay in argv, escaping is documented, quotes are not claimed safe."""
    FILES = ("skills/t3-phone-answers/SKILL.md", "skills/t3-cleanup/SKILL.md")

    def test_osascript_snippets_document_escaping_and_keep_paths_out_of_script(self):
        for rel in self.FILES:
            text = (ROOT / rel).read_text()
            self.assertNotRegex(text, r"quotes are (already )?safe", msg=rel)
            self.assertIn('\\"', text, f'{rel} must document \\" inside double quotes')
            self.assertIn(r"'\''", text, f"{rel} must document '\\'' inside single quotes")
            self.assertIn("still expand inside double quotes", text, f"{rel} must note $ / backticks / \\ expand in double quotes")
            found = 0
            for m in re.finditer(r"osascript\b[^`]*", text):
                snip, found = m.group(0), found + 1
                self.assertIn("on run argv", snip, rel)
                self.assertRegex(snip, r" -- ", rel)
                inside = " ".join(re.findall(r"-e\s+'([^']*)'", snip))
                for tok in ("<path>", "<tools folder>", "<label>"):
                    self.assertNotIn(tok, inside, f"{rel}: {tok} must stay after --, not in AppleScript source")
            self.assertGreaterEqual(found, 1, rel)


class T3uiQuoting(unittest.TestCase):
    """t3ui's ks() must hand the text to osascript as an argument, never paste it into script text (no UI is driven)"""
    PAYLOAD = 'a"b $(touch PWNED1) `touch PWNED2` \\ \' -e x'
    def ks_line(self):
        line = [l for l in (ROOT / "tools" / "t3ui").read_text().splitlines() if l.startswith("ks(){")][0]
        return line
    @unittest.skipUnless(BASH, "no working bash on PATH")
    def test_text_is_an_argument_with_a_stub(self):
        d = tempfile.mkdtemp(); stub = os.path.join(d, "osascript")
        with open(stub, "w") as f: f.write('#!/bin/sh\nfor a in "$@"; do printf "%s\\0" "$a"; done > "$(dirname "$0")/args"\n')
        os.chmod(stub, 0o755)
        subprocess.run([BASH, "-c", self.ks_line() + '\nks "$1"', "ks", self.PAYLOAD], cwd=d, env={**os.environ, "PATH": d + os.pathsep + os.environ["PATH"]}, check=True)
        with open(os.path.join(d, "args")) as f: args = f.read().split("\0")[:-1]
        self.assertEqual(args[-1], self.PAYLOAD); self.assertEqual(args[-2], "--")
        self.assertFalse(any(self.PAYLOAD in a for a in args[:-1]))
        self.assertFalse(os.path.exists(os.path.join(d, "PWNED1")) or os.path.exists(os.path.join(d, "PWNED2")))
        shutil.rmtree(d, ignore_errors=True)
    @unittest.skipUnless(BASH and shutil.which("osascript"), "macOS only")
    def test_real_osascript_returns_text_literally(self):
        d = tempfile.mkdtemp()
        line = self.ks_line().replace('tell application "System Events" to keystroke (item 1 of argv)', "return item 1 of argv")
        self.assertNotIn("System Events", line)
        out = subprocess.run([BASH, "-c", line + '\nks "$1"', "ks", self.PAYLOAD], cwd=d, capture_output=True, text=True, check=True).stdout.rstrip("\n")
        self.assertEqual(out, self.PAYLOAD); self.assertEqual(os.listdir(d), [])
        shutil.rmtree(d, ignore_errors=True)


class SkillSync(unittest.TestCase):
    """What an update may do to each live skill. A bot made from the template starts with short placeholder skills; an owner may
    have edited a skill; a release may have changed it. The fetcher must tell these apart, never replace an owner's edit without
    their choice, and keep a backup of everything of theirs it may replace."""
    OLD = "v0.9.0"

    def release(self, folder, version, texts):  # a release-shaped folder: skills/<id>/SKILL.md and a manifest.json that pins them
        files = [f for f in MANIFEST["files"] if f.get("kind") != "skill"]
        for n, t in texts.items():
            (folder / "skills" / n).mkdir(parents=True); (folder / "skills" / n / "SKILL.md").write_bytes(t.encode("utf-8"))
            files.append({"path": f"skills/{n}/SKILL.md", "dest": f"{n}/SKILL.md", "kind": "skill", "sha256": hashlib.sha256(t.encode("utf-8")).hexdigest()})
        (folder / "manifest.json").write_text(json.dumps({"version": version, "files": files}))

    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp(prefix="t3tots-sync-")); self.f = fetcher(self.tmp)
        self.live = self.tmp / "live"; self.sync = self.tmp / "sync"; self.rels = self.tmp / "releases"; self.ver = MANIFEST["version"]
        self.now = {d.name: (d / "SKILL.md").read_text(encoding="utf-8") for d in sorted((ROOT / "skills").iterdir())}
        # the release the bot had before: t3-digest and t3-usage each had one line that the new release rewrote
        self.old_line = "This line was in the old release.\n"
        was = dict(self.now)
        for n in ("t3-digest", "t3-usage"): was[n] = was[n] + self.old_line
        self.release(self.rels / self.OLD, self.OLD, was); self.release(self.rels / self.ver, self.ver, self.now)
        for n, t in self.now.items():
            (self.live / n).mkdir(parents=True); self.put(n, t)
        self.put("t3-status", self.stub("t3-status"))
        self.put("t3-waiting", self.now["t3-waiting"] + "\nMy own extra rule.\n")                              # edited by the owner; the release didn't change it
        head, _, rest = was["t3-digest"].partition("\n---\n")
        self.put("t3-digest", head + "\n---\nMy note at the top.\n" + rest)                                    # the owner's edit is far from the release's change
        self.put("t3-usage", was["t3-usage"].replace(self.old_line, "I rewrote this line myself.\n"))          # the owner changed the very line the release rewrote

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def sign(self, sid, body):  # what a template build does: seal a short copy with the real command
        r = subprocess.run([sys.executable, str(self.f), "sign", sid], input=body, capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(r.returncode, 0, r.stderr); return r.stdout

    def header(self, sid, body):
        return f"---\nname: {sid}\ndescription: Short live answer. Use for status.\n---\n{body}"

    def stub(self, sid, tag=None, extra=""):  # the placeholder a template before v1.4.34 shipped, as the importing bot stores it
        tag = tag or self.ver
        return (f"---\nname: {sid}\ndescription: Short live answer. Use for status.\n---\nFollow t3-tots-rules.\n\nFull skill (pinned release {tag}): "
                f"https://raw.githubusercontent.com/Deepusleepy/t3-tots/{tag}/skills/{sid}/SKILL.md\nFetch and follow it before running any step not shown here.\n{extra}")

    def put(self, n, t):
        (self.live / n / "SKILL.md").write_bytes(t.encode("utf-8"))

    def fetch(self, *a):
        env = {"T3TOTS_LIVE_SKILLS": str(self.live), "T3TOTS_SKILL_SYNC": str(self.sync)}
        return run(self.f, *a, dst=self.tmp / "box", env=env)

    def skills(self, *a, tag=None, src=None):
        return self.fetch("skills", tag or self.ver, "--from", str(src or ROOT), "--base", self.OLD, "--base-from", str(self.rels), *a)

    def plan(self, tag=None):
        return json.loads((self.sync / (tag or self.ver) / "PLAN.json").read_text())

    def save(self, sid, entry, tag=None):  # what UpdateSkill does: name and description in a header, then the body
        e = json.loads((self.sync / (tag or self.ver) / entry).read_text())
        self.put(sid, f"---\nname: {e['name']}\ndescription: >-\n  {e['description']}\n---\n{e['body']}")

    def test_box_never_puts_an_older_release_back_over_newer_box_tools(self):
        box = self.tmp / "box"; box.mkdir(); (box / "VERSION").write_text("v99.0.0\n"); (box / "t3ctl").write_text("newer tools\n")
        r = self.fetch("box", "--from", str(ROOT)); self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("newer than this script's pin", r.stdout); self.assertNotIn("files verified", r.stdout)
        self.assertEqual((box / "VERSION").read_text(), "v99.0.0\n"); self.assertEqual((box / "t3ctl").read_text(), "newer tools\n")
        (box / "VERSION").write_text("v0.0.1\n")
        r = self.fetch("box", "--from", str(ROOT)); self.assertIn("files verified", r.stdout, r.stdout + r.stderr)
        self.assertEqual((box / "VERSION").read_text().strip(), self.ver, "older box tools are still brought up to this release")

    def test_check_tells_a_placeholder_an_owner_edit_and_a_clash_apart(self):
        r = self.skills(); self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("0 changed, 1 placeholders, 1 yours, 2 both", r.stdout)
        self.assertIn("skill placeholder: t3-status", r.stdout); self.assertIn("skill yours: t3-waiting", r.stdout)
        self.assertRegex(r.stdout, r"skill both: t3-digest .*they don't overlap"); self.assertRegex(r.stdout, r"skill both: t3-usage .*they overlap")
        self.assertIn("ASK: 2 skill(s) were edited by the owner", r.stdout)
        self.assertIn("NEXT: 1 skill(s) are still template placeholders", r.stdout)
        self.assertFalse((self.sync / self.ver).exists(), "a check prepares nothing")

    def test_write_never_puts_an_owner_edit_in_the_apply_list_and_backs_up_what_it_may_replace(self):
        r = self.skills("--write"); self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        p = self.plan(); out = self.sync / self.ver
        self.assertEqual([e["id"] for e in p["apply_in_order"]], ["t3-status"])
        self.assertEqual(p["yours_kept"], ["t3-waiting"])
        ask = {e["id"]: e for e in p["ask_the_owner"]}; self.assertEqual(sorted(ask), ["t3-digest", "t3-usage"])
        self.assertFalse(ask["t3-digest"]["overlap"]); self.assertTrue(ask["t3-usage"]["overlap"]); self.assertNotIn("keep_my_edit", ask["t3-usage"])
        self.assertTrue(ask["t3-usage"]["keep_mine_allowed"])
        merged = json.loads((out / ask["t3-digest"]["keep_my_edit"]).read_text())["body"]
        self.assertIn("My note at the top.", merged); self.assertNotIn(self.old_line.strip(), merged)
        self.assertIn("My note at the top.", (out / ask["t3-digest"]["your_edit"]).read_text()); self.assertIn("-" + self.old_line.strip(), (out / ask["t3-digest"]["release_change"]).read_text())
        backed = sorted(f.name for f in pathlib.Path(p["backups"]).iterdir())
        self.assertEqual(backed, ["t3-digest.SKILL.md", "t3-status.SKILL.md", "t3-usage.SKILL.md"], "every live copy this run may replace")
        self.assertIn("I rewrote this line myself.", (pathlib.Path(p["backups"]) / "t3-usage.SKILL.md").read_text(encoding="utf-8"))

    def test_placeholders_only_prepares_just_the_full_copy(self):
        r = self.skills("--write", "--placeholders"); self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        ph = self.ver + "-placeholders"
        p = self.plan(ph); self.assertEqual([e["id"] for e in p["apply_in_order"]], ["t3-status"]); self.assertEqual(p["ask_the_owner"], [])
        self.assertEqual((self.sync / ph / "t3-status.SKILL.md").read_text(encoding="utf-8"), self.now["t3-status"])
        shutil.copy(self.sync / ph / "t3-status.SKILL.md", self.live / "t3-status" / "SKILL.md")
        again = self.skills(); self.assertIn("0 placeholders", again.stdout); self.assertNotIn("NEXT:", again.stdout)

    def settle(self):  # the owner answers: digest "update and keep my edit", usage "keep mine"
        self.skills("--write"); ask = {e["id"]: e for e in self.plan()["ask_the_owner"]}
        self.save("t3-status", "t3-status.json"); self.save("t3-digest", ask["t3-digest"]["keep_my_edit"])
        k = self.fetch("keep", "t3-usage", self.ver); self.assertIn("OK t3-usage", k.stdout, k.stdout + k.stderr)
        return ask

    def test_each_choice_is_remembered_so_the_owner_is_not_asked_again(self):
        ask = self.settle()
        r = self.skills(); self.assertIn("0 changed, 0 placeholders, 3 yours, 0 both", r.stdout, r.stdout + r.stderr); self.assertNotIn("ASK:", r.stdout)
        self.assertRegex(r.stdout, r"skill yours: t3-usage .*kept by your choice")
        self.assertEqual(self.skills().stdout, r.stdout, "a second check says the same")
        self.put("t3-usage", (self.live / "t3-usage" / "SKILL.md").read_text(encoding="utf-8") + "\nA hand-merged copy.\n")
        rb = self.fetch("rebase", "t3-usage", self.ver); self.assertIn("OK t3-usage", rb.stdout, rb.stdout + rb.stderr)
        r = self.skills(); self.assertIn("3 yours, 0 both", r.stdout, r.stdout + r.stderr); self.assertNotIn("kept by your choice", r.stdout)
        self.save("t3-usage", ask["t3-usage"]["take_new"])        # "take the new one"
        r = self.skills(); self.assertIn("2 yours, 0 both", r.stdout, r.stdout + r.stderr)

    def test_after_keep_mine_the_next_release_still_updates_the_untouched_skills_and_asks_only_about_what_changed_again(self):
        self.settle(); self.skills()
        nxt = dict(self.now); nxt["t3-new-thread"] += "\nA new rule in the next release.\n"; nxt["t3-usage"] += "\nThe next release changed this skill again.\n"
        self.release(self.tmp / "next", "v9.9.9", nxt)
        r = self.skills(tag="v9.9.9", src=self.tmp / "next"); self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("2 changed, 0 placeholders, 2 yours, 1 both", r.stdout, r.stdout)
        self.assertIn("skill changed: t3-new-thread", r.stdout); self.assertIn("skill changed: t3-install-tools", r.stdout)
        self.assertIn("skill yours: t3-digest", r.stdout); self.assertIn("skill yours: t3-waiting", r.stdout)
        self.assertRegex(r.stdout, r"skill both: t3-usage .*since v0\.9\.0", "asked again, and still compared with the release the owner's edit was made on")
        same = dict(self.now); same["t3-new-thread"] += "\nA new rule in the next release.\n"
        self.release(self.tmp / "quiet", "v9.9.8", same)
        q = self.skills(tag="v9.9.8", src=self.tmp / "quiet")
        self.assertRegex(q.stdout, r"skill yours: t3-usage .*kept by your choice", "a release that didn't touch the kept skill doesn't ask"); self.assertNotIn("ASK:", q.stdout)

    def test_the_update_skill_itself_is_never_taken_for_an_owner_edit_because_of_its_pins_and_cannot_be_kept(self):
        rows = re.search(r"PINNED = \{\n(.*?)\n\}", self.now["t3-install-tools"], re.S).group(1).split(",\n")
        shuffled = self.now["t3-install-tools"].replace(",\n".join(rows), ",\n".join(rows[1:] + rows[:1])).replace(f'PIN = "{self.ver}"', 'PIN = "v0.9.0"')
        self.put("t3-install-tools", shuffled)   # an older copy: another pin, and its rows in another order
        r = self.skills(); self.assertIn("skill changed: t3-install-tools", r.stdout, r.stdout + r.stderr); self.assertNotIn("your edit is kept", r.stdout)
        k = self.fetch("keep", "t3-install-tools", self.ver); self.assertNotEqual(k.returncode, 0); self.assertIn("CANNOT_KEEP", k.stdout + k.stderr)

    def test_an_edited_update_skill_keeps_the_edit_and_only_its_pins_move_with_no_question(self):
        for n in ("t3-status", "t3-digest", "t3-usage"): self.put(n, self.now[n])
        self.put("t3-install-tools", self.now["t3-install-tools"] + "\nMy own note about installing.\n")
        r = self.skills(); self.assertIn("skill yours: t3-install-tools", r.stdout, r.stdout + r.stderr); self.assertNotIn("ASK:", r.stdout)
        self.release(self.tmp / "next", "v9.9.9", dict(self.now))
        r = self.skills("--write", tag="v9.9.9", src=self.tmp / "next"); self.assertNotIn("ASK:", r.stdout, r.stdout + r.stderr)
        self.assertRegex(r.stdout, r"skill changed: t3-install-tools .*your edit is kept")
        p = self.plan("v9.9.9"); self.assertEqual([e["id"] for e in p["apply_in_order"]], ["t3-install-tools"]); self.assertEqual(p["ask_the_owner"], [])
        self.save("t3-install-tools", "t3-install-tools.json", "v9.9.9")
        text = (self.live / "t3-install-tools" / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("My own note about installing.", text); self.assertIn('PIN = "v9.9.9"', text)
        for _ in range(2):
            r = self.skills(tag="v9.9.9", src=self.tmp / "next")
            self.assertIn("skill yours: t3-install-tools", r.stdout, r.stdout + r.stderr); self.assertNotIn("ASK:", r.stdout)

    def test_an_edited_update_skill_that_the_release_also_changed_is_asked_about_and_cannot_be_kept(self):
        self.put("t3-install-tools", self.now["t3-install-tools"] + "\nMy own note about installing.\n"); self.skills()
        nxt = dict(self.now); nxt["t3-install-tools"] = nxt["t3-install-tools"].replace("## Box copy", "## Box copy\nA new line from the release.", 1)
        self.release(self.tmp / "next", "v9.9.9", nxt)
        self.skills("--write", tag="v9.9.9", src=self.tmp / "next")
        e = {x["id"]: x for x in self.plan("v9.9.9")["ask_the_owner"]}["t3-install-tools"]
        self.assertFalse(e["keep_mine_allowed"]); self.assertFalse(e["overlap"])
        body = json.loads((self.sync / "v9.9.9" / e["keep_my_edit"]).read_text())["body"]
        self.assertIn("My own note about installing.", body); self.assertIn("A new line from the release.", body); self.assertIn('PIN = "v9.9.9"', body)

    def test_a_skill_whose_history_cannot_be_read_is_asked_about_never_replaced(self):
        self.put("t3-templates", self.now["t3-templates"] + "\nMy own rule.\n")
        r = self.fetch("skills", self.ver, "--from", str(ROOT), "--base", "v0.1.0", "--write")   # that release can't be read from this folder
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr); self.assertRegex(r.stdout, r"skill both: t3-templates .*can't be read")
        p = self.plan(); self.assertNotIn("t3-templates", [e["id"] for e in p["apply_in_order"]])
        e = {x["id"]: x for x in p["ask_the_owner"]}["t3-templates"]; self.assertNotIn("keep_my_edit", e); self.assertNotIn("your_edit", e)
        self.assertIn("My own rule.", (pathlib.Path(p["backups"]) / "t3-templates.SKILL.md").read_text(encoding="utf-8"))

    def test_a_state_file_that_cannot_be_trusted_never_leads_to_a_silent_replace(self):
        self.skills()
        for junk in ("[]", "{not json", '{"t3-usage": 5}'):
            (self.sync / "skills-state.json").write_text(junk)
            r = self.skills("--write"); self.assertEqual(r.returncode, 0, junk + r.stdout + r.stderr)
            self.assertEqual([e["id"] for e in self.plan()["apply_in_order"]], ["t3-status"], junk)
            self.assertEqual(sorted(e["id"] for e in self.plan()["ask_the_owner"]), ["t3-digest", "t3-usage"], junk)

    def test_skipping_one_update_never_makes_another_skill_look_edited(self):
        for n in ("t3-status", "t3-digest", "t3-usage", "t3-waiting"): self.put(n, self.now[n])
        self.skills()
        v2 = dict(self.now); v2["t3-new-thread"] += "\nNew in v2.\n"; v2["t3-watch"] += "\nNew in v2.\n"
        self.release(self.tmp / "v2", "v9.9.2", v2); self.skills("--write", tag="v9.9.2", src=self.tmp / "v2")
        self.save("t3-new-thread", "t3-new-thread.json", "v9.9.2")   # applied; t3-watch was skipped
        self.skills(tag="v9.9.2", src=self.tmp / "v2")
        v3 = dict(v2); v3["t3-new-thread"] += "\nNew in v3.\n"
        self.release(self.tmp / "v3", "v9.9.3", v3)
        r = self.skills(tag="v9.9.3", src=self.tmp / "v3")
        self.assertIn("skill changed: t3-new-thread", r.stdout, r.stdout + r.stderr); self.assertIn("skill changed: t3-watch", r.stdout)
        self.assertIn("0 yours, 0 both", r.stdout); self.assertNotIn("ASK:", r.stdout)

    def test_a_saved_copy_is_recognised_at_the_next_release_even_when_no_check_ran_in_between(self):
        self.skills("--write"); ask = {e["id"]: e for e in self.plan()["ask_the_owner"]}
        self.save("t3-status", "t3-status.json")                    # applied from the plan
        self.save("t3-usage", ask["t3-usage"]["take_new"])           # the owner took the new one
        self.save("t3-digest", ask["t3-digest"]["keep_my_edit"])     # the owner kept their edit on the new version
        self.assertIn("My note at the top.", (self.sync / self.ver / ask["t3-digest"]["merged_vs_new"]).read_text())
        nxt = dict(self.now)
        for n in ("t3-status", "t3-usage", "t3-digest"): nxt[n] += "\nNew in the next release.\n"
        self.release(self.tmp / "next", "v9.9.9", nxt)
        r = self.skills(tag="v9.9.9", src=self.tmp / "next"); self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("skill changed: t3-status", r.stdout, r.stdout); self.assertIn("skill changed: t3-usage", r.stdout, "it is the plain release copy now")
        self.assertRegex(r.stdout, r"skill both: t3-digest \(\+\d+/-0 lines by you, .*since " + re.escape(self.ver), "only the owner's own lines count as theirs")

    def test_box_tools_already_on_this_release_say_nothing_about_a_skill_that_differs(self):
        for n in ("t3-status", "t3-digest", "t3-waiting"): self.put(n, self.now[n])
        self.put("t3-usage", (self.rels / self.OLD / "skills" / "t3-usage" / "SKILL.md").read_text(encoding="utf-8"))   # an untouched copy of the older release
        box = self.tmp / "box"; box.mkdir(); (box / "VERSION").write_text(self.ver + "\n")
        r = self.fetch("skills", self.ver, "--from", str(ROOT), "--write"); self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertRegex(r.stdout, r"skill both: t3-usage .*can't be read"); self.assertNotIn("skill yours: t3-usage", r.stdout)
        self.assertEqual(self.plan()["apply_in_order"], [])

    def test_only_the_exact_template_text_is_a_placeholder_so_one_the_owner_added_to_is_asked_about(self):
        for n in ("t3-digest", "t3-waiting", "t3-usage"): self.put(n, self.now[n])
        self.put("t3-status", self.stub("t3-status", "v1.4.30"))                                        # an older template's placeholder
        self.put("t3-watch", "---\nname: t3-watch\ndescription: Watch things.\n---\nFollow t3-tots-rules.\n\nFull skill: skills/t3-watch/SKILL.md in github.com/Deepusleepy/t3-tots release v1.4.28.\n")
        self.put("t3-usage", self.stub("t3-usage", extra="MY RULE: always answer in Spanish.\n"))         # the owner added a line to theirs
        self.put("t3-sync", self.stub("t3-update"))                                                     # it names another skill
        self.put("t3-templates", "---\nname: t3-templates\ndescription: Mine.\n---\nMy own short version. See skills/t3-templates/SKILL.md.\n")
        r = self.skills("--write", "--placeholders"); self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("skill placeholder: t3-status", r.stdout); self.assertIn("skill placeholder: t3-watch", r.stdout)
        self.assertRegex(r.stdout, "skill both: t3-usage", r.stdout)   # the release changed this skill too, so the owner is asked
        for mine in ("t3-sync", "t3-templates"): self.assertRegex(r.stdout, "skill yours: " + mine, r.stdout)   # theirs, and the release didn't change it: kept
        self.assertEqual(sorted(e["id"] for e in self.plan(self.ver + "-placeholders")["apply_in_order"]), ["t3-status", "t3-watch"])
        self.skills("--write"); p = self.plan()
        self.assertEqual(sorted(e["id"] for e in p["apply_in_order"]), ["t3-status", "t3-watch"])
        self.assertEqual([e["id"] for e in p["ask_the_owner"]], ["t3-usage"]); self.assertEqual(p["yours_kept"], ["t3-sync", "t3-templates"])
        self.assertIn("MY RULE", (pathlib.Path(p["backups"]) / "t3-usage.SKILL.md").read_text(encoding="utf-8"))

    def test_a_sealed_template_copy_is_a_placeholder_in_any_wording_until_one_character_changes(self):
        for n in ("t3-status", "t3-digest", "t3-waiting", "t3-usage"): self.put(n, self.now[n])
        short = "My own wording for a short copy.\n\nRead the full skill on GitHub before any step.\n"
        signed = self.sign("t3-watch", short); self.assertRegex(signed, r"\n\[T3 Tots template copy, check [0-9a-f]{64}\]\n$")
        cases = {"t3-watch": signed,                                                        # as shipped
                 "t3-sync": self.sign("t3-sync", short).replace("\n", "\r\n"),             # the platform stored other line ends
                 "t3-update": self.sign("t3-update", short).replace("copy.\n", "copy.  \n") + "\n\n",  # trailing spaces and blank lines
                 "t3-templates": self.sign("t3-templates", short).replace("My own", "My OWN"),            # the owner changed one word
                 "t3-new-thread": self.sign("t3-new-thread", short).rsplit("\n[", 1)[0] + "\n",          # the seal line is gone
                 "t3-handoff": self.sign("t3-watch", short),                                              # another skill's sealed copy
                 "t3-checkup": self.sign("t3-checkup", short).replace("\n[T3", "\nMY RULE: answer in Spanish.\n[T3")}  # a line added above the seal
        for sid, body in cases.items(): self.put(sid, self.header(sid, body))
        r = self.skills("--write"); self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        for sid in ("t3-watch", "t3-sync", "t3-update"): self.assertIn(f"skill placeholder: {sid}", r.stdout, r.stdout)
        for sid in ("t3-templates", "t3-new-thread", "t3-handoff", "t3-checkup"): self.assertNotIn(f"skill placeholder: {sid}", r.stdout, r.stdout)
        p = self.plan(); self.assertEqual(sorted(e["id"] for e in p["apply_in_order"]), ["t3-sync", "t3-update", "t3-watch"])
        kept = set(p["yours_kept"]) | {e["id"] for e in p["ask_the_owner"]}
        self.assertEqual(kept, {"t3-templates", "t3-new-thread", "t3-handoff", "t3-checkup"}, "each is the owner's: kept or asked about, never replaced")

    def test_a_placeholders_only_run_leaves_the_choices_still_waiting_for_the_owner(self):
        self.skills("--write"); before = self.plan()["ask_the_owner"]; self.assertEqual(len(before), 2)
        self.skills("--write", "--placeholders")
        self.assertEqual(self.plan()["ask_the_owner"], before); self.assertTrue((self.sync / self.ver / before[0]["take_new"]).exists())

    def test_naming_the_release_being_checked_as_the_base_says_nothing_about_a_skill(self):
        for n in ("t3-status", "t3-digest", "t3-waiting"): self.put(n, self.now[n])
        self.put("t3-usage", (self.rels / self.OLD / "skills" / "t3-usage" / "SKILL.md").read_text(encoding="utf-8"))   # an untouched copy of the older release
        r = self.fetch("skills", self.ver, "--from", str(ROOT), "--base", self.ver)
        self.assertRegex(r.stdout, r"skill both: t3-usage .*can't be read", r.stdout + r.stderr); self.assertNotIn("skill yours: t3-usage", r.stdout)

    def test_keep_mine_holds_at_the_next_release_with_no_check_in_between(self):
        self.skills("--write"); k = self.fetch("keep", "t3-usage", self.ver); self.assertIn("OK t3-usage", k.stdout, k.stdout + k.stderr)
        same = dict(self.now); same["t3-new-thread"] += "\nA new rule in the next release.\n"
        self.release(self.tmp / "quiet", "v9.9.8", same)
        q = self.skills(tag="v9.9.8", src=self.tmp / "quiet")
        self.assertRegex(q.stdout, r"skill yours: t3-usage .*kept by your choice", q.stdout + q.stderr); self.assertNotRegex(q.stdout, r"skill both: t3-usage")

    def test_state_records_of_the_wrong_shape_are_dropped_not_crashed_on(self):
        self.skills()
        for junk in ('{"t3-usage": {"offered": "x"}}', '{"t3-usage": {"kept": "v1"}}', '{"t3-usage": {"tag": 5}}', '{"t3-usage": {"offered": {"tag": "v1"}}}'):
            (self.sync / "skills-state.json").write_text(junk)
            r = self.skills(); self.assertEqual(r.returncode, 0, junk + r.stdout + r.stderr); self.assertNotIn("Traceback", r.stderr, junk)
            self.assertRegex(r.stdout, r"skill both: t3-usage", junk)

    def test_keep_my_edit_carries_an_edited_name_or_description_too(self):
        for n in ("t3-status", "t3-waiting", "t3-usage"): self.put(n, self.now[n])
        base = (self.rels / self.OLD / "skills" / "t3-digest" / "SKILL.md").read_text(encoding="utf-8")
        self.put("t3-digest", base.replace("description: >-\n", "description: >-\n  MINE:", 1))   # only the description was edited
        self.skills("--write"); e = {x["id"]: x for x in self.plan()["ask_the_owner"]}["t3-digest"]
        self.assertIn("MINE:", (self.sync / self.ver / e["your_edit"]).read_text(), "the owner's edit is shown even when the body is untouched")
        merged = json.loads((self.sync / self.ver / e["keep_my_edit"]).read_text())
        self.assertTrue(merged["description"].startswith("MINE:"), merged["description"]); self.assertNotIn(self.old_line.strip(), merged["body"])

    def test_merge_joins_changes_on_neighbouring_lines_and_refuses_ones_that_meet(self):
        ns = {}; exec(FETCHER[FETCHER.index("def merge3("):FETCHER.index("pick = lambda")], {"difflib": __import__("difflib")}, ns); m3 = ns["merge3"]
        self.assertEqual(m3(list("abc"), list("Abc"), list("aBc")), list("ABc"), "one changed line each, side by side")
        self.assertEqual(m3(list("abc"), list("xabc"), list("abcy")), list("xabcy"), "one added at the start, one at the end")
        self.assertIsNone(m3(list("abc"), list("aXbc"), list("aYbc")), "both added at the same place")
        self.assertIsNone(m3(list("abc"), list("aXc"), list("aYc")), "both changed the same line")
        self.assertIsNone(m3(list("abc"), list("aXbc"), list("aBc")), "an added line right at a changed one")
        self.assertEqual(m3(list("aab"), list("aaXb"), list("Aab")), list("AaXb"), "repeated lines")

    def test_an_edit_that_only_changes_indentation_counts_as_an_edit(self):
        lines = self.now["t3-templates"].split("\n"); i = max(k for k, l in enumerate(lines) if l.startswith("- "))
        lines[i] = "  " + lines[i]; self.put("t3-templates", "\n".join(lines))
        self.assertIn("skill yours: t3-templates", self.skills().stdout)


if __name__ == "__main__":
    unittest.main(verbosity=1)
