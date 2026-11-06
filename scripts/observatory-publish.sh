#!/bin/sh
# Publishes a built observatory site directory to a branch of a git remote.
#
#   sh scripts/observatory-publish.sh <site-dir>
#
# Configuration comes from the environment (the systemd unit reads
# ~/.config/adtripwire/observatory.env):
#   ADTRIPWIRE_OBSERVATORY_REMOTE   remote URL or absolute path; unset = publishing is off
#   ADTRIPWIRE_OBSERVATORY_BRANCH   branch that holds the site (default: observatory)
#
# The site is copied to the root of the branch, replacing its content. A commit is made only
# when something changed, always as "AdTripwire observatory <observatory@adtripwire.invalid>" with
# a UTC timestamp. An existing branch is overwritten only when its root is empty or already holds
# an index.html, so the main branch of a code repository is never replaced. The remote must be a
# URL (scheme://, user@host:path) or an absolute path; it is never printed, because it may embed
# a token. All git work happens in a scratch directory: this script never runs git inside the
# AdTripwire checkout. Exits 1 when the remote cannot be reached or the push fails, 2 on
# configuration errors.
set -eu

# Do not let an inherited repository (for example from a git hook) redirect our git calls.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE

if [ -z "${ADTRIPWIRE_OBSERVATORY_REMOTE:-}" ]; then
  echo "observatory: publishing is not configured (see docs/observatory.md)"
  exit 0
fi
if [ $# -ne 1 ] || [ ! -f "$1/index.html" ]; then
  echo "usage: observatory-publish.sh <site-dir containing index.html>" >&2
  exit 2
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
site=$(cd "$1" && pwd)
if [ -e "$site/.git" ]; then
  echo "observatory: $site contains .git; refusing to publish it" >&2
  exit 2
fi

tmp=$(mktemp -d "${TMPDIR:-/tmp}/adtripwire-observatory.XXXXXX")
trap 'rm -rf "$tmp"' EXIT
trap 'rm -rf "$tmp"; exit 1' INT TERM
cd "$tmp"
work=$tmp/repo

# Exit status 2 from ls-remote means "reachable, but no such branch"; anything else is an error.
if git ls-remote --exit-code --heads "$remote" "$branch" >/dev/null; then
  git clone -q --no-local --depth 1 --branch "$branch" "$remote" "$work"
  # Refuse to replace a branch that is not an observatory site (or empty).
  top=$(git -C "$work" ls-tree --name-only HEAD)
  if [ -n "$top" ] && ! printf '%s\n' "$top" | grep -qx 'index.html'; then
    echo "observatory: branch $branch exists and its root has no index.html; refusing to overwrite it" >&2
    exit 2
  fi
else
  rc=$?
  if [ "$rc" -ne 2 ]; then
    echo "observatory: cannot reach the configured remote" >&2
    exit 1
  fi
  git init -q "$work"
  git -C "$work" checkout -q --orphan "$branch"
  git -C "$work" remote add origin "$remote"
fi

if command -v rsync >/dev/null 2>&1; then
  rsync -a --checksum --delete --exclude .git "$site"/ "$work"/
else
  find "$work" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
  cp -R "$site"/. "$work"/
fi
: >"$work/.nojekyll"

git -C "$work" add -A
if [ -z "$(git -C "$work" status --porcelain)" ]; then
  echo "observatory: no changes to publish"
  exit 0
fi
stamp=$(TZ=UTC date +%Y-%m-%dT%H:%M:%S+0000)
GIT_AUTHOR_DATE=$stamp GIT_COMMITTER_DATE=$stamp \
  git -C "$work" -c user.name="AdTripwire observatory" -c user.email="observatory@adtripwire.invalid" \
  -c commit.gpgsign=false commit -q -m "observatory $(TZ=UTC date +%F)"
git -C "$work" push -q origin "HEAD:refs/heads/$branch"
echo "observatory: published to $branch"
