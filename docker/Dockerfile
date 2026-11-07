# The AdTripwire daily exposure rig (Chromium + Firefox, headless) as one container.
# Build from the repository root:  docker build -t adtripwire-rig -f docker/Dockerfile .
# Run through docker/compose.yml; see docs/rig-docker.md. Everything that must survive a run
# (browser profiles, results, the deploy key) lives on the /data volume, never in the image.
FROM node:20-bookworm

ENV DEBIAN_FRONTEND=noninteractive

# Chromium from Debian. Firefox from Mozilla's own apt repository: bookworm's firefox-esr 128 is
# too old for puppeteer-core 25's WebDriver BiDi. Fonts are kept modest (Latin, symbols, emoji).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      chromium \
      fonts-liberation fonts-noto-core fonts-noto-color-emoji \
      rsync git openssh-client curl ca-certificates gnupg tini \
 && install -d -m 0755 /etc/apt/keyrings \
 && curl -fsSL https://packages.mozilla.org/apt/repo-signing-key.gpg -o /etc/apt/keyrings/packages.mozilla.org.asc \
 && echo "deb [signed-by=/etc/apt/keyrings/packages.mozilla.org.asc] https://packages.mozilla.org/apt mozilla main" \
      > /etc/apt/sources.list.d/mozilla.list \
 && printf 'Package: *\nPin: origin packages.mozilla.org\nPin-Priority: 1000\n' \
      > /etc/apt/preferences.d/mozilla \
 && apt-get update \
 && apt-get install -y --no-install-recommends firefox \
 && rm -rf /var/lib/apt/lists/* \
 && ssh-keyscan github.com > /etc/ssh/ssh_known_hosts 2>/dev/null \
 && test -s /etc/ssh/ssh_known_hosts

# The base image ships a "node" user with uid 1000; the rig user takes that uid so a bind-mounted
# ./data owned by the first user on the host is writable. HOME=/data puts the harness's default
# ~/snap/<browser>/common profile paths on the volume.
RUN userdel -r node \
 && useradd --uid 1000 --home-dir /data --no-create-home --shell /bin/sh rig \
 && mkdir -p /data /app \
 && chown rig:rig /data /app

# pnpm, pinned to package.json "packageManager"; the cache is kept outside HOME (which is the
# volume at run time).
ENV COREPACK_HOME=/opt/corepack
COPY package.json /tmp/package.json
RUN corepack enable \
 && corepack prepare "$(node -p "require('/tmp/package.json').packageManager")" --activate \
 && chmod -R a+rX /opt/corepack \
 && rm /tmp/package.json

ENV HOME=/data \
    CHROME_BIN=/usr/bin/chromium \
    FIREFOX_BIN=/usr/bin/firefox \
    TZ=Europe/Oslo \
    ADTRIPWIRE_EXPOSURE_DIR=/data/exposure \
    MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1

USER rig
WORKDIR /app
COPY --chown=rig:rig . /app
RUN pnpm install --frozen-lockfile --store-dir /tmp/pnpm-store \
 && rm -rf /tmp/pnpm-store

VOLUME /data
ENTRYPOINT ["tini", "--", "/app/docker/entrypoint.sh"]
