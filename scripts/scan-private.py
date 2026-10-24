#!/usr/bin/env python3
"""Find private details in files before they reach the repo.

Usage: python3 scripts/scan-private.py FILE_OR_FOLDER...   (exit 1 and print each hit if anything is found)
Blocks: email addresses, home folders (/Users/<name>, /home/<name>, C:\\Users\\<name>, with or without a trailing slash),
personal folders under the home folder (~ or $HOME then Developer, Projects, Documents, ...), machine ids (UUIDs),
computer names (<name>-MacBook..., MacBook host names written without a space, <host>.local, DESKTOP-<id>, LAPTOP-<id>),
secret-looking keys and webhook URLs, and your own private words, one per line in ~/.config/t3-tots/private-words.txt or comma separated in
T3TOTS_PRIVATE_WORDS. Never commit that list.
"""
import os, pathlib, re, sys

HOME_VAR = r"(?:~|\$HOME|\$\{HOME\}|%USERPROFILE%|\$env:USERPROFILE)"
PATTERNS = [
    ("email", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}"),
     re.compile(r"@(example\.(com|org)|users\.noreply\.github\.com)|git@github\.com", re.I)),
    # Home folders with or without a trailing separator. Placeholder names (you, name, user) are allowed.
    ("home folder", re.compile(r"/(?:Users|home)/[A-Za-z][A-Za-z0-9._-]*|[A-Za-z]:\\{1,2}Users\\{1,2}[A-Za-z][A-Za-z0-9._-]*"),
     re.compile(r"^/(?:Users|home)/(?:you|me|name|user|USER|Shared)$|Users\\{1,2}(?:you|name|user|USER|Public)$")),
    # A personal folder under the home folder. Dot folders, Library and t3-tots are generic, so they pass.
    ("personal path", re.compile(HOME_VAR + r"[/\\](?:Developer|Projects|Documents|Desktop|Code|code|src|dev|work|repos|git|GitHub|Sites)\b"), None),
    ("machine id", re.compile(r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b"),
     re.compile(r"00000000-0000-0000-0000-000000000000|[0-9a-f]{8}-0000-0000-0000-0000000000[0-9a-f]{2}")),
    ("computer name", re.compile(r"\b[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*-(?:MacBook|Mac-mini|iMac|Mac-Studio|Mac-Pro)[A-Za-z0-9-]*"
                                 r"|\bMac(?:Book|mini|Studio)-?(?:Pro|Air)?-?\d*\.local\b|\bMacBook-?(?:Pro|Air)(?:-\d+)?(?![ \w])"
                                 r"|\b(?:DESKTOP|LAPTOP)-[A-Z0-9]{5,}\b|\b[A-Za-z0-9-]+\.local\b"),
     re.compile(r"^(?:localhost|example|name|computer|my-computer|your-computer)\.local$", re.I)),
    ("secret key", re.compile(r"sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}"
                              r"|xox[abposr]-[A-Za-z0-9-]{10,}|xapp-[A-Za-z0-9-]{10,}|npm_[A-Za-z0-9]{30,}|glpat-[A-Za-z0-9_-]{20,}"
                              r"|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|-----BEGIN [A-Z ]*PRIVATE KEY-----"
                              r"|https://hooks\.slack\.com/services/[A-Za-z0-9/]+|https://(?:ptb\.|canary\.)?discord(?:app)?\.com/api/webhooks/\d+/[\w-]+"), None),
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
    if not words:
        print("warning: no private words set, so your name and private project names are not checked "
              "(add them to ~/.config/t3-tots/private-words.txt)")
    print(f"{'LEAKS FOUND' if hits else 'clean'} ({len(words)} private words checked)")
    return 1 if hits else 0


if __name__ == "__main__":
    sys.exit(main())
