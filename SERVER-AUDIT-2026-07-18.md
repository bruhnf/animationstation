# Server Security Audit — 2026-07-18

Live-state audit of both Lightsail boxes against the hardening baseline established by
`TryOn/www/scripts/harden-server.sh` (applied June 2026). The boxes are shared hosts:
each runs TryOn, AnimationStation, and Merlin behind a single `edge-proxy` container.

| Environment | Host | IP | Kernel | Lynis index |
|---|---|---|---|---|
| Dev | dev.animationstation.ai | 54.173.136.56 | 6.8.0-1060-aws | **75** (0 warnings) |
| Prod | animationstation.ai | 34.227.203.230 | 6.8.0-1060-aws | **75** (0 warnings) |

Method: read-only inspection over SSH (config files, live kernel values, service state,
listening sockets, container inventory) plus a fresh `lynis audit system` on each box.
The only changes made during the audit were pre-approved `chmod 600` fixes on secret
files (§3.1). Everything else is report-only.

---

## 1. Verdict

The June hardening is still largely intact and working on both boxes. Auto-reboot
patching is demonstrably functioning (both boxes rebooted themselves 2026-07-03 at
02:01, the configured window), fail2ban is actively banning SSH brute-forcers
(25 bans on dev, 63 on prod), UFW is enforcing (my own audit burst tripped the SSH
rate-limit), and Docker log rotation — deferred at apply time — is confirmed active.

Three real gaps were found, all caused by things the script never contemplated:
1. **Secret files added after the hardening run were group/world-readable** (fixed
   during this audit — §3.1).
2. **Three sysctl hardening values are silently overridden** by UFW, systemd, and
   Apport (§3.2).
3. **The AnimationStation admin dashboard HTML is publicly reachable** on prod and
   dev, unlike TryOn's admin which is IP-allowlisted at nginx (§3.3).

**Everything below has since been remediated** (2026-07-18/19, both boxes — §5),
including a fourth, worse finding made during remediation: the container
fail2ban's web jails were tailing an unreadable stdout symlink and had been
blind for months (§3.5). The last follow-up — web fail2ban coverage for Merlin —
was closed 2026-07-19 (§4 item 3). No open items remain from this audit.

## 2. Item-by-item: script baseline vs. live state

Verified identical on **both** boxes unless noted.

| # | Script item | Live state | Status |
|---|---|---|---|
| 1 | System updates current | Dev: 13 pkgs upgradable (mostly Docker CE — third-party repo, not auto-patched). Prod: 4. **0 security updates pending**, no reboot required | OK — see §4.1 |
| 2 | Unattended-upgrades + 02:00 auto-reboot | Enabled, active, config files intact, ran this morning. Both boxes auto-rebooted 2026-07-03 ~02:01 — the mechanism provably works | **OK** |
| 3 | UFW: deny-in, limit 22, allow 80/443 | Active with exactly those rules (dev also has a manual `REJECT` for 95.38.176.137). Rate-limit on 22 confirmed live | **OK** |
| 4 | SSH drop-in (`99-hardening.conf`) | All values in effect per `sshd -T`: root login off, password auth off, X11 off, MaxAuthTries 3, `AllowUsers ubuntu`, banner shown | **OK** |
| 5 | Host fail2ban (`sshd` + `recidive`) | Enabled, active, `jail.local` intact. sshd jail: 25 total bans (dev), 63 (prod). recidive: 0 | **OK** |
| 6 | sysctl drop-in | File intact, but **3 of 12 audited values overridden at runtime** (`log_martians=0`, `protected_fifos=1`, `suid_dumpable=2`) | **DRIFT — §3.2** |
| 7 | Docker log rotation (10m × 3) + live-restore | `daemon.json` intact **and now active** (`docker info` confirms; largest container log 7.9 MB, consistent with the cap) | **OK** |
| 8 | Secrets `chmod 600` | TryOn's own `.env`s were still 600, but AnimationStation/Merlin `.env`s (never covered by the script's `/opt/evofaceflow/TryOn` path) were 640–660, and two TryOn `.env.bak.*` files were **world-readable (664)** on each box | **FIXED — §3.1** |
| 9 | Core dumps disabled | `limits.d` file intact, `ulimit -c` = 0 — but **Apport is enabled/active** and re-points `core_pattern` + sets `suid_dumpable=2` | **DRIFT — §3.2** |
| 10 | auditd + 16 rules | Enabled, active, 16 rules loaded on both | **OK** |
| 11 | login.defs policy | All five values exactly as written | **OK** |
| 12 | pwquality + libpam-tmpdir | Installed, config intact | **OK** |
| 13 | debsums + apt-show-versions | Installed | **OK** |
| 14 | Lynis | Fresh scans: **75 / 75**, 0 warnings on either box. (Note: the June `--quiet` runs saved empty report files; the scores in HARDENING_SUMMARY.md came from the terminal output, not the saved files) | **OK** |

