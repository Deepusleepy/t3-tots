#!/usr/bin/env bash
# Run every check before a commit or release: syntax, unit tests, manifest, public safety.
# Usage: scripts/check.sh   (from anywhere; needs bash, node 18+, python3)
# Extra private words to block (your name, project names) go one per line in
# ~/.config/t3-tots/private-words.txt or in T3TOTS_PRIVATE_WORDS (comma separated). Never commit that list.
set -u
cd "$(dirname "$0")/.." || exit 1
fail=0
step() { printf '%-28s' "$1"; }
ok() { echo ok; }
bad() { echo "FAIL"; [ -n "${1:-}" ] && printf '%s\n' "$1" | sed 's/^/    /'; fail=1; }

step "node --check"
out=""; for f in t3ctl t3listen export.js survey.js; do r=$(node --check "$f" 2>&1) || out+="$f: $r"$'\n'; done
[ -z "$out" ] && ok || bad "$out"

step "python compile"
r=$(python3 - <<'PY' 2>&1
for f in ["t3q.py", "cleanup/scan.py", "cleanup/make_report.py", "report/report.py", "scripts/make-manifest.py"]:
    compile(open(f, encoding="utf-8").read(), f, "exec")  # syntax only, writes no .pyc
PY
) && ok || bad "$r"

step "unit tests"
r=$(node --test tests/*.test.js 2>&1) && ok || bad "$r"

step "manifest"
r=$(python3 scripts/make-manifest.py --check 2>&1) && ok || bad "$r"

step "line endings"
r=$(python3 -c "import sys; d=open('t3ctl.cmd','rb').read(); sys.exit(0 if b'\r\n' in d else 1)" 2>&1) && ok || bad "t3ctl.cmd must keep CRLF line endings"

step "public safety"
words=()
[ -f "$HOME/.config/t3-tots/private-words.txt" ] && while IFS= read -r w; do [ -n "$w" ] && words+=("$w"); done < "$HOME/.config/t3-tots/private-words.txt"
IFS=',' read -r -a extra <<< "${T3TOTS_PRIVATE_WORDS:-}"; for w in "${extra[@]}"; do [ -n "$w" ] && words+=("$w"); done
files=$(git ls-files 2>/dev/null || find . -type f -not -path './.git/*')
hits=""
# generic leaks: email addresses (except example/noreply), real home folders, secret-looking keys
r=$(grep -nIE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}' $files | grep -viE '@(example\.(com|org)|users\.noreply\.github\.com)|git@github\.com' ) && hits+="$r"$'\n'
r=$(grep -nIE '/Users/[a-z][a-z0-9._-]+/|[Cc]:\\\\?Users\\\\?[a-z][a-z0-9._-]+\\\\' $files | grep -vE '/Users/(you|me|name|user|USER)/|Users\\\\?(you|name|user|USER)\\\\' ) && hits+="$r"$'\n'
r=$(grep -nIE '(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[bp]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})' $files) && hits+="$r"$'\n'
for w in "${words[@]}"; do r=$(grep -nIiwF -- "$w" $files) && hits+="private word '$w':"$'\n'"$r"$'\n'; done
hits=$(printf '%s' "$hits" | sed '/^$/d')
[ -z "$hits" ] && echo "ok (${#words[@]} private words checked)" || bad "$hits"

[ $fail = 0 ] && echo "ALL CHECKS PASSED" || echo "CHECKS FAILED"
exit $fail
