#!/usr/bin/env bash
# Run the full QA suite against a built site/ directory.
# Usage: tools/qa/run_all.sh [siteDir=site] [outDir=qa-out]
# Results: <outDir>/{ui,img,overflow,timing,audio,rhythm}/ ; exit code = number of failed checks.
set -u
cd "$(dirname "$0")/../.."
SITE="$(realpath "${1:-site}")"; OUT="$(realpath -m "${2:-qa-out}")"
mkdir -p "$OUT"
fails=0
run() { local name=$1; shift; echo "== $name"; if "$@" > "$OUT/$name.log" 2>&1; then echo "   PASS"; else echo "   FAIL (see $OUT/$name.log)"; fails=$((fails+1)); fi; tail -n 12 "$OUT/$name.log" | sed 's/^/   /'; }
run ui       node tools/qa/ui_check.cjs  "$SITE" "$OUT/ui"
run img      node tools/qa/imgcheck.cjs  "$SITE" "$OUT/img"
run overflow node tools/qa/overflow.cjs  "$SITE" "$OUT/overflow"
run timing   node tools/qa/timing.cjs    "$SITE" "$OUT/timing"
[ -f tools/audio_test.cjs ]  && run audio  node tools/audio_test.cjs  "$SITE" "$OUT/audio"
[ -f tools/rhythm_test.cjs ] && run rhythm node tools/rhythm_test.cjs "$SITE" "$OUT/rhythm"
echo "== $fails failed"
exit $fails