Baseline items from the script's "already good" list also re-verified: Postgres and
Redis are not internet-exposed (only 22/80/443 listen publicly; the sole 5432 publish
is `127.0.0.1`), AppArmor enforcing, swap 2G, clock synced (chrony has replaced
timesyncd — fine), certbot.timer active with all certs valid into Sep–Oct 2026, no
account has a password set, one authorized key per box for `ubuntu`, root's key still
carries the AWS forced-command stub.

## 3. Findings

### 3.1 Secret file permissions (HIGH for the 664 files — fixed on the spot)

The script's step 8 only ever covered `/opt/evofaceflow/TryOn`. Two more apps have
since moved onto these boxes and their secrets were looser than policy, including two
world-readable backup copies of TryOn's full backend secrets (DB URL, JWT secrets, AWS
keys, Grok key at the time of the backup):

Fixed to `600 ubuntu:ubuntu` during this audit — dev: `animationstation/backend/.env`
(was 660), `animationstation/.env`, two AS `.env.bak.*`, `merlin/.env` + its `.bak`
(640), TryOn `.env.bak.ses-cutover` and `.env.bak. ` (**664**). Prod: the equivalent
set (`animationstation/backend/.env` 660, TryOn `.env.bak.ses-cutover` **664**, etc.).
All `.env*` non-example files under `/opt` on both boxes are now 600; verified.

