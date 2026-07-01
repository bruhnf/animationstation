#!/usr/bin/env bash
#
# harden-server.sh — security hardening for the TryOn Lightsail servers
# (Ubuntu 22.04). Runs identically on DEV (54.173.136.56 / api-dev / develop) and
# PROD (34.227.203.230 / api.evofaceflow.com / main) — environment is determined
# purely by which host you run it on. Dry-run on prod first.
#
# Companion document: scripts/HARDENING_SUMMARY.md  — READ IT BEFORE RUNNING.
#
# Design principles:
#   * Idempotent  — safe to run repeatedly; re-writes drop-ins, never appends blindly.
#   * Reversible  — every file it touches is backed up under $BACKUP_DIR first.
#   * Non-disruptive — does NOT restart Docker or reboot unless you pass the flag.
#   * Lockout-safe — opens SSH in the firewall BEFORE enabling it; validates sshd
#                    config with `sshd -t` and only ever *reloads* (never restarts)
#                    sshd, so an existing session survives a bad config.
#
# Usage (run ON the server, as a sudo-capable user):
#   sudo ./harden-server.sh [--dry-run] [--lynis] [--reboot]
#
#   --dry-run   Print every change without applying anything.
#   --lynis     Also install Lynis and run a read-only audit, saving the report.
#   --reboot    Reboot at the end if the kernel update flagged one (default: no).
#
set -euo pipefail

# ----------------------------------------------------------------------------
# Flags & globals
# ----------------------------------------------------------------------------
DRY_RUN=0
RUN_LYNIS=0
DO_REBOOT=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --lynis)   RUN_LYNIS=1 ;;
    --reboot)  DO_REBOOT=1 ;;
    *) echo "Unknown argument: $arg"; exit 2 ;;
  esac
done

TS="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="/root/hardening-backups/${TS}"
LOG_FILE="/var/log/server-hardening-${TS}.log"

# Project + secrets locations (DEV)
PROJECT_DIR="/opt/evofaceflow/TryOn"
ALLOW_SSH_USER="ubuntu"   # only this user may SSH in after hardening

# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------
log()  { echo -e "[$(date +%H:%M:%S)] $*" | tee -a "$LOG_FILE"; }
step() { log "\n=== $* ==="; }

run() {
  # Echo the command; execute it unless in dry-run.
  log "  \$ $*"
  if [[ $DRY_RUN -eq 0 ]]; then
    eval "$@"
  fi
}

backup_file() {
  # Copy an existing file into the timestamped backup dir, preserving path.
  local f="$1"
  [[ -e "$f" ]] || return 0
  local dest="${BACKUP_DIR}${f}"
  if [[ $DRY_RUN -eq 0 ]]; then
    mkdir -p "$(dirname "$dest")"
    cp -a "$f" "$dest"
  fi
  log "  backed up $f -> $dest"
}

write_file() {
  # write_file <path> <<'EOF' ... EOF   (content on stdin). Backs up first.
  local path="$1"
  backup_file "$path"
  if [[ $DRY_RUN -eq 0 ]]; then
    mkdir -p "$(dirname "$path")"
    cat > "$path"
  else
    log "  (dry-run) would write $path:"
    sed 's/^/      | /' | tee -a "$LOG_FILE" >/dev/null
  fi
  log "  wrote $path"
}

set_kv() {
  # set_kv FILE KEY VALUE — idempotently set a space-delimited "KEY VALUE" line,
  # replacing an existing (possibly commented) line or appending if absent.
  local file="$1" key="$2" val="$3"
  if [[ $DRY_RUN -eq 1 ]]; then
    log "  (dry-run) would set '${key} ${val}' in ${file}"
    return 0
  fi
  # Match only an existing UNcommented directive (leading whitespace allowed but
  # NOT a leading '#', so descriptive "# KEY ..." comment lines are left alone).
  if grep -qE "^[[:space:]]*${key}([[:space:]]|\$)" "$file" 2>/dev/null; then
    sed -i -E "s|^[[:space:]]*${key}([[:space:]].*)?\$|${key} ${val}|" "$file"
  else
    echo "${key} ${val}" >> "$file"
  fi
  log "  set '${key} ${val}' in ${file}"
}

