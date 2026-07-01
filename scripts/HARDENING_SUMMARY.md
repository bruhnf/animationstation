# Server Hardening — Review Document

**Script:** [`scripts/harden-server.sh`](harden-server.sh)
**Target:** Both Lightsail boxes — DEV `54.173.136.56` (`api-dev.evofaceflow.com`, `develop`) and PROD `34.227.203.230` (`api.evofaceflow.com`, `main`). The script is environment-agnostic; it acts on whichever host you run it on.
**OS:** Ubuntu 22.04.5 LTS (kernel 6.8.0-1051-aws)
**Status:** ✅ **APPLIED to DEV + PROD 2026-06-07** (run with `--lynis`, all 14 steps verified on both). DEV: Lynis index **76**. PROD (`34.227.203.230`): dry-run first, config steps **zero-downtime** (Docker not bounced), kernel reboot a single ~10s blip (502→200), Lynis index **75**. Both on kernel 6.8.0-1057-aws with Docker log-rotation active and the previously world-readable `backend/.env` now `600`.
**Date surveyed:** 2026-06-07

> This document describes **exactly** what the script changes. It was applied to
> the DEV server on 2026-06-07 and every step was verified (see git history /
> the run log at `/var/log/server-hardening-*.log` on the box). Prod is untouched.

---

## 1. What the survey found

I SSH'd in and inspected the live security posture. Several things are already
in good shape (credit where due), and a handful need hardening.

### Already good — left untouched
| Item | State |
|---|---|
| SSH password auth | **Disabled** (`passwordauthentication no`) — key-only |
| Root SSH key | Carries a forced-command stub (AWS default) → interactive root login already blocked |
| Postgres `5432` | Bound to `127.0.0.1` only (not public) |
| Redis `6379` | Container-internal only |
| AppArmor | Loaded, 43 profiles enforcing |
| Swap | 2 GB configured |
| Time sync | systemd-timesyncd active, clock synced |
| TLS certs | `certbot.timer` active, auto-renewing |
| Unattended-upgrades | Installed & active |
| nginx web filtering | fail2ban runs **in a container** watching nginx logs |

### Needs hardening — what the script fixes
| # | Finding | Risk | Fix |
|---|---|---|---|
| A | **UFW firewall inactive** | No host-level packet filtering; relies solely on the Lightsail cloud firewall | Enable UFW: deny-in, allow 22/80/443, rate-limit SSH |
| B | **`backend/.env` is world-readable** (`-rw-rw-r--`) | Any local account can read DB URL, JWT secrets, AWS + Grok keys, Apple config | `chmod 600`, `chown ubuntu:ubuntu` |
| C | **No host fail2ban for SSH** | Only nginx is protected; host SSH has no brute-force ban | Install host fail2ban with `sshd` + `recidive` jails |
| D | **Auto-reboot disabled** for unattended upgrades | Security kernel patches install but never activate | Enable auto-reboot at 02:00 |
| E | **8 pkgs pending + reboot required** | Unpatched packages; a kernel update is staged | `apt dist-upgrade` (+ optional reboot) |
| F | **No Docker log rotation** (`daemon.json` absent) | Container logs grow unbounded → disk-fill DoS | Add `json-file` rotation (10 MB × 3) |
| G | SSH: X11 forwarding on, `MaxAuthTries 6`, root `without-password` | Larger attack surface than needed | Drop-in: `X11Forwarding no`, `MaxAuthTries 3`, `PermitRootLogin no`, idle timeouts, `AllowUsers ubuntu` |
| H | sysctl: `send_redirects=1`, `log_martians=0` | Minor network-spoofing surface | Hardened sysctl drop-in |
| I | Core dumps enabled | Info-leak + disk usage | Disable via limits.d |
| J | No audit trail (auditd) | No record of security-relevant syscalls | Install + enable auditd |

---

## 2. Exactly what the script changes

Every file it modifies is **backed up first** to `/root/hardening-backups/<timestamp>/`
(preserving the original path), and all actions are logged to
`/var/log/server-hardening-<timestamp>.log`.

### Step 1 — System updates
- `apt-get update && apt-get dist-upgrade` (clears the 8 pending updates)
- `apt-get autoremove --purge` + `autoclean`
- A reboot is **not** forced unless you pass `--reboot` (see §5).