**Residual risk before the fix was low** (no untrusted local users; `/opt/animationstation`
itself is `750`) but these files are exactly what an attacker with any local foothold
looks for. Two follow-ups worth doing:
- The stray `/opt/evofaceflow/TryOn/backend/.env.bak. ` (trailing space) and the other
  aging `.env.bak.*` copies hold **stale but possibly still-valid** credentials.
  Recommend deleting the backups you no longer need (not done — deletion wasn't in scope).
- Future deploys should create `.env` backups with `install -m 600` / `cp --preserve=mode`
  so this doesn't regress. Any future app under `/opt` needs the same treatment.

### 3.2 Three sysctl values silently overridden (MEDIUM)

The hardening drop-in `/etc/sysctl.d/99-hardening.conf` is intact on both boxes, but
three of its values lose at runtime:

| Key | Wanted | Live | Overridden by |
|---|---|---|---|
| `net.ipv4.conf.{all,default}.log_martians` | 1 | 0 | `/etc/ufw/sysctl.conf` lines 29–30 — UFW applies its own sysctl file *after* boot sysctl (`IPT_SYSCTL=/etc/ufw/sysctl.conf` in `/etc/default/ufw`) |
| `fs.protected_fifos` | 2 | 1 | `/usr/lib/sysctl.d/99-protect-links.conf` — sorts after `99-hardening.conf` alphabetically (`h` < `p`), so it wins |
| `fs.suid_dumpable` | 0 | 2 | **Apport** (enabled + active) sets it at startup and re-points `kernel.core_pattern` to itself |

Recommended fixes (config changes — not applied, need your go-ahead):
```bash
# 1. UFW override — delete its log_martians lines (run on each box)
sudo sed -i '/log_martians/d' /etc/ufw/sysctl.conf

# 2. Ordering — rename the drop-in so it sorts last
sudo mv /etc/sysctl.d/99-hardening.conf /etc/sysctl.d/zz-hardening.conf

# 3. Apport — a crash-reporting desktop tool with a CVE history; disable on servers.
#    Also neutralizes the core_pattern hijack (core dumps then hit the ulimit-0 wall).
sudo systemctl disable --now apport

# Then re-apply and verify
sudo sysctl --system >/dev/null
sysctl fs.suid_dumpable fs.protected_fifos net.ipv4.conf.all.log_martians
```
All three are cosmetic-to-minor in isolation (martian logging is observability, the
fifos delta is a niche sticky-dir attack, suid_dumpable=2 writes root-only dumps), but
they mean the box does not match its documented baseline — worth closing.

### 3.3 AnimationStation admin dashboard publicly reachable (MEDIUM)

External probes (from off-box):

| URL | Result |
|---|---|
| `https://api.evofaceflow.com/admin` (TryOn prod) | **403** — nginx IP-allowlist working |
| `https://animationstation.ai/admin` | **200** — dashboard HTML served to anyone |
| `https://dev.animationstation.ai/admin` | **200** — same |
| `https://animationstation.ai/api/admin/settings` | 403 without `X-Admin-Key` — API layer is gated |

The `X-Admin-Key` check does protect every action, so this is exposure of the admin
*UI shell*, not of data. But it advertises the admin surface to scanners, invites
key-guessing traffic, and is a regression relative to the TryOn pattern on the same
host (defense-in-depth: allowlist at the proxy *and* key at the app). Recommend adding
the same IP-allowlist for `animationstation.ai/admin` + `/api/admin` at the proxy layer,
or serving `/admin` only after key auth.

### 3.4 Docker CE updates are not auto-patched (LOW)

Unattended-upgrades only patches Ubuntu-origin packages. The Docker CE stack comes
from Docker's own apt repo, so it accumulates: dev is holding docker-ce/containerd
29.5.3→29.6.2 plus plugins (13 pkgs total); prod is clean apart from 4 trivial Ubuntu
non-security updates. None are security updates today, but containerd/runc CVEs are a
recurring thing — worth a periodic manual `apt-get dist-upgrade` (it restarts Docker,
so treat it like a deploy window; `live-restore` keeps containers up through the
daemon restart, but plan for a blip).

### 3.5 Architecture drift the script predates (INFO)

- **A third app (Merlin) now runs on both boxes**, and an `edge-proxy` container
  (nginx:alpine, config at `/srv/proxy/nginx.conf` on the host) now owns 80/443,
  routing to the per-app nginx/api containers. Any future hardening doc should treat
  the box as a three-tenant host with a shared edge, not "the TryOn server".
- **The nginx-layer fail2ban was completely blind** (worse than suspected): the
  nginx image symlinks `access.log → /dev/stdout`, which is unreadable from the
  fail2ban container, so every web jail had been tailing nothing. Client IPs
  were never the problem — edge-proxy speaks PROXY protocol and tryon-nginx has
  `real_ip_header proxy_protocol`, so once nginx also writes a real file the
  logs carry true client IPs. Fixed — see §5.
- The script's step 8 path, `AllowUsers`, and project-dir assumptions are TryOn-scoped;
  if the script is ever re-run it will not protect the other two apps' secrets (§3.1).

## 4. Open items / recommendations (ranked)

All six were executed 2026-07-18/19 — see §5 for exactly what was done.

1. ~~**(M, big)** Close the three sysctl overrides + disable Apport~~ — **DONE** both boxes.
2. ~~**(M, moderate)** IP-allowlist the AnimationStation admin surface~~ — **DONE** both vhosts.
3. ~~**(L, moderate)** Verify fail2ban log flow~~ — **DONE**; found worse (jails were
   blind, §3.5) and fixed. The Merlin gap was closed 2026-07-19: Merlin's nginx now
   dual-logs to a real `host-access.log` on a `merlin_nginx_logs` volume, mounted
   read-only into `tryon-fail2ban-1` at `/var/log/nginx-merlin` — all five web jails
   watch both apps' logs on both boxes (rotation: `/etc/logrotate.d/merlin-nginx-logs`).
   Within a minute of the dev deploy the new log caught a scanner probing
   `/.aws/credentials` and `/.git/HEAD`.
4. ~~**(L, low)** Delete stale `.env.bak.*`; adopt `install -m 600`~~ — **DONE** (deleted on
   both; practice documented in DEPLOYMENT.md §8).
5. ~~**(L, low)** Monthly Docker CE upgrade window~~ — **DONE** (dev upgraded 29.5.3→29.6.2;
   prod had no Docker CE pending; window documented in DEPLOYMENT.md §8).
6. ~~**(L, low)** Update TryOn `HARDENING_SUMMARY.md`~~ — **DONE** (+ `harden-server.sh`
   patched so a re-run reproduces the fixed state instead of regressing it).

Deliberately-skipped items from the script's §3 (AIDE, rkhunter, auditd immutable
mode, external log shipping, removing passwordless sudo) were re-considered: still
reasonable to skip on these boxes, with one nuance — prod now hosts three live App
Store apps' backends, so **external log shipping / snapshot-verified backups** are the
first of those worth promoting if you want to invest further. Lynis's remaining
suggestions (GRUB password, partitioning, process accounting) are low-value on
single-admin cloud boxes.