require_root() {
  if [[ $EUID -ne 0 ]]; then
    echo "This script must be run as root (use sudo)." >&2
    exit 1
  fi
}

# ----------------------------------------------------------------------------
require_root
mkdir -p "$BACKUP_DIR"
log "TryOn DEV server hardening — ${TS}"
log "Mode: $([[ $DRY_RUN -eq 1 ]] && echo DRY-RUN || echo APPLY)   Backups: $BACKUP_DIR   Log: $LOG_FILE"

# ============================================================================
# 1. System package updates
# ============================================================================
step "1. System package updates"
run "export DEBIAN_FRONTEND=noninteractive"
run "apt-get update -qq"
run "apt-get -y dist-upgrade"
run "apt-get -y autoremove --purge"
run "apt-get -y autoclean"

# ============================================================================
# 2. Automatic security updates + scheduled reboot
# ============================================================================
step "2. Unattended security upgrades + auto-reboot at 02:00"
run "apt-get -y install unattended-upgrades apt-listchanges"

write_file /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Download-Upgradeable-Packages "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF

# Local overrides — a high-numbered drop-in wins over the stock 50- file.
write_file /etc/apt/apt.conf.d/52unattended-upgrades-local <<'EOF'
// Managed by harden-server.sh — local overrides for unattended-upgrades.
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-WithUsers "true";
Unattended-Upgrade::Automatic-Reboot-Time "02:00";
EOF
run "systemctl enable --now unattended-upgrades"

# ============================================================================
# 3. UFW host firewall (defense-in-depth above the Lightsail cloud firewall)
#    NOTE: Docker publishes 80/443 via its own iptables chain and BYPASSES UFW.
#    UFW here guards SSH and any future host-level service. SSH is opened
#    BEFORE the firewall is enabled to avoid lockout.
# ============================================================================
step "3. UFW host firewall"
run "apt-get -y install ufw"
run "ufw --force reset"
run "ufw default deny incoming"
run "ufw default allow outgoing"
run "ufw limit 22/tcp comment 'SSH (rate-limited)'"
run "ufw allow 80/tcp comment 'HTTP (nginx container)'"
run "ufw allow 443/tcp comment 'HTTPS (nginx container)'"
run "ufw --force enable"
run "ufw status verbose | tee -a '$LOG_FILE'"

# ============================================================================
# 4. SSH daemon hardening (drop-in; validated before reload)
# ============================================================================
step "4. SSH hardening"
write_file /etc/ssh/sshd_config.d/99-hardening.conf <<EOF
# Managed by harden-server.sh
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PermitEmptyPasswords no
PubkeyAuthentication yes
X11Forwarding no
MaxAuthTries 3
MaxSessions 4
LoginGraceTime 30
ClientAliveInterval 300
ClientAliveCountMax 2
AllowUsers ${ALLOW_SSH_USER}
Banner /etc/issue.net
# AllowTcpForwarding is left at the default (yes) so SSH tunnels to the DB /
# admin dashboard keep working. Set to "no" here if you never tunnel.
EOF

write_file /etc/issue.net <<'EOF'
********************************************************************************
 Authorized access only. All activity is logged and monitored. Disconnect now
 if you are not an authorized user.
********************************************************************************
EOF

# Validate the FULL effective config before touching the running daemon.
if [[ $DRY_RUN -eq 0 ]]; then
  if sshd -t; then
    log "  sshd config valid — reloading (existing sessions unaffected)"
    systemctl reload ssh
  else
    log "  !! sshd -t FAILED — reverting SSH drop-in, NOT reloading"
    rm -f /etc/ssh/sshd_config.d/99-hardening.conf
    log "  SSH left unchanged. Fix the config and re-run."
  fi
else
  log "  (dry-run) would run: sshd -t && systemctl reload ssh"
fi

# ============================================================================
# 5. Host fail2ban — SSH jail (separate from the nginx container's fail2ban)
# ============================================================================
step "5. Host fail2ban (sshd jail)"
run "apt-get -y install fail2ban"
# Config lives in jail.local — survives package updates and is the Lynis-recommended
# location (vs editing jail.conf). Migrate off the earlier jail.d drop-in if present.
if [[ -f /etc/fail2ban/jail.d/00-local.conf ]]; then
  backup_file /etc/fail2ban/jail.d/00-local.conf
  run "rm -f /etc/fail2ban/jail.d/00-local.conf"
