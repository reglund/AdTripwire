#!/bin/sh
# Host-side checks for the exposure container, run by systemd from the compose directory
# (docker/). Reads the markers scripts/exposure-daily.sh keeps in data/exposure/state/.
#
#   rig-check.sh resume     at boot: when a run was started and never reached its end (a reboot
#                           or power loss killed it), start the run service again. Finished
#                           variants are skipped, so only the rest is measured.
#   rig-check.sh watchdog   in the evening: when today's run has not finished, send a notice
#                           through ADTRIPWIRE_NOTIFY_CMD from observatory.env (inside the image,
#                           so the host needs nothing but docker). Silence otherwise.
#
# SYSTEMCTL is "systemctl" or "systemctl --user" (set by install.sh).
set -u
SYSTEMCTL=${SYSTEMCTL:-systemctl}
state=data/exposure/state
svc=adtripwire-exposure-docker.service
today=$(date +%F)

case ${1:-} in
  resume)
    if [ ! -f "$state/running" ]; then
      echo "rig-check: no unfinished run"
      exit 0
    fi
    echo "rig-check: run of $(cat "$state/running") did not finish; starting $svc again"
    exec $SYSTEMCTL start --no-block "$svc"
    ;;
  watchdog)
    [ "$(cat "$state/finished" 2>/dev/null)" = "$today" ] && exit 0
    if $SYSTEMCTL is-active --quiet "$svc"; then
      msg="AdTripwire: the run of $today is still going at $(date +%H:%M). Check: journalctl -u $svc"
    elif [ -f "$state/running" ]; then
      msg="AdTripwire: the run of $(cat "$state/running") stopped before its end and is not running. Start it again (finished variants are skipped): $SYSTEMCTL start $svc"
    else
      msg="AdTripwire: no run finished today ($today). Check the timer: $SYSTEMCTL list-timers adtripwire-exposure-docker.timer"
    fi
    echo "rig-check: $msg"
    printf '%s\n' "$msg" |
      docker compose run --rm -T --entrypoint sh exposure \
        -c '[ -n "${ADTRIPWIRE_NOTIFY_CMD:-}" ] && exec sh -c "$ADTRIPWIRE_NOTIFY_CMD"; echo "rig-check: ADTRIPWIRE_NOTIFY_CMD is not set" >&2'
    ;;
  *)
    echo "usage: rig-check.sh resume|watchdog" >&2
    exit 2
    ;;
esac