### Step 2 — Unattended upgrades + auto-reboot
- **Writes** `/etc/apt/apt.conf.d/20auto-upgrades` (update + download + upgrade + autoclean).
- **Writes** `/etc/apt/apt.conf.d/52unattended-upgrades-local`:
  - `Automatic-Reboot "true"` at `02:00`
  - Remove unused kernels + dependencies
- Enables the `unattended-upgrades` service.

### Step 3 — UFW host firewall
- Installs UFW, resets it, then:
  - default **deny** incoming, **allow** outgoing
  - `limit 22/tcp` (rate-limited SSH — auto-throttles repeat connectors)
  - `allow 80/tcp`, `allow 443/tcp`
  - `ufw --force enable`
- **SSH is allowed before enable** → no lockout risk.
- ⚠️ **Important nuance:** Docker publishes 80/443 through its *own* iptables
  chain and **bypasses UFW**. So UFW here primarily guards **SSH and any future
  host service** — it is defense-in-depth layered under the Lightsail cloud
  firewall (which remains your primary edge filter). The 80/443 rules are
  belt-and-suspenders and harmless.

### Step 4 — SSH hardening
- **Writes** `/etc/ssh/sshd_config.d/99-hardening.conf`:
  `PermitRootLogin no`, `PasswordAuthentication no`, `X11Forwarding no`,
  `MaxAuthTries 3`, `MaxSessions 4`, `LoginGraceTime 30`,
  `ClientAliveInterval 300` / `ClientAliveCountMax 2`, `AllowUsers ubuntu`,
  and a login `Banner`.
- **Writes** `/etc/issue.net` (authorized-use banner).
- **Validates** with `sshd -t`; only then `systemctl reload ssh` (never restart).
  If validation fails the drop-in is removed and SSH is left untouched.
- `AllowTcpForwarding` is **left at default (yes)** so SSH tunnels to the DB /
  admin dashboard keep working.

> ⚠️ **`AllowUsers ubuntu`** means *only* the `ubuntu` user may SSH in afterward.
> That matches the only human account on the box today. If you ever add another
> SSH user, add them to this line.

### Step 5 — Host fail2ban (SSH)
- Installs host `fail2ban` (separate from the nginx container's fail2ban).
- **Writes** `/etc/fail2ban/jail.local`: `[sshd]` (4 retries → 1 h ban)
  and `[recidive]` (repeat offenders → 1 week), `banaction = ufw`. (`jail.local`
  survives package upgrades; the script migrates off any earlier `jail.d` drop-in.)

### Step 6 — sysctl hardening
- **Writes** `/etc/sysctl.d/99-hardening.conf`: disable redirects/source-routing,
  enable `log_martians`, SYN cookies, `kptr_restrict=2`, `ptrace_scope=1`,
  `protected_fifos/regular`, `suid_dumpable=0`. Applied with `sysctl --system`.
- `rp_filter` is **deliberately left alone** (Docker multi-interface safety).

### Step 7 — Docker log rotation
- **Writes** `/etc/docker/daemon.json`: `json-file` driver, `max-size 10m`,
  `max-file 3`, `live-restore true`.
- ⚠️ The script does **NOT** restart Docker (that would bounce every container).
  This change activates on the **next Docker restart or reboot**. Since the
  kernel update already needs a reboot, it'll apply then — or run
  `systemctl restart docker` yourself in a maintenance window.

### Step 8 — Secret file permissions
- Finds every `.env` under `/opt/evofaceflow/TryOn` (excluding `node_modules`),
  sets `chown ubuntu:ubuntu` + `chmod 600`.
- `chmod 600` any Apple `.p8` key under `backend/certs/`.

### Step 9 — Core dumps off
- **Writes** `/etc/security/limits.d/99-no-core.conf` (`hard/soft core 0`).

### Step 10 — auditd + baseline ruleset
- Installs and enables `auditd` (+ `audispd-plugins`).
- **Writes** `/etc/audit/rules.d/99-hardening.rules` and loads it (`augenrules`):
  watches for changes to identity files (`passwd`/`shadow`/`group`), `sudoers`,
  SSH config, login records, kernel-module load/unload, and time changes
  (~16 active rules). Not made immutable, so it stays editable on this dev box.

### Step 11 — login.defs password & umask policy
- Idempotently sets `PASS_MAX_DAYS 365`, `PASS_MIN_DAYS 1`, `PASS_WARN_AGE 14`,
  `UMASK 027`, `SHA_CRYPT_MIN_ROUNDS 10000` (only touches uncommented directives;
  comments are preserved). Affects password accounts (key-only today) and
  hardens default file perms for new files.

### Step 12 — PAM password strength
- Installs `libpam-pwquality` + `libpam-tmpdir` (auto-wired via `pam-auth-update`).
- **Writes** `/etc/security/pwquality.conf`: `minlen 12`, `minclass 3`, one each of
  lower/upper/digit/other required, `maxrepeat 3`. These apply only when a
  password is *set* — they never affect key-based SSH.

### Step 13 — Patch-management tooling
- Installs `debsums` (verify installed packages against known-good hashes) and
  `apt-show-versions` (patch-status visibility). Read-only utilities, no runtime risk.

### Step 14 — Lynis (optional, `--lynis` only)
- Installs Lynis and runs a **read-only** `lynis audit system`, saving a report
  to `/root/lynis-report-<timestamp>.txt`. Makes no changes — just scores you.
  Post-hardening index on dev: **76** (up from 70 before steps 10–13).

---

## 3. What the script does NOT do (deliberately)

- **No Docker restart / no forced reboot** unless you pass `--reboot`.
- **No `prisma migrate`, `git pull`, or app deploy** — purely OS-level.
- **No change to the Lightsail cloud firewall** (managed in the AWS console; UFW
  is layered beneath it).
- **No `rp_filter` tightening** (Docker safety).
- **No removal of `ubuntu`'s passwordless sudo** (cloud-init default; removing it
  would break your deploy workflow — flagged here as a conscious choice).
