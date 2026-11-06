#!/bin/sh
# Publishes a built observatory site directory, or one rig's export, to a branch of a git remote.
#
#   sh scripts/observatory-publish.sh <site-dir>             root mode
#   sh scripts/observatory-publish.sh --rig <name> <export-dir>   rig mode
#
# Configuration comes from the environment (the systemd unit reads
# ~/.config/adtripwire/observatory.env):
#   ADTRIPWIRE_OBSERVATORY_REMOTE   remote URL or absolute path; unset = publishing is off
#   ADTRIPWIRE_OBSERVATORY_BRANCH   branch that holds the site (default: observatory)
#
# Root mode copies the site to the root of the branch, replacing everything except rigs/ and .git.
# Rig mode (the directory must hold rig.json; the name must match [a-z0-9][a-z0-9-]{0,31})
# replaces only rigs/<name>/ and touches nothing else. A commit is made only when something
# changed, always as "AdTripwire observatory <observatory@adtripwire.invalid>" with a UTC
# timestamp. An existing branch is changed only when its root holds nothing but index.html,
# README.md, .nojekyll, data and rigs, so the main branch of a code repository is never replaced;
# an empty or missing branch is fine. A rejected push (for example when another rig pushed
# first) is retried by cloning again and re-applying, up to three attempts in all. The remote
# must be a URL (scheme://, user@host:path) or an absolute path; it is never printed, because it
# may embed a token. All git work happens in a scratch directory: this script never runs git
# inside the AdTripwire checkout. Exits 1 when the remote cannot be reached or the push fails,
# 2 on configuration errors.
set -eu

# Do not let an inherited repository (for example from a git hook) redirect our git calls.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE

if [ -z "${ADTRIPWIRE_OBSERVATORY_REMOTE:-}" ]; then
  echo "observatory: publishing is not configured (see docs/observatory.md)"
  exit 0
fi

usage() {
  echo "usage: observatory-publish.sh <site-dir containing index.html>" >&2
  echo "       observatory-publish.sh --rig <name> <export-dir containing rig.json>" >&2
  exit 2
}

mode=root
rig=
if [ $# -ge 1 ] && [ "$1" = "--rig" ]; then
  [ $# -eq 3 ] || usage
  mode=rig
  rig=$2
  src=$3
  # Plain `case` patterns on the whole value (a line-based grep would accept "a<newline>.." because
  # it only needs one matching line). Explicit alphabets: no locale-dependent ranges.
  case $rig in
    '' | -* | *[!abcdefghijklmnopqrstuvwxyz0123456789-]*) rig_ok=no ;;
    *) rig_ok=yes ;;
  esac
  [ "${#rig}" -le 32 ] || rig_ok=no
  if [ "$rig_ok" != yes ]; then
    echo "observatory: the rig name must match [a-z0-9][a-z0-9-]{0,31}" >&2
    exit 2
  fi
  [ -f "$src/rig.json" ] || usage
else
  [ $# -eq 1 ] && [ -f "$1/index.html" ] || usage
  src=$1
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
site=$(cd "$src" && pwd)
if [ -e "$site/.git" ]; then
  echo "observatory: $site contains .git; refusing to publish it" >&2
  exit 2
fi

tmp=$(mktemp -d "${TMPDIR:-/tmp}/adtripwire-observatory.XXXXXX")
trap 'rm -rf "$tmp"' EXIT
trap 'rm -rf "$tmp"; exit 1' INT TERM
cd "$tmp"
work=$tmp/repo

if [ "$mode" = rig ]; then
  message="observatory rig $rig $(TZ=UTC date +%F)"
else
  message="observatory $(TZ=UTC date +%F)"
fi

attempt=1
while :; do
  rm -rf "$work"

  # Exit status 2 from ls-remote means "reachable, but no such branch"; anything else is an error.
  if git ls-remote --exit-code --heads "$remote" "$branch" >/dev/null 2>&1; then
    git clone -q --no-local --depth 1 --branch "$branch" "$remote" "$work"
    # Refuse to change a branch that is not an observatory site (or empty).
    other=$(git -C "$work" ls-tree --name-only HEAD | grep -vx -e index.html -e README.md -e .nojekyll -e data -e rigs || true)
    if [ -n "$other" ]; then
      echo "observatory: branch $branch has other content at its root ($(printf '%s' "$other" | tr '\n' ' ')); refusing to overwrite it" >&2
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

  if [ "$mode" = rig ]; then
    dest=$work/rigs/$rig
    if [ -L "$work/rigs" ] || [ -L "$dest" ]; then
      echo "observatory: rigs/ or rigs/$rig on the branch is a symbolic link; refusing to publish" >&2
      exit 2
    fi
    mkdir -p "$dest"
    if command -v rsync >/dev/null 2>&1; then
      rsync -a --checksum --delete --exclude .git "$site"/ "$dest"/
    else
      rm -rf "$dest"
      mkdir -p "$dest"
      cp -R "$site"/. "$dest"/
    fi
  else
    if command -v rsync >/dev/null 2>&1; then
      rsync -a --checksum --delete --exclude .git --exclude /rigs/ "$site"/ "$work"/
    else
      find "$work" -mindepth 1 -maxdepth 1 ! -name .git ! -name rigs -exec rm -rf {} +
      for entry in "$site"/* "$site"/.[!.]*; do
        [ -e "$entry" ] || continue
        [ "$(basename "$entry")" = rigs ] && continue
        cp -R "$entry" "$work"/
      done
    fi
    : >"$work/.nojekyll"
  fi

  git -C "$work" add -A
  if [ -z "$(git -C "$work" status --porcelain)" ]; then
    echo "observatory: no changes to publish"
    exit 0
  fi
  stamp=$(TZ=UTC date +%Y-%m-%dT%H:%M:%S+0000)
  GIT_AUTHOR_DATE=$stamp GIT_COMMITTER_DATE=$stamp \
    git -C "$work" -c user.name="AdTripwire observatory" -c user.email="observatory@adtripwire.invalid" \
    -c commit.gpgsign=false commit -q -m "$message"
  # Push output is not shown: git echoes the remote URL, which may embed a token.
  if git -C "$work" push -q origin "HEAD:refs/heads/$branch" >/dev/null 2>&1; then
    if [ "$mode" = rig ]; then
      echo "observatory: published rig $rig to $branch"
    else
      echo "observatory: published to $branch"
    fi
    exit 0
  fi
  if [ "$attempt" -ge 3 ]; then
    echo "observatory: the push was rejected three times; giving up" >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  echo "observatory: push rejected; fetching the branch again and retrying (attempt $attempt of 3)"
done
