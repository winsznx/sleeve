#!/usr/bin/env bash
# Blocks a push when a Sleeve key or service secret appears in the working tree or in any commit.
# Matches are reported by file or commit only. Secret values are never printed.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

keydir="${SLEEVE_KEY_DIR:-$HOME/.sleeve-keys}"
status=0
patterns="$(mktemp)"
trap 'rm -f "$patterns"' EXIT

if [ -d "$keydir" ]; then
  for f in "$keydir"/*.key; do
    [ -f "$f" ] || continue
    k="$(tr -d '\n' < "$f")"
    printf '%s\n%s\n' "$k" "${k#0x}" >> "$patterns"
  done
  if [ -f "$keydir/services.env" ]; then
    grep -E '^[A-Z0-9_]+=.{12,}$' "$keydir/services.env" | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' >> "$patterns" || true
  fi
fi

if [ -s "$patterns" ]; then
  if git grep --untracked -I -l -F -f "$patterns" -- . ; then
    echo "secret-scan: a Sleeve secret appears in the files listed above"
    status=1
  fi
  if git rev-parse --verify HEAD >/dev/null 2>&1; then
    while read -r commit; do
      if git show "$commit" | grep -I -q -F -f "$patterns"; then
        echo "secret-scan: a Sleeve secret appears in commit $commit"
        status=1
      fi
    done < <(git rev-list --all)
  fi
fi

if command -v gitleaks >/dev/null; then
  gitleaks git --redact --no-banner --log-level warn . || status=1
else
  echo "secret-scan: gitleaks not installed"
  status=1
fi

[ "$status" -eq 0 ] && echo "secret-scan: clean"
exit "$status"
