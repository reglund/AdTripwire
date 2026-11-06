#!/bin/sh
# Brings a local copy of the observatory branch up to date, for the primary rig's aggregation.
#
#   sh scripts/observatory-sync.sh <dir>
#
# Same environment as observatory-publish.sh (ADTRIPWIRE_OBSERVATORY_REMOTE, and
# ADTRIPWIRE_OBSERVATORY_BRANCH, default observatory). When <dir>/.git exists the branch is
# fetched and the work tree reset to it; otherwise the branch is cloned into <dir>. When the
# branch does not exist yet, or publishing is not configured, <dir>/rigs is created empty and the
# script exits 0. <dir> must not be inside the AdTripwire checkout. The remote is never printed.
# Exits 1 when the remote cannot be reached or the fetch fails, 2 on configuration errors.
#
# The branch is fetched from the configured remote itself (not from "origin"), and every git call
# that writes files passes -c core.symlinks=false, so a symbolic link on the branch becomes a plain
# file holding the link text and never a link on disk (defence in depth: the site build also
# refuses links). An existing <dir> with .git is reused only when it looks like an observatory
# clone, that is, it has a rigs directory or a .nojekyll file, or nothing but .git in it; any
# other repository there is refused with exit 2 and left untouched.
set -eu

unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE

if [ $# -ne 1 ] || [ -z "$1" ]; then
  echo "usage: observatory-sync.sh <dir>" >&2
  exit 2
fi

# Refuse a directory inside the checkout (git would then run in or next to our own repository).
checkout=$(cd "$(dirname "$0")/.." && pwd -P)
case $1 in
  /*) abs=$1 ;;
  *) abs=$PWD/$1 ;;
esac
near=$abs
while [ ! -d "$near" ]; do
  near=$(dirname "$near")
done
near=$(cd "$near" && pwd -P)
case $near/ in
  "$checkout"/*)
    echo "observatory: the sync directory must be outside the AdTripwire checkout" >&2
    exit 2
    ;;
esac
dir=$abs

if [ -z "${ADTRIPWIRE_OBSERVATORY_REMOTE:-}" ]; then
  mkdir -p "$dir/rigs"
  echo "observatory: publishing is not configured (see docs/observatory.md)"
  exit 0
fi

remote=$ADTRIPWIRE_OBSERVATORY_REMOTE
case $remote in
  -*) remote_ok=no ;;
  /* | ?*://* | ?*@?*:*) remote_ok=yes ;;
  *) remote_ok=no ;;
esac
if [ "$remote_ok" != yes ]; then
  echo "observatory: the configured remote must be a URL (scheme://... or user@host:path) or an absolute path" >&2
  exit 2
fi
branch=${ADTRIPWIRE_OBSERVATORY_BRANCH:-observatory}

# An existing repository is reset hard below: make sure it is an observatory clone first.
if [ -e "$dir/.git" ] && [ ! -d "$dir/rigs" ] && [ ! -e "$dir/.nojekyll" ]; then
  others=$(ls -A "$dir" | grep -vx .git || true)
  if [ -n "$others" ]; then
    echo "observatory: $dir holds a repository that is not an observatory clone; refusing to use it" >&2
    exit 2
  fi
fi

# Exit status 2 from ls-remote means "reachable, but no such branch"; anything else is an error.
if git ls-remote --exit-code --heads "$remote" "$branch" >/dev/null 2>&1; then
  :
else
  rc=$?
  if [ "$rc" -eq 2 ]; then
    mkdir -p "$dir/rigs"
    echo "observatory: branch $branch does not exist yet; nothing to sync"
    exit 0
  fi
  echo "observatory: cannot reach the configured remote" >&2
  exit 1
fi

if [ -e "$dir/.git" ]; then
  if ! git -C "$dir" -c core.symlinks=false fetch -q --depth 1 "$remote" "$branch" >/dev/null 2>&1 ||
    ! git -C "$dir" -c core.symlinks=false reset -q --hard FETCH_HEAD; then
    echo "observatory: could not update the local copy of branch $branch" >&2
    exit 1
  fi
else
  mkdir -p "$dir"
  if ! git clone -q -c core.symlinks=false --no-local --depth 1 --branch "$branch" "$remote" "$dir" >/dev/null 2>&1; then
    echo "observatory: could not clone branch $branch" >&2
    exit 1
  fi
fi
if [ -e "$dir/rigs" ] && [ ! -d "$dir/rigs" ]; then
  echo "observatory: rigs on branch $branch is not a directory (a rig published something else there); refusing" >&2
  exit 1
fi
mkdir -p "$dir/rigs"
echo "observatory: synced branch $branch"
