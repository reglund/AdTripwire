#!/bin/sh
# Installs (or removes with --remove) the systemd units for the exposure container: the daily
# run (service + timer), resuming a run that a reboot interrupted (at boot), and an evening
# watchdog that notifies when the day's run has not finished (service + timer, 21:00).
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
units="adtripwire-exposure-docker.service adtripwire-exposure-docker.timer
adtripwire-exposure-resume.service adtripwire-exposure-watchdog.service
adtripwire-exposure-watchdog.timer"
if [ "$remove" = yes ]; then
  $sc disable --now adtripwire-exposure-docker.timer adtripwire-exposure-watchdog.timer \
    adtripwire-exposure-resume.service 2>/dev/null || true
  for u in $units; do $sudo rm -f "$dir/$u"; done
  $sc daemon-reload
  echo "removed"
  exit 0
fi
$sudo mkdir -p "$dir"
# The unit runs compose from this checkout's docker/ directory, wherever it was cloned.
compose_dir=$(cd "$here/.." && pwd)
# User units: systemctl --user inside the check script, and default.target instead of
# multi-user.target (which user managers do not have).
if [ "$user" = yes ]; then
  ctl="systemctl --user"
  target=default.target
else
  ctl=systemctl
  target=multi-user.target
fi
for u in $units; do
  sed -e "s#^WorkingDirectory=.*#WorkingDirectory=$compose_dir#" \
    -e "s#^Environment=SYSTEMCTL=.*#Environment=\"SYSTEMCTL=$ctl\"#" \
    -e "s#^WantedBy=multi-user.target#WantedBy=$target#" "$here/$u" |
    $sudo tee "$dir/$u" >/dev/null
done
echo "units run in $compose_dir"
$sc daemon-reload
$sc enable --now adtripwire-exposure-docker.timer adtripwire-exposure-watchdog.timer
# Enabled for the next boot only: started now it would find no unfinished run anyway, or
# restart one that is still in progress under the run service (a no-op, but noisy).
$sc enable adtripwire-exposure-resume.service
$sc list-timers adtripwire-exposure-docker.timer adtripwire-exposure-watchdog.timer --no-pager