fi
write_file /etc/fail2ban/jail.local <<'EOF'
# Managed by harden-server.sh — host-level jails (host SSH only).
# The nginx web jails run inside the tryon-fail2ban container; this is separate.
[DEFAULT]
banaction = ufw
bantime   = 1h
findtime  = 10m
maxretry  = 4
backend   = systemd

[sshd]
enabled = true
port    = ssh

[recidive]
enabled  = true
bantime  = 1w
findtime = 1d
maxretry = 5
EOF
run "systemctl enable --now fail2ban"
run "systemctl restart fail2ban"

# ============================================================================
# 6. Kernel / network sysctl hardening (safe, Docker-compatible set)
# ============================================================================
step "6. sysctl hardening"
write_file /etc/sysctl.d/99-hardening.conf <<'EOF'
# Managed by harden-server.sh
# --- IP spoofing / redirects / source routing ---
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv6.conf.default.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0
net.ipv6.conf.all.accept_source_route = 0
net.ipv4.conf.all.log_martians = 1
net.ipv4.conf.default.log_martians = 1
# --- ICMP / SYN flood ---
net.ipv4.icmp_echo_ignore_broadcasts = 1
net.ipv4.icmp_ignore_bogus_error_responses = 1
net.ipv4.tcp_syncookies = 1
# --- Kernel info-leak / exploit hardening ---
kernel.kptr_restrict = 2
kernel.dmesg_restrict = 1
kernel.yama.ptrace_scope = 1
fs.protected_fifos = 2
fs.protected_regular = 2
fs.suid_dumpable = 0
# NOTE: rp_filter is intentionally left at the system default (2 = loose) to
# avoid breaking Docker's multi-interface networking.
EOF
run "sysctl --system >/dev/null 2>&1 || sysctl --system"

# ============================================================================
# 7. Docker daemon log rotation + live-restore
#    Applied at the next Docker restart / reboot — this script does NOT restart
#    Docker (that would bounce every container). It takes effect on the kernel
#    reboot, or run `systemctl restart docker` manually during a maintenance window.
# ============================================================================
step "7. Docker daemon log rotation (applies on next docker restart/reboot)"
write_file /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "live-restore": true
}
EOF
log "  daemon.json written. NOT restarting Docker now (would bounce containers)."
log "  It activates on the kernel-update reboot, or run: systemctl restart docker"

# ============================================================================
# 8. Lock down secret files (backend/.env was world-readable)
# ============================================================================
step "8. Secret file permissions"
if [[ -d "$PROJECT_DIR" ]]; then
  while IFS= read -r -d '' envf; do
    log "  securing $envf -> 600 ubuntu:ubuntu"
    run "chown ${ALLOW_SSH_USER}:${ALLOW_SSH_USER} '$envf'"
    run "chmod 600 '$envf'"
  done < <(find "$PROJECT_DIR" -name '.env' -type f ! -path '*/node_modules/*' -print0 2>/dev/null)
else
  log "  $PROJECT_DIR not found — skipping .env lockdown"
fi
# Apple App Store Server API private key + certs, if present.
if [[ -d "$PROJECT_DIR/backend/certs" ]]; then
  run "find '$PROJECT_DIR/backend/certs' -type f -name '*.p8' -exec chmod 600 {} +"
fi

# ============================================================================
# 9. Disable core dumps (info-leak / disk-fill)
# ============================================================================
step "9. Disable core dumps"
write_file /etc/security/limits.d/99-no-core.conf <<'EOF'
# Managed by harden-server.sh
* hard core 0
* soft core 0
EOF

# ============================================================================
# 10. auditd — basic audit logging
# ============================================================================
step "10. auditd (+ baseline ruleset)"
run "apt-get -y install auditd audispd-plugins"
write_file /etc/audit/rules.d/99-hardening.rules <<'EOF'
## Managed by harden-server.sh — baseline audit ruleset
## (loaded by augenrules; not made immutable so it stays editable on this dev box).

# Identity / auth file changes
-w /etc/passwd -p wa -k identity
-w /etc/group -p wa -k identity
-w /etc/shadow -p wa -k identity
-w /etc/gshadow -p wa -k identity

