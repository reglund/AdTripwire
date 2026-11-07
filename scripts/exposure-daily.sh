#!/bin/sh
# The daily exposure run: nine variants, P at a time, then the trend report and the observatory
# site. Started by scripts/systemd/adtripwire-exposure.service (working directory: the checkout);
# also runnable by hand (`pnpm exposure:daily`) once the evaluation bundles are built.
#
# Environment:
#   ADTRIPWIRE_EXPOSURE_DIR       output directory (default ~/.cache/adtripwire-exposure)
#   ADTRIPWIRE_EXPOSURE_PARALLEL  variants at a time, 1-4 (default 2; one headless run is ~1.5 GB)
#   ADTRIPWIRE_EXPOSURE_SECONDS   dwell per site (default 60)
#   ADTRIPWIRE_RIG                rig name, ^[a-z0-9][a-z0-9-]{0,31}$ (default rig-1; an invalid
#                                 name stops the script with exit 2 before anything runs); written
#                                 into every run and used as rigs/<name>/ on the observatory
#                                 branch. Must be set when ADTRIPWIRE_OBSERVATORY_REMOTE is set,
#                                 else the observatory steps are skipped (the measurement still runs)
#   ADTRIPWIRE_RIG_COUNTRY        optional, ISO 3166-1 alpha-2 upper case (self-declared)
#   ADTRIPWIRE_RIG_NETWORK        optional: home, mobile, office or datacentre (self-declared)
#   ADTRIPWIRE_OBSERVATORY_ROLE   rig (default) or primary. A rig only exports and publishes its
#                                 own rigs/<name>/; the primary, which must be set explicitly, also
#                                 pulls every rig's rows, builds the site over them and publishes
#                                 the root. Anything but "primary" is treated as rig, so a typo or
#                                 an omission never writes the site root.
#   ADTRIPWIRE_NOTIFY_CMD         primary only: a shell command that receives the day's notification
#                                 text on stdin (see docs/observatory.md, Notifications)
#   ADTRIPWIRE_NOTIFY_ALWAYS      1: send the notification even when nothing changed
#
# A failing variant never stops the others (so no `set -e`); its status is only in the log line
# "done <name> exit=<n>". The script's own exit status is that of the trend step. A failing
# observatory export, sync, build, publish or notification never changes it.
set -u

c=${ADTRIPWIRE_EXPOSURE_DIR:-$HOME/.cache/adtripwire-exposure}
d=$(date +%F)
P=${ADTRIPWIRE_EXPOSURE_PARALLEL:-2}
S=${ADTRIPWIRE_EXPOSURE_SECONDS:-60}
RIG=${ADTRIPWIRE_RIG:-rig-1}
case $RIG in
  '' | -* | *[!abcdefghijklmnopqrstuvwxyz0123456789-]*) rig_ok=no ;;
  *) rig_ok=yes ;;
esac
[ "${#RIG}" -le 32 ] || rig_ok=no
if [ "$rig_ok" != yes ]; then
  echo "exposure-daily: ADTRIPWIRE_RIG must match [a-z0-9][a-z0-9-]{0,31}; nothing was run" >&2
  exit 2
fi
RIG_COUNTRY=${ADTRIPWIRE_RIG_COUNTRY:-}
RIG_NETWORK=${ADTRIPWIRE_RIG_NETWORK:-}
ROLE=${ADTRIPWIRE_OBSERVATORY_ROLE:-rig}
case $P in '' | *[!0-9]*) P=2 ;; esac
[ "$P" -lt 1 ] && P=1
[ "$P" -gt 4 ] && P=4
mkdir -p "$c/reports" "$c/live"

# run <name> <exposure-run flags...>: one variant; the name is used for the JSON, report and log.
run() {
  name=$1
  shift
  set -- "$@" "--rig=$RIG"
  [ -n "$RIG_COUNTRY" ] && set -- "$@" "--rig-country=$RIG_COUNTRY"
  [ -n "$RIG_NETWORK" ] && set -- "$@" "--rig-network=$RIG_NETWORK"
  node scripts/exposure-run.mjs "$@" --seconds="$S" --json="$c/$d-$name.json" \
    --out="$c/reports/$d-$name.md" >"$c/live/$d-$name.log" 2>&1
  echo "done $name exit=$?"
}

# Variants are started in groups of P: `launch` backgrounds one and, when the group is full,
# waits for all of it (POSIX sh has no `wait -n`). Two variants that share a browser profile must
# never run at the same time. exposure-run.mjs derives the default profile from browser + device,
# so the first four variants keep those (history carries over) and the regional lists each get an
# explicit profile of their own. All nine profiles are therefore distinct; the order below also
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
SECTOR=tests/fixtures/norway-sector.txt
FPROF=$HOME/snap/firefox/common/adtripwire-exposure-profile

start=$(date +%s)
echo "exposure-daily $d parallel=$P seconds=$S dir=$c rig=$RIG role=$ROLE"

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
# Firefox, not Chromium: desktop headless Chromium is filtered by most exchanges, and only
# Firefox reports the frame ancestry that "Seen alongside" needs.
launch firefox-norway-sector --browser=firefox --sites="$SECTOR" --profile="$FPROF-norway-sector"
wait

node scripts/exposure-trend.mjs --dir="$c"
t=$?

# Observatory, every step best-effort. Both roles export this rig's runs and publish them under
# rigs/$RIG/. The primary (ADTRIPWIRE_OBSERVATORY_ROLE=primary, never the default) then pulls the
# branch, builds the site over every rig's rows and publishes the root (index.html, data/); a
# failing sync or build skips the root publish. When a remote is configured but no rig name was
# chosen, nothing is exported or published: the default name would claim rigs/rig-1/.
if [ -n "${ADTRIPWIRE_OBSERVATORY_REMOTE:-}" ] && [ -z "${ADTRIPWIRE_RIG:-}" ]; then
  echo "ADTRIPWIRE_RIG must be set when publishing is configured; skipping the observatory steps"
else
  set -- --dir="$c" --out="$c/rig-export" --rig="$RIG"
  [ -n "$RIG_COUNTRY" ] && set -- "$@" --country="$RIG_COUNTRY"
  [ -n "$RIG_NETWORK" ] && set -- "$@" --network="$RIG_NETWORK"
  { node scripts/observatory-export-rig.mjs "$@" &&
    sh scripts/observatory-publish.sh --rig "$RIG" "$c/rig-export"; } || true
  if [ "$ROLE" = primary ]; then
    { sh scripts/observatory-sync.sh "$c/remote" &&
      node scripts/observatory-build.mjs --rigs="$c/remote/rigs" --out="$c/site" &&
      sh scripts/observatory-publish.sh "$c/site"; } || true
    # The day's notification text, whether or not the publish worked: it reads the built site.
    set -- --index="$c/site/data/index.json" --state="$c/notify-state.json"
    [ "${ADTRIPWIRE_NOTIFY_ALWAYS:-}" = 1 ] && set -- "$@" --always
    node scripts/observatory-notify.mjs "$@" || true
  fi
fi

echo "exposure-daily finished in $(($(date +%s) - start)) s, trend exit=$t"
exit $t
