#!/usr/bin/env python3
"""Find private details in files before they reach the repo.

Usage: python3 scripts/scan-private.py FILE_OR_FOLDER...   (exit 1 and print each hit if anything is found)
Blocks: email addresses, personal home folders, machine ids (UUIDs), computer names, secret-looking keys,
and your own private words, one per line in ~/.config/t3-tots/private-words.txt or comma separated in
T3TOTS_PRIVATE_WORDS. Never commit that list.
"""
import os, pathlib, re, sys

PATTERNS = [
    ("email", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}"),
     re.compile(r"@(example\.(com|org)|users\.noreply\.github\.com)|git@github\.com", re.I)),
    ("home folder", re.compile(r"/Users/[A-Za-z][A-Za-z0-9._-]+/|/home/[A-Za-z][A-Za-z0-9._-]+/|[Cc]:\\{1,2}Users\\{1,2}[A-Za-z][A-Za-z0-9._-]+\\"),
     re.compile(r"/(Users|home)/(you|me|name|user|USER|Shared|box)/|Users\\{1,2}(you|name|user|USER|Public)\\")),
    ("machine id", re.compile(r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b"),
     re.compile(r"00000000-0000-0000-0000-000000000000|[0-9a-f]{8}-0000-0000-0000-0000000000[0-9a-f]{2}")),
    ("computer name", re.compile(r"\b[A-Za-z0-9-]+-(MacBook|Mac-mini|iMac|Mac-Studio)[A-Za-z0-9-]*|\bDESKTOP-[A-Z0-9]{7}\b"), None),
    ("secret key", re.compile(r"sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[bp]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}"), None),
]


def private_words():
    words = []
    f = pathlib.Path.home() / ".config" / "t3-tots" / "private-words.txt"
    if f.is_file():
        words += [w.strip() for w in f.read_text(encoding="utf-8").splitlines()]
    words += os.environ.get("T3TOTS_PRIVATE_WORDS", "").split(",")
    return sorted({w.strip() for w in words if w.strip()}, key=str.lower)


def files(args):
    for a in args:
        p = pathlib.Path(a)
        if p.is_dir():
            yield from sorted(x for x in p.rglob("*") if x.is_file() and ".git" not in x.parts and "__pycache__" not in x.parts)
        elif p.is_file():
            yield p


def scan(paths, words):
    word_res = [(w, re.compile(r"(?<!\w)" + re.escape(w) + r"(?!\w)", re.I)) for w in words]
    hits = []
    for f in paths:
        data = f.read_bytes()
        if b"\0" in data[:8192]:
            continue  # binary
        for n, line in enumerate(data.decode("utf-8", "replace").splitlines(), 1):
            for kind, rx, allow in PATTERNS:
                for m in rx.finditer(line):
                    if not (allow and allow.search(m.group(0))):
                        hits.append(f"{f}:{n}: {kind}: {m.group(0)}")
            for w, rx in word_res:
                if rx.search(line):
                    hits.append(f"{f}:{n}: private word '{w}'")
    return hits


def main():
    if len(sys.argv) < 2:
        print(__doc__.strip())
        return 2
    words = private_words()
    hits = scan(list(files(sys.argv[1:])), words)
    for h in hits:
        print(h)
    print(f"{'LEAKS FOUND' if hits else 'clean'} ({len(words)} private words checked)")
    return 1 if hits else 0


if __name__ == "__main__":
    sys.exit(main())
