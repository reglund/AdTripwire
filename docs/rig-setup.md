# Running a rig

A rig is a machine that runs the AdTripwire exposure harness every day with its own browser
profiles and publishes its runs to the observatory under its own name. The more places the
harness runs from (country, home or mobile network), the more the observatory can show. This
page takes you from a fresh machine to the first published row.

The browsers on a rig are automated and synthetic: no personal browsing, no logins, no
extension installed in your own browser. Use a machine and a network connection you are
comfortable with the sites being visited from; the visits are to public news and media sites.

## Steps

1. **Clone the repository** on a Linux machine that stays on at about 11:30 local time and has
   Node 20 and pnpm: `git clone <repository URL> ~/git/AdTripwire` (the systemd unit expects
   that path).
2. **Install dependencies**: `cd ~/git/AdTripwire && pnpm install`.
3. **Install the browsers as snaps** if they are not there already: `sudo snap install firefox`
   and `sudo snap install chromium`. The harness keeps its profiles under
   `~/snap/<browser>/common/`.
4. **Build the evaluation bundles**: `pnpm exposure:build`.
5. **Write the env file** `~/.config/adtripwire/observatory.env` (create the directory first).
   The maintainer gives you the repository URL, the branch name and a **deploy key** (a private
   key file), all together;
   save the key as `~/.ssh/adtripwire-observatory` with `chmod 600`, and add to `~/.ssh/config`:

   ```text
   Host adtripwire-observatory
     HostName github.com
     User git
     IdentityFile ~/.ssh/adtripwire-observatory
     IdentitiesOnly yes
   ```

   Then the env file, with your own rig name, country and network class:

   ```sh
   ADTRIPWIRE_OBSERVATORY_REMOTE=git@adtripwire-observatory:<owner>/<repository>.git
   ADTRIPWIRE_OBSERVATORY_BRANCH=main
   ADTRIPWIRE_OBSERVATORY_ROLE=rig
   ADTRIPWIRE_RIG=oslo-home
   ADTRIPWIRE_RIG_COUNTRY=NO
   ADTRIPWIRE_RIG_NETWORK=home
   ```

   Use the remote, branch and key exactly as the maintainer hands them out; the branch above
   (`main`) is an example. `ADTRIPWIRE_RIG` is required once a remote is set: without it the
   daily run still measures but skips the observatory steps. The rig name is `[a-z0-9-]`, 1 to 32
   characters. Pick something that is not your hostname
   or your name. Country (ISO 3166-1 alpha-2, upper case) and network (`home`, `mobile`,
   `office` or `datacentre`) are declared by you and shown on the page as such; nobody checks
   them, and no IP address is ever recorded. `rig` is the default role and the right one for you:
   only the maintainer's machine sets `primary` and builds the page.

6. **Install the daily timer**: `sh scripts/install-exposure-timer.sh`. The first run starts at
   the next 11:30 (plus up to 30 minutes of random delay). To start one now, run
   `systemctl --user start adtripwire-exposure.service`. A full day takes about 4 to 5 hours.

7. **Check that it runs.** Per-variant logs are in `~/.cache/adtripwire-exposure/live/`
   (`<date>-<variant>.log`, one per browser and device variant). The unit's own output:
   `journalctl --user -u adtripwire-exposure`. Timer state:
   `systemctl --user list-timers adtripwire-exposure.timer`. The publish step prints lines starting with "observatory:" (for example "no changes to publish", or what it refused and why).
8. **See the result.** A rig's rows appear in the maintainer's next page build, in the Rigs
   table, under the rig name you chose. The raw files are on the branch under
   `rigs/<your rig name>/`.
9. **What your machine sends** to the observatory repository, and nothing else: the run JSON of
   each variant (sites visited, counts, detections by rule and severity, the hostnames of the
   documented ad-delivery hosts that were contacted), the Markdown report of each run, the
   extension's evidence export of each run (hostnames, path patterns and query parameter names
   from the synthetic browsers), and a small `rig.json` (rig name, country, network, time of
   export, number of runs). Your home directory path and login name are replaced by `~` before
   anything leaves the machine. No IP address, no browser history, no files from outside the
   harness's cache directory. The harness itself makes no requests other than the visits to the
   public site list; the publish step is a `git push` to the observatory repository.
10. **Stop and remove.** To pause: `systemctl --user disable --now adtripwire-exposure.timer`.
    To remove the timer: `sh scripts/install-exposure-timer.sh --remove`. To remove the data:
    delete `~/.cache/adtripwire-exposure`, `~/snap/firefox/common/adtripwire-exposure-profile*`,
    `~/snap/chromium/common/adtripwire-exposure-profile*`, the env file and the deploy key (and
    its `~/.ssh/config` entry). Ask the maintainer to delete your `rigs/<name>/` directory and
    revoke the key; rows already published stay in the repository's git history unless it is
    rewritten.

## Trust

The deploy key can write the whole branch of the observatory repository: the per-rig
directory discipline lives in the publish script on your machine, not in GitHub. Rigs are
therefore people the maintainer knows, and the key is yours alone; do not share it. The
maintainer's build re-validates every foreign run file and scrubs home paths again, and a rig
that misbehaves is removed by revoking its key and deleting its directory.

Within that trust, a rig can host arbitrary files on the Pages origin under `rigs/<name>/`, and
it can stall the primary's root publish by adding an extra entry at the branch root (the
publish script refuses a branch whose root holds anything else than a site). The primary reads
only regular files and real directories from other rigs' directories (a symbolic link is never
followed), with a size cap of 5 MB per file and at most 2000 runs per rig; the rest is skipped.

See `docs/observatory.md` for what is published and how, and `docs/exposure-session.md` for the
protocol the harness follows.
