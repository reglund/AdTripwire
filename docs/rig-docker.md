# Running the exposure rig in Docker

The same daily run as `docs/rig-setup.md` (nine variants, Firefox and Chromium, headless), packaged
as one container so it can run on a home server instead of a laptop. This page is for the person
(or the Claude Code session) on the server; the example server is called `motor`
(10.0.0.103, Linux x86_64, Docker with the compose plugin). Nothing about what is measured or
published changes: see `docs/observatory.md`.

Inside the container: Debian bookworm, Chromium from Debian, Firefox from Mozilla's apt repository
(bookworm's Firefox ESR is too old for WebDriver BiDi), Node 20, the repository tree as it was when
the image was built. The browsers run as user `rig` (uid 1000) with `HOME=/data`, so the harness's
default `~/snap/<browser>/common/...` profile paths and the results directory live on the volume
`docker/data` on the host. The evaluation bundles are rebuilt on every start (as the systemd unit
does), so the indicator set is always the one in the image.

## What the container needs

| Resource  | Need                                                                                                       |
| --------- | ---------------------------------------------------------------------------------------------------------- |
| RAM       | about 4 GB peak with two browsers at once (`mem_limit: 6g`; `shm_size: 1g`)                                |
| Time      | about 5 hours a day (`TimeoutStartSec=8h`); the timer starts it at 11:30 plus up to 30 minutes             |
| Disk      | `docker/data`: browser profiles and the day-by-day JSON; a few hundred MB to start, growing slowly         |
| Network   | outbound 443 to the sites on the list; `github.com:22` (ssh) for publishing; `ntfy.sh:443` for the message |
| Inbound   | nothing                                                                                                    |
| Privilege | no `--privileged`, no extra capabilities. Chromium runs with `--no-sandbox` (see below)                    |

`--no-sandbox --disable-dev-shm-usage` reach Chromium through `ADTRIPWIRE_CHROME_ARGS` in
`docker/compose.yml`. They are for the container only: the sandbox is off because the container
runs as a non-root user without user namespaces. The browsers only visit public news and media
sites from a throwaway profile, but do not reuse this image or these flags for anything else.

## Steps

1. **Clone** on the server: `sudo mkdir -p /opt/adtripwire && sudo chown "$USER" /opt/adtripwire`,
   then `git clone https://github.com/reglund/AdTripwire.git /opt/adtripwire`.
   Create the volume directories: `mkdir -p /opt/adtripwire/docker/data/exposure`.

2. **Copy the secrets and the history from the laptop.** Run these ON THE LAPTOP (the maintainer's
   machine), with `motor` resolving to the server (or use `art@10.0.0.103`; use the account that
   owns `/opt/adtripwire` there):

   ```sh
   # env file (contains the remote, rig name, notification command)
   scp ~/.config/adtripwire/observatory.env motor:/opt/adtripwire/docker/observatory.env
   # deploy key
   scp ~/.config/adtripwire/adtripwire-observatory motor:/opt/adtripwire/docker/data/adtripwire-observatory
   # history: JSON, evidence, reports, trend, notify-state, site, remote, rig-export
   rsync -a --info=progress2 ~/.cache/adtripwire-exposure/ motor:/opt/adtripwire/docker/data/exposure/
   ```

   Do NOT copy the browser profiles (`~/snap/*/common/adtripwire-exposure-profile*`). Chromium
   profiles written by snap Chromium 156 may not open in Debian's Chromium, so the profiles start
   fresh and the consent dialogs are accepted again on day one. Day one therefore looks a little
   different from the days before it.

   Then ON THE SERVER:

   ```sh
   cd /opt/adtripwire/docker
   # inside the container the key is at /data/..., not under ~/.ssh or ~/.config:
   sed -i 's|^GIT_SSH_COMMAND=.*|GIT_SSH_COMMAND=ssh -i /data/adtripwire-observatory -o IdentitiesOnly=yes|' observatory.env
   chmod 600 observatory.env data/adtripwire-observatory
   sudo chown -R 1000:1000 data     # the container user is uid 1000
   grep -v -e NOTIFY_CMD observatory.env   # check: role=primary, rig, remote, branch, key path
   ```

   The env file keeps `ADTRIPWIRE_OBSERVATORY_ROLE=primary` if the laptop was the primary; see step 6
   before the first scheduled run.

3. **Build the image**: `cd /opt/adtripwire/docker && docker compose build`.

4. **Smoke test**: `docker compose run --rm exposure smoke`. It builds the two evaluation
   bundles and visits two sites per browser for 10 seconds each (output in `docker/data/smoke/`,
   outside the results directory, so it is never exported or published). Look for, for each
   browser, `loaded=y` on the per-site lines of the output, a `presentation` field (what the
   browser presented as: user agent, webdriver flag) in `docker/data/smoke/smoke-<browser>.json`,
   and no `Target closed` or `Navigation failed` lines. A line about `dbus`, `GPU` or `sandbox`
   from a browser is normal in a container. The command exits
   non-zero if either browser fails. If Firefox cannot start, look for a sandbox message and say
   so rather than guessing; `MOZ_DISABLE_CONTENT_SANDBOX=1` in the compose `environment` is the
   usual remedy, and it is container-only in the same way as the Chromium flags.

5. **Install the timer**: `sh /opt/adtripwire/docker/host/install.sh`, then
   `systemctl list-timers adtripwire-exposure-docker.timer`. This installs system units
   (`sudo`). `--user` installs user units instead (the user needs the `docker` group and
   `loginctl enable-linger`); `--remove` removes them. The unit runs
   `docker compose run --rm exposure` in `/opt/adtripwire/docker`.

6. **Switch the laptop off, so two primaries never run.** ON THE LAPTOP, once the smoke test has
   passed and the server's timer is installed: `sh scripts/install-exposure-timer.sh --remove`.
   Two machines with the same rig name and role would publish over each other.

7. **Watch the first full run.** To start it now instead of waiting for the timer:
   `sudo systemctl start adtripwire-exposure-docker.service` (about 5 hours). Progress:
   `journalctl -u adtripwire-exposure-docker -f` and the per-variant logs
   `docker/data/exposure/live/<date>-<variant>.log`. `docker ps` shows the container;
   `docker stats` its memory. The container removes itself at the end (`--rm`); the results stay in
   `docker/data/exposure/`.

8. **Check the result.** The observatory page shows the new day (rows for all nine variants,
   under the rig name from the env file), the `observatory:` lines in the journal say what was
   published, and the ntfy message arrives (the primary only; the text is also in
   `docker/data/exposure/notifications.log`).

9. **Update**: `cd /opt/adtripwire && git pull && cd docker && docker compose build`. The next run
   uses the new image. Indicator refreshes arrive with the pull.

10. **Stop and remove.** Pause: `sudo systemctl disable --now adtripwire-exposure-docker.timer`.
    Remove the units: `sh /opt/adtripwire/docker/host/install.sh --remove`. Remove the image:
    `docker rmi adtripwire-rig`. Remove the data, the env file and the deploy key:
    `sudo rm -rf /opt/adtripwire/docker/data /opt/adtripwire/docker/observatory.env`. Revoke the
    deploy key on GitHub if the machine is retired.

## Trust

The deploy key on the server can write to the dataset repository (the observatory repository) and
nothing else: it is a per-repository deploy key. The container has no other credentials and
the harness makes no requests other than the visits to the site list, the `git` publishing steps
and the notification command from the env file. Keep `docker/observatory.env` and `docker/data/`
readable by the owner only; both are gitignored.
