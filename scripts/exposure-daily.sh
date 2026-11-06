#!/bin/sh
# The daily exposure run: eight variants, P at a time, then the trend report and the observatory
# site. Started by scripts/systemd/adtripwire-exposure.service (working directory: the checkout);
# also runnable by hand (`pnpm exposure:daily`) once the evaluation bundles are built.
#
# Environment:
#   ADTRIPWIRE_EXPOSURE_DIR       output directory (default ~/.cache/adtripwire-exposure)
#   ADTRIPWIRE_EXPOSURE_PARALLEL  variants at a time, 1-4 (default 2; one headless run is ~1.5 GB)
#   ADTRIPWIRE_EXPOSURE_SECONDS   dwell per site (default 60)
#
# A failing variant never stops the others (so no `set -e`); its status is only in the log line
# "done <name> exit=<n>". The script's own exit status is that of the trend step. A failing
# observatory build or publish never changes it.
set -u

c=${ADTRIPWIRE_EXPOSURE_DIR:-$HOME/.cache/adtripwire-exposure}
d=$(date +%F)
P=${ADTRIPWIRE_EXPOSURE_PARALLEL:-2}
S=${ADTRIPWIRE_EXPOSURE_SECONDS:-60}
case $P in '' | *[!0-9]*) P=2 ;; esac
[ "$P" -lt 1 ] && P=1
[ "$P" -gt 4 ] && P=4
mkdir -p "$c/reports" "$c/live"

# run <name> <exposure-run flags...>: one variant; the name is used for the JSON, report and log.
run() {
  name=$1
  shift
  node scripts/exposure-run.mjs "$@" --seconds="$S" --json="$c/$d-$name.json" \
    --out="$c/reports/$d-$name.md" >"$c/live/$d-$name.log" 2>&1
  echo "done $name exit=$?"
}

# Variants are started in groups of P: `launch` backgrounds one and, when the group is full,
# waits for all of it (POSIX sh has no `wait -n`). Two variants that share a browser profile must
# never run at the same time. exposure-run.mjs derives the default profile from browser + device,
# so the first four variants keep those (history carries over) and the regional lists each get an
# explicit profile of their own. All eight profiles are therefore distinct; the order below also
# keeps profile-sharing variants (the same browser and device) in different groups for P <= 2.
# P is clamped to 4 because of memory.
n=0
launch() {
  run "$@" &
  n=$((n + 1))
  if [ "$n" -ge "$P" ]; then
    wait
    n=0
  fi
}

PROF=$HOME/snap/chromium/common/adtripwire-exposure-profile
NO=tests/fixtures/norway.txt
MENA=tests/fixtures/mena-africa.txt

start=$(date +%s)
echo "exposure-daily $d parallel=$P seconds=$S dir=$c"

launch firefox --browser=firefox
launch chromium --browser=chromium
launch chromium-iphone-15 --browser=chromium --device="iPhone 15"
launch chromium-pixel-5 --browser=chromium --device="Pixel 5"
launch chromium-norway --browser=chromium --sites="$NO" --profile="$PROF-chromium-norway"
launch chromium-pixel-5-norway --browser=chromium --device="Pixel 5" --sites="$NO" \
  --profile="$PROF-chromium-pixel-5-norway"
launch chromium-mena-africa --browser=chromium --sites="$MENA" --profile="$PROF-chromium-mena-africa"
launch chromium-pixel-5-mena-africa --browser=chromium --device="Pixel 5" --sites="$MENA" \
  --profile="$PROF-chromium-pixel-5-mena-africa"
wait

node scripts/exposure-trend.mjs --dir="$c"
t=$?
{ node scripts/observatory-build.mjs --dir="$c" --out="$c/site" && sh scripts/observatory-publish.sh "$c/site"; } || true

echo "exposure-daily finished in $(($(date +%s) - start)) s, trend exit=$t"
exit $t