- **Does not touch prod** (`34.227.203.230`). See §6.
- **Deliberately skips heavy/noisy Lynis suggestions** not worth it on a dev box:
  file-integrity (AIDE — slow init, constant change noise), malware scanners
  (rkhunter/chkrootkit — cron noise + false positives), auditd *immutable* mode,
  and external log shipping. Revisit these if/when this maps onto prod.

---

## 4. How to run it (after you approve)

```bash
# Copy script to the dev server
scp -i "E:\Projects\EvoFaceFlow\LightsailDefaultKey-us-east-1.pem" \
    scripts/harden-server.sh ubuntu@54.173.136.56:/tmp/

# Dry run first — prints every change, applies nothing
ssh -i "E:\Projects\EvoFaceFlow\LightsailDefaultKey-us-east-1.pem" ubuntu@54.173.136.56 \
    "chmod +x /tmp/harden-server.sh && sudo /tmp/harden-server.sh --dry-run"

# Apply (recommended: keep your current SSH session open as a safety net,
# then open a SECOND session to confirm SSH still works before closing the first)
ssh -i "...\LightsailDefaultKey-us-east-1.pem" ubuntu@54.173.136.56 \
    "sudo /tmp/harden-server.sh --lynis"

# Apply and reboot for the staged kernel update (off-hours):
#   sudo /tmp/harden-server.sh --reboot
```

**Safe-apply checklist:**
1. Run `--dry-run`, read the output.
2. Apply with your existing SSH session still open.
3. Open a **second** terminal and SSH in fresh — confirm you can still get in
   (validates the SSH + UFW + fail2ban changes) **before** closing the first.
4. Reboot off-hours to activate the kernel update + Docker log rotation.

---

## 5. Rollback

Everything modified is under `/root/hardening-backups/<timestamp>/`. To revert a
single change, copy the original back and reload the relevant service, e.g.:

```bash
# Undo SSH hardening
sudo rm /etc/ssh/sshd_config.d/99-hardening.conf && sudo systemctl reload ssh
# Disable the firewall
sudo ufw disable
# Restore any backed-up file
sudo cp -a /root/hardening-backups/<ts>/etc/apt/apt.conf.d/20auto-upgrades /etc/apt/apt.conf.d/
```

---

## 6. Note on production

This script is written for and scoped to the **dev** box. It is safe to reuse on
prod (`34.227.203.230`) with two caveats:

1. **Prod nginx IP-allowlists the admin surface** (`/admin`, `/api/admin`). UFW
   doesn't touch that (it's an nginx-level rule), so no conflict — but be aware
   the admin allowlist is a separate moving part.
2. **`--reboot` on prod = user-facing downtime.** Schedule it, and remember the
   Docker stack auto-starts on boot. Do a `--dry-run` on prod first regardless.

Recommend hardening **dev first, verify for a few days, then prod.**
