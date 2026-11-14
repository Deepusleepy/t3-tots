#!/usr/bin/env python3
"""tools/cleanup/scan.py --dupes: duplicates are found, and secret, key, .env, .ssh and token files are never opened or hashed."""
import builtins, io, json, os, pathlib, runpy, sys, tempfile, unittest, contextlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SCAN = str(ROOT / "tools" / "cleanup" / "scan.py")


class Dupes(unittest.TestCase):
    def test_dupes_skip_sensitive_paths_before_opening(self):
        tmp = pathlib.Path(tempfile.mkdtemp(prefix="t3scan-"))
        body = b"same bytes " * 20000
        plain = ["a/movie.bin", "b/movie copy.bin", "author.md", "docs/authority.bin"]
        sensitive = ["secrets/movie.bin", ".ssh/id_backup", "app/.env", "app/.env.development", "MyToken.bin", "keys/server.pem", "auth/cache.bin", "googleAuth.bin", "x/id_ed25519", "HTTPAuth.bin", "getHTTPAuth.ts", "XMLAuth.bin"]
        for rel in plain + sensitive:
            p = tmp / rel; p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(body)
        opened, real_open = [], builtins.open
        def spy(f, *a, **k):
            opened.append(os.fspath(f)) if not isinstance(f, int) else None; return real_open(f, *a, **k)
        out, argv = io.StringIO(), sys.argv
        sys.argv = [SCAN, str(tmp), "--dupes", "--dupe-min-mb", "0.01", "--jobs", "1"]
        try:
            builtins.open = spy
            with contextlib.redirect_stdout(out): runpy.run_path(SCAN, run_name="__main__")
        finally:
            builtins.open = real_open; sys.argv = argv
        rel = lambda p: pathlib.PurePath(os.path.relpath(p, tmp)).as_posix()
        dup = [sorted(rel(p) for p in g["paths"]) for g in json.loads(out.getvalue())["results"][0]["duplicates"]]
        self.assertEqual(dup, [sorted(plain)])
        touched = {rel(p) for p in opened if p.startswith(str(tmp))}
        self.assertFalse(touched & set(sensitive), touched & set(sensitive))


class OtherUsers(unittest.TestCase):
    def scan(self, home, *roots):
        out, argv, env = io.StringIO(), sys.argv, dict(os.environ)
        sys.argv = [SCAN, *map(str, roots), "--jobs", "1", "--min-gb", "0"]
        os.environ["HOME"] = os.environ["USERPROFILE"] = str(home)
        try:
            with contextlib.redirect_stdout(out): runpy.run_path(SCAN, run_name="__main__")
        finally:
            sys.argv = argv; os.environ.clear(); os.environ.update(env)
        return json.loads(out.getvalue())["results"]

    def test_a_wide_scan_never_enters_another_users_home(self):
        tmp = pathlib.Path(tempfile.mkdtemp(prefix="t3scan-"))
        for rel in ("home/me/mine.bin", "home/other/theirs.bin", "home/Shared/all.bin", "data/home2/x.bin"):
            p = tmp / rel; p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(b"x" * 300000)
        seen, real_scandir = [], os.scandir
        def spy(path="."):
            seen.append(os.fspath(path)); return real_scandir(path)
        os.scandir = spy
        try: res = self.scan(tmp / "home" / "me", tmp)[0]
        finally: os.scandir = real_scandir
        self.assertEqual(res["other_users_skipped"], 1)
        self.assertFalse([p for p in seen if pathlib.Path(p).name == "other"], "the other account's folder is never listed")
        for kept in ("me", "Shared", "home2"): self.assertTrue([p for p in seen if pathlib.Path(p).name == kept], kept)

    def test_a_root_inside_another_users_home_is_refused(self):
        tmp = pathlib.Path(tempfile.mkdtemp(prefix="t3scan-"))
        for rel in ("home/me/a.bin", "home/other/deep/b.bin"):
            p = tmp / rel; p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(b"x")
        res = self.scan(tmp / "home" / "me", tmp / "home" / "other" / "deep", tmp / "home" / "me")
        self.assertIn("another user", res[0]["error"]); self.assertNotIn("error", res[1])


if __name__ == "__main__":
    unittest.main()
