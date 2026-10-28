#!/usr/bin/env bash
# FLEETBOARD agent for Linux + systemd (Garuda/Arch, Debian, Proxmox, Ubuntu, ...).
# Installs /opt/fleet-agent/fleet-agent, /etc/fleet-agent.env and fleet-agent.service,
# enabled at boot. Re-running upgrades the binary and keeps existing settings unless
# new values are passed. Usage: see install.sh; --uninstall removes everything.
set -euo pipefail

REPO="${REPO:-0xnullsect0r/CryptoDash}"
VERSION="${VERSION:-latest}"
PREFIX=/opt/fleet-agent
ENV_FILE=/etc/fleet-agent.env
UNIT=/etc/systemd/system/fleet-agent.service
KEYS=(SERVER TOKEN NAME XMRIG_API XMRIG_TOKEN SRBMINER_API INTERVAL XMR_WALLET_RPC XEL_WALLET_RPC XEL_WALLET_USER XEL_WALLET_PASS)

say() { printf 'fleet-agent: %s\n' "$*"; }
die() { printf 'fleet-agent: %s\n' "$*" >&2; exit 1; }

if [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null 2>&1 || die "run as root (sudo not found)"
  # Re-run as root, carrying the settings through (sudo strips env by default).
  args=()
  for k in "${KEYS[@]}" REPO VERSION AGENT_FILE AGENT_URL; do
    [ -n "${!k:-}" ] && args+=("$k=${!k}")
  done
  self="${BASH_SOURCE[0]:-}"
  [ -f "$self" ] || die "piped straight into bash: use install.sh, or pipe into 'sudo -E bash'"
  exec sudo env "${args[@]}" bash "$self" "$@"
fi

command -v systemctl >/dev/null 2>&1 || die "systemd not found; this installer targets systemd hosts"

if [ "${1:-}" = "--uninstall" ]; then
  systemctl disable --now fleet-agent.service 2>/dev/null || true
  rm -f "$UNIT" "$ENV_FILE"
  rm -rf "$PREFIX"
  systemctl daemon-reload
  say "removed"
  exit 0
fi

case "$(uname -m)" in
  x86_64 | amd64) target=linux-x64 ;;
  aarch64 | arm64) target=linux-arm64 ;;
  *) die "unsupported architecture $(uname -m)" ;;
esac

# Keep current settings on upgrade; values passed in the environment win.
if [ -f "$ENV_FILE" ]; then
  while IFS='=' read -r k v; do
    case "$k" in '' | \#*) continue ;; esac
    [ -z "${!k:-}" ] && printf -v "$k" '%s' "$v"
  done < "$ENV_FILE"
fi
[ -n "${SERVER:-}" ] || die "SERVER is required, e.g. SERVER=ws://100.64.0.3:8080/ws/agent"
[ -n "${TOKEN:-}" ] || die "TOKEN is required (the TOKEN from the server's .env)"
NAME="${NAME:-$(hostname -s 2>/dev/null || hostname)}"

download() {
  if command -v curl >/dev/null 2>&1; then curl -fSL --retry 3 -o "$2" "$1"; else wget -qO "$2" "$1"; fi
}

mkdir -p "$PREFIX"
bin="$PREFIX/fleet-agent"
tmpbin="$(mktemp "$PREFIX/.fleet-agent.XXXXXX")"
trap 'rm -f "$tmpbin"' EXIT
if [ -n "${AGENT_FILE:-}" ]; then
  cp "$AGENT_FILE" "$tmpbin"
else
  if [ "$VERSION" = "latest" ]; then base="https://github.com/${REPO}/releases/latest/download"; else base="https://github.com/${REPO}/releases/download/${VERSION}"; fi
  url="${AGENT_URL:-$base/fleet-agent-$target}"
  say "downloading $url"
  download "$url" "$tmpbin"
fi
chmod 0755 "$tmpbin"
"$tmpbin" --version >/dev/null 2>&1 || die "downloaded binary does not run on this host ($target)"
mv -f "$tmpbin" "$bin"

umask 077
{
  echo "# fleet-agent settings (written by install-agent.sh)"
  for k in "${KEYS[@]}"; do
    [ -n "${!k:-}" ] && printf '%s=%s\n' "$k" "${!k}"
  done
} > "$ENV_FILE"
chmod 0600 "$ENV_FILE"
umask 022

cat > "$UNIT" <<UNIT
[Unit]
Description=FLEETBOARD agent (reports local XMRig/SRBMiner and wallets)
Wants=network-online.target
After=network-online.target

[Service]
EnvironmentFile=$ENV_FILE
ExecStart=$bin
Restart=always
RestartSec=10
Nice=19
# Runs as a throwaway unprivileged user; it only needs outbound network.
DynamicUser=yes
ProtectSystem=strict
ProtectHome=yes

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable fleet-agent.service >/dev/null 2>&1
systemctl restart fleet-agent.service
say "installed $("$bin" --version) as '$NAME' -> $SERVER (starts at boot)"
say "logs: journalctl -u fleet-agent -f"
