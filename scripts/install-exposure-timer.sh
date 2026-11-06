#!/bin/sh
# Installs (or removes with --remove) the user-level systemd timer for the daily exposure run.
set -eu
dir="$HOME/.config/systemd/user"
mkdir -p "$dir" "$HOME/.cache/adtripwire-exposure"
if [ "${1:-}" = "--remove" ]; then
  systemctl --user disable --now adtripwire-exposure.timer 2>/dev/null || true
  rm -f "$dir/adtripwire-exposure.service" "$dir/adtripwire-exposure.timer"
  systemctl --user daemon-reload
  echo "removed"
  exit 0
fi
cp "$(dirname "$0")/systemd/adtripwire-exposure.service" "$(dirname "$0")/systemd/adtripwire-exposure.timer" "$dir/"
systemctl --user daemon-reload
systemctl --user enable --now adtripwire-exposure.timer
systemctl --user list-timers adtripwire-exposure.timer --no-pager
echo "To publish the observatory site after each run, set ADTRIPWIRE_OBSERVATORY_REMOTE in"
echo "$HOME/.config/adtripwire/observatory.env (see docs/observatory.md); without it nothing is published."