## 5. Remediation log (2026-07-18/19)

Host-level, applied identically to dev and prod (dev first, verified, then prod
with explicit approval):

- `sed -i '/log_martians/d' /etc/ufw/sysctl.conf`; renamed the sysctl drop-in to
  `/etc/sysctl.d/99-zz-hardening.conf` (sorts after systemd's `99-protect-links`);
  `systemctl disable --now apport`. Verified live: `log_martians=1`,
  `protected_fifos=2`, `suid_dumpable=0`, `core_pattern=core`.
- Deleted all stale `.env.bak.*` under `/opt` (7 on dev, 4 on prod); every remaining
  `.env*` secret is `600 ubuntu:ubuntu`.
- `apt dist-upgrade`: dev 13 pkgs (Docker CE 29.5.3→29.6.2, containerd, plugins —
  `live-restore` kept all containers up), prod 4 trivial Ubuntu pkgs. No reboot
  required on either box.
- New `/etc/logrotate.d/tryon-nginx-logs` on both boxes (weekly / 50 MB, keep 4,
  copytruncate) for the new real nginx log files.

Via the TryOn repo (commits `317d7f4` + `90c80d5`, develop → dev box, then
fast-forwarded to main → prod box):

- nginx (both envs) now writes `host-access.log` as a real file on the shared
  volume alongside the stdout log; all five web jails repointed to it, and the
  php/wordpress/badbots jails additionally tail `blocked.log` (the only place
  those probes land). Verified: jails list the right files, the log carries real
  client IPs (PROXY protocol end-to-end), and it was catching a live wp-admin
  scan within minutes on prod.
- `animationstation.ai` and `dev.animationstation.ai` now have `location = /admin`
  and `location /api/admin` behind the same IP allowlist as the TryOn admin.
  Verified from a non-allowlisted IP: **403** on both, app traffic unaffected.
- **Ops gotcha discovered:** the nginx and fail2ban configs are single-file bind
  mounts — after a `git pull` the running container keeps the pre-pull inode, so
  `nginx -s reload` silently reloads the OLD config. Config deploys must
  force-recreate/restart the container (documented in DEPLOYMENT.md §5, which
  already warned about this for compose files).
- Housekeeping found on the dev box: its TryOn checkout had a local commit
  (`c9f1e3e`, a duplicate of the pushed `f8d1ffa`); converged via merge at first
  (`ahead 2`), then reset to `origin/develop` on 2026-07-19 — the checkout now
  tracks origin exactly.

Merlin coverage (2026-07-19, closing §4 item 3): Merlin repo commit `aaada21`
(cherry-picked to main as `d8f4aaf` — develop carried unreleased features, so no
fast-forward) gives its nginx a `merlin_nginx_logs` volume and a real
`host-access.log`; TryOn commits `d2e496f`/`f3010f5` mount that volume into
`tryon-fail2ban-1` and add it to every web jail's logpath. Deployed dev → prod,
verified on both: jails list both apps' logs, zero fail2ban errors, real client
IPs end-to-end, all four public hostnames healthy after the recreates.

Post-remediation external checks: `/admin` 403 (strangers) / 200 (allowlisted IP)
on dev and prod; `/health` 200 on all three apps' prod hostnames.
