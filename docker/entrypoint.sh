#!/bin/sh
# Container entry point: prepare /data, rebuild the evaluation bundles from the image's tree
# (the same two steps as scripts/systemd/adtripwire-exposure.service), then run the daily
# script with whatever arguments were given. `smoke` runs two sites per browser instead
# (output in /data/smoke, outside the exposure directory so it never reaches the trend or the export).
set -u
cd /app || exit 1

mkdir -p /data/snap/firefox/common /data/snap/chromium/common /data/exposure /data/smoke

node scripts/refresh-indicators.mjs --check || true

node apps/extension-firefox/build.mjs --eval --out=/data/snap/firefox/common/adtripwire-eval-dist &&
  node apps/extension-chromium/build.mjs --eval --out=/data/snap/chromium/common/adtripwire-eval-dist ||
  {
    echo "entrypoint: building the evaluation bundles failed" >&2
    exit 1
  }

if [ "${1:-}" = smoke ]; then
  rc=0
  for b in chromium firefox; do
    node scripts/exposure-run.mjs --browser="$b" --limit=2 --seconds=10 \
      --profile="/data/snap/$b/common/adtripwire-smoke" \
      --json="/data/smoke/smoke-$b.json" --out="/data/smoke/smoke-$b.md" || rc=1
  done
  exit $rc
fi

exec sh scripts/exposure-daily.sh "$@"
