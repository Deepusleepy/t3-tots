#!/usr/bin/env python3
"""Rewrite manifest.json and manifest.sha256 from the files in this repo.

Usage: python3 scripts/make-manifest.py [--check]
Takes the version from VERSION. Keeps each file's targets and purpose.
--check writes nothing and exits 1 if either manifest is out of date.
"""
import hashlib, json, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def main() -> int:
    check = "--check" in sys.argv[1:]
    version = (ROOT / "VERSION").read_text().strip()
    m = json.loads((ROOT / "manifest.json").read_text())
    m["version"] = version
    m["raw_base"] = m["raw_base"].rsplit("/", 2)[0] + f"/{version}/"
    lines = []
    for f in m["files"]:
        data = (ROOT / f["path"]).read_bytes()
        f["bytes"] = len(data)
        f["sha256"] = hashlib.sha256(data).hexdigest()
        lines.append(f"{f['sha256']}  {f['path']}")
    new_json = json.dumps(m, indent=1, ensure_ascii=False) + "\n"
    new_sums = "\n".join(lines) + "\n"
    old_json = (ROOT / "manifest.json").read_text()
    old_sums = (ROOT / "manifest.sha256").read_text()
    if check:
        stale = [n for n, a, b in (("manifest.json", old_json, new_json), ("manifest.sha256", old_sums, new_sums)) if a != b]
        if stale:
            print("MANIFEST_STALE: " + ", ".join(stale) + " (run: python3 scripts/make-manifest.py)")
            return 1
        print(f"manifest ok ({len(lines)} files, {version})")
        return 0
    (ROOT / "manifest.json").write_text(new_json)
    (ROOT / "manifest.sha256").write_text(new_sums)
    print(f"wrote manifest.json and manifest.sha256 ({len(lines)} files, {version})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