# Privilege escalation config
-w /etc/sudoers -p wa -k scope
-w /etc/sudoers.d/ -p wa -k scope

# SSH daemon config
-w /etc/ssh/sshd_config -p wa -k sshd
-w /etc/ssh/sshd_config.d/ -p wa -k sshd

# Login / session records
-w /var/log/lastlog -p wa -k logins
-w /var/log/faillog -p wa -k logins

# Kernel module load/unload
-w /sbin/insmod -p x -k modules
-w /sbin/rmmod -p x -k modules
-w /sbin/modprobe -p x -k modules
-a always,exit -F arch=b64 -S init_module -S delete_module -k modules

# System time changes
-a always,exit -F arch=b64 -S adjtimex -S settimeofday -k time-change
-a always,exit -F arch=b32 -S adjtimex -S settimeofday -S stime -k time-change
EOF
run "systemctl enable --now auditd"
if [[ $DRY_RUN -eq 0 ]]; then
  augenrules --load >/dev/null 2>&1 || systemctl restart auditd || true
  log "  audit rules loaded ($(auditctl -l 2>/dev/null | grep -c . ) active rules)"
fi

# ============================================================================
# 11. Account / password policy in login.defs
#     Affects password-based accounts (key-only today) but satisfies policy
#     audits and applies if a password account is ever added. UMASK 027 hardens
#     default file permissions for new files.
# ============================================================================
step "11. login.defs password & umask policy"
LOGIN_DEFS=/etc/login.defs
backup_file "$LOGIN_DEFS"
set_kv "$LOGIN_DEFS" PASS_MAX_DAYS 365
set_kv "$LOGIN_DEFS" PASS_MIN_DAYS 1
set_kv "$LOGIN_DEFS" PASS_WARN_AGE 14
set_kv "$LOGIN_DEFS" UMASK 027
set_kv "$LOGIN_DEFS" SHA_CRYPT_MIN_ROUNDS 10000

# ============================================================================
# 12. PAM password strength (pam_pwquality) + per-session temp dir
#     pwquality rules apply only when a password is SET (passwd/new account),
#     so they never interfere with key-based SSH.
# ============================================================================
step "12. PAM password strength + libpam-tmpdir"
run "DEBIAN_FRONTEND=noninteractive apt-get -y install libpam-pwquality libpam-tmpdir"
write_file /etc/security/pwquality.conf <<'EOF'
# Managed by harden-server.sh
minlen = 12
minclass = 3
dcredit = -1
ucredit = -1
lcredit = -1
ocredit = -1
maxrepeat = 3
gecoscheck = 1
retry = 3
EOF

# ============================================================================
# 13. Patch-management visibility tooling (read-only utilities, no runtime risk)
# ============================================================================
step "13. Patch-management tooling"
run "DEBIAN_FRONTEND=noninteractive apt-get -y install debsums apt-show-versions"

# ============================================================================
# 14. (optional) Lynis read-only security audit
# ============================================================================
if [[ $RUN_LYNIS -eq 1 ]]; then
  step "14. Lynis audit (read-only)"
  run "apt-get -y install lynis"
  LYNIS_REPORT="/root/lynis-report-${TS}.txt"
  if [[ $DRY_RUN -eq 0 ]]; then
    lynis audit system --quiet --no-colors | tee "$LYNIS_REPORT" >/dev/null || true
    log "  Lynis report saved to $LYNIS_REPORT (hardening index near the end)"
  else
    log "  (dry-run) would run: lynis audit system"
  fi
fi

# ============================================================================
# Done
# ============================================================================
step "Hardening complete"
log "Backups of all modified files: $BACKUP_DIR"
log "Full log: $LOG_FILE"

if [[ -f /var/run/reboot-required ]]; then
  log ""
  log "*** A REBOOT IS REQUIRED (kernel/library update). ***"
  log "    Rebooting also activates the new Docker daemon.json."
  if [[ $DO_REBOOT -eq 1 && $DRY_RUN -eq 0 ]]; then
    log "    --reboot passed: rebooting in 1 minute. The Docker stack restarts on boot."
    shutdown -r +1 "Rebooting after security hardening"
  else
    log "    Re-run with --reboot, or reboot manually during a maintenance window:"
    log "      sudo reboot"
  fi
fi
