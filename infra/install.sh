#!/usr/bin/env bash
# FLEETBOARD agent installer: one command for every rig (Linux/systemd or macOS/launchd).
#
#   curl -fsSL https://github.com/0xnullsect0r/fleetboard/releases/latest/download/install.sh \
#     | SERVER=ws://100.x.y.z:8080/ws/agent TOKEN=... NAME=garuda-pc bash
#
# Optional env: NAME (default: hostname), XMRIG_API, XMRIG_TOKEN, SRBMINER_API, INTERVAL,
# XMR_WALLET_RPC, XEL_WALLET_RPC, XEL_WALLET_USER, XEL_WALLET_PASS,
# REPO (default 0xnullsect0r/fleetboard), VERSION (release tag, default latest),
# AGENT_FILE (install a local binary instead of downloading).
# Pass --uninstall to remove the agent.
set -euo pipefail

REPO="${REPO:-0xnullsect0r/fleetboard}"
VERSION="${VERSION:-latest}"
if [ "$VERSION" = "latest" ]; then
  BASE="https://github.com/${REPO}/releases/latest/download"
else
  BASE="https://github.com/${REPO}/releases/download/${VERSION}"
fi

case "$(uname -s)" in
  Linux) script="install-agent.sh" ;;
  Darwin) script="install-agent-macos.sh" ;;
  *) echo "fleet-agent: unsupported OS $(uname -s)" >&2; exit 1 ;;
esac

here="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
if [ -n "$here" ] && [ -f "$here/$script" ]; then
  exec bash "$here/$script" "$@"
fi

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$BASE/$script" -o "$tmp"
else
  wget -qO "$tmp" "$BASE/$script"
fi
REPO="$REPO" VERSION="$VERSION" bash "$tmp" "$@"
