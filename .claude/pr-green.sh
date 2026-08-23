#!/usr/bin/env bash
# pr-green.sh — is this pull request actually green? `gh pr checks --watch` cannot answer that.
#
# `gh pr checks` reports on the checks that EXIST. For the first minute or two after a push ours do
# not: the rollup holds whichever third-party app answered first, nothing is red, nothing is pending,
# and `--watch` returns immediately with exit 0. A pull request GitHub calls CONFLICTING is worse —
# it never queues `check` or `analyze` at all, so that exit 0 is permanent.
#
# So the repository's headline rule ("read the exit code") was being applied to a code that means
# "nothing I can see is failing" and was being read as "the tests passed". This asks for the checks
# BY NAME, waits for them to be created, and only then watches them.
#
#   .claude/pr-green.sh <pr>        # exit 0 only if every expected check ran and passed
#
# Exit 1 says what is missing. It is not a verdict on the change — a check that has not been created
# is not a check that failed — but it is the honest answer to "may I merge this".
set -uo pipefail

pr=${1:?usage: pr-green.sh <pr-number>}
# The jobs this repository's own workflows define on `pull_request`: tests.yml → `check`,
# codeql.yml → `analyze`. Third-party apps (CodeQL, GitGuardian) are deliberately not required:
# they are not ours, and they are the ones that were already answering when nothing else was.
expected=${EXPECTED_CHECKS:-"check analyze"}
# A queued job normally appears within a minute; five is the point at which something is wrong.
attempts=${ATTEMPTS:-30}

names_of() { gh pr view "$pr" --json statusCheckRollup --jq '.statusCheckRollup[]?.name'; }

# CONFLICTING is checked first because it is the case that never resolves. MERGEABLE is UNKNOWN for a
# few seconds after every push while GitHub works it out, so only the definite answer is fatal.
if [ "$(gh pr view "$pr" --json mergeable --jq .mergeable)" = "CONFLICTING" ]; then
  echo "pr-green: #$pr is CONFLICTING — GitHub queues no checks on a pull request it cannot merge," >&2
  echo "          so it will sit green on an empty set forever. Rebase, push, then ask again." >&2
  exit 1
fi

n=0
while :; do
  names=$(names_of)
  missing=""
  for want in $expected; do
    printf '%s\n' "$names" | grep -qx -- "$want" || missing="$missing $want"
  done
  [ -n "$missing" ] || break
  n=$((n + 1))
  if [ "$n" -ge "$attempts" ]; then
    echo "pr-green: still not created on #$pr:$missing" >&2
    echo "pr-green: what IS reported:" >&2
    printf '%s\n' "$names" | sed 's/^/  - /' >&2
    exit 1
  fi
  echo "pr-green: waiting for$missing to be created on #$pr ($n/$attempts)…" >&2
  sleep 10
done

# Every check we require exists. Now the exit code means what the workflow always claimed it meant.
gh pr checks "$pr" --watch --fail-fast
