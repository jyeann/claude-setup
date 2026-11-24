#!/bin/sh
# Stand-in test runner for the report contract tests (ADR-0003). It is deliberately not JavaScript: a POSIX
# shell script that behaves like pytest, taking `--junitxml=<file>`, writing JUnit there and printing pytest's
# summary line. It "runs" the cases listed in a plain-text file, one per line:
#   pass <name>
#   fail <name> | <message>
#   skip <name>
# Directives (lines starting with @) let tests forge what a dishonest or broken runner would do:
#   @exit <code>      exit with this code whatever the results
#   @no-report        write no JUnit file
#   @old-report       backdate the JUnit file to 2001 (a stale or copied-in report)
#   @lie-summary      print one more passing test than the report holds
#   @no-summary       print no summary line
#   @garbage-report   write a truncated XML file
#   @report-from <f>  copy file <f> as the report, keeping its modification time (cp -p)
#   @flaky            every second run turns the first `pass` into a failure (state in <cases>.runs)
set -u
cases=""
junit=""
for arg in "$@"; do
  case "$arg" in
    --junitxml=*) junit="${arg#--junitxml=}" ;;
    *) cases="$arg" ;;
  esac
done
[ -n "$cases" ] && [ -f "$cases" ] || { echo "standin: no cases file" >&2; exit 4; }

has() { grep -qx "@$1" "$cases"; }

flip=0
if has flaky; then
  runs=$(cat "$cases.runs" 2>/dev/null || echo 0)
  runs=$((runs + 1))
  echo "$runs" > "$cases.runs"
  [ $((runs % 2)) -eq 0 ] && flip=1
fi

out=$(awk -v flip="$flip" '
  function esc(s) { gsub(/&/, "\\&amp;", s); gsub(/</, "\\&lt;", s); gsub(/>/, "\\&gt;", s); gsub(/"/, "\\&quot;", s); return s }
  /^@/ || /^[ \t]*$/ { next }
  {
    kind = $1; rest = substr($0, length($1) + 2); msg = ""
    if (kind == "pass" && flip == 1) { kind = "fail"; msg = "flipped by @flaky"; flip = 0 }
    if (kind == "fail" && index(rest, " | ") > 0) { msg = substr(rest, index(rest, " | ") + 3); rest = substr(rest, 1, index(rest, " | ") - 1) }
    n++
    body = body "    <testcase classname=\"standin\" name=\"" esc(rest) "\" time=\"0.001\">"
    if (kind == "fail") { failed++; body = body "<failure message=\"" esc(msg) "\">" esc(msg) "</failure>" }
    else if (kind == "skip") { skipped++; body = body "<skipped/>" }
    else passed++
    body = body "</testcase>\n"
    if (kind == "fail") printf "FAILED %s - %s\n", rest, msg > "/dev/stderr"
  }
  END {
    printf "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<testsuites name=\"standin\">\n  <testsuite name=\"standin\" tests=\"%d\" failures=\"%d\" errors=\"0\" skipped=\"%d\">\n%s  </testsuite>\n</testsuites>\n", n, failed, skipped, body
    printf "%d %d %d\n", passed, failed, skipped > "/dev/stderr"
  }
' "$cases" 2>"$cases.err")

counts=$(tail -n 1 "$cases.err")
grep '^FAILED ' "$cases.err" || true
rm -f "$cases.err"
set -- $counts
passed=$1 failed=$2 skipped=$3

from=$(sed -n 's/^@report-from \(.*\)$/\1/p' "$cases" | head -n 1)
if [ -n "$junit" ] && ! has no-report; then
  if [ -n "$from" ]; then
    cp -p "$from" "$junit"
  elif has garbage-report; then
    printf '%s' "$out" | head -n 3 > "$junit"
  else
    printf '%s\n' "$out" > "$junit"
  fi
  has old-report && touch -t 200101010000 "$junit"
fi

has lie-summary && passed=$((passed + 1))
parts=""
[ "$failed" -gt 0 ] && parts="$failed failed"
[ "$passed" -gt 0 ] && parts="${parts:+$parts, }$passed passed"
[ "$skipped" -gt 0 ] && parts="${parts:+$parts, }$skipped skipped"
[ -z "$parts" ] && parts="no tests ran"
has no-summary || echo "========================= $parts in 0.01s ========================="

code=0
[ "$failed" -gt 0 ] && code=1
forced=$(sed -n 's/^@exit \([0-9][0-9]*\)$/\1/p' "$cases" | head -n 1)
[ -n "$forced" ] && code=$forced
exit "$code"
