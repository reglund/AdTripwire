#!/bin/sh
# Installs (or removes with --remove) the systemd timer that runs the exposure container.
# System units by default (needs sudo); --user installs user units instead (the user must be in
# the docker group; run `loginctl enable-linger <user>` so the timer fires without a login).
# Usage: sh docker/host/install.sh [--user] [--remove]
set -eu
here=$(cd "$(dirname "$0")" && pwd)
user=no
remove=no
for a in "$@"; do
  case $a in
    --user) user=yes ;;
    --remove) remove=yes ;;
    *) echo "usage: sh docker/host/install.sh [--user] [--remove]" >&2; exit 2 ;;
  esac
done
if [ "$user" = yes ]; then
  dir="$HOME/.config/systemd/user"
  sc="systemctl --user"
  sudo=""
else
  dir=/etc/systemd/system
  sc="sudo systemctl"
  sudo="sudo"
fi
if [ "$remove" = yes ]; then
  $sc disable --now adtripwire-exposure-docker.timer 2>/dev/null || true
  $sudo rm -f "$dir/adtripwire-exposure-docker.service" "$dir/adtripwire-exposure-docker.timer"
  $sc daemon-reload
  echo "removed"
  exit 0
fi
$sudo mkdir -p "$dir"
$sudo cp "$here/adtripwire-exposure-docker.service" "$here/adtripwire-exposure-docker.timer" "$dir/"
$sc daemon-reload
$sc enable --now adtripwire-exposure-docker.timer
$sc list-timers adtripwire-exposure-docker.timer --no-pager
