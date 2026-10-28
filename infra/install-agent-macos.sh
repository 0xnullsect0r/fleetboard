#!/usr/bin/env bash
# FLEETBOARD agent for macOS (Apple Silicon or Intel), run by launchd at boot.
# Binary in ~/.fleet-agent, LaunchDaemon /Library/LaunchDaemons/com.fleetboard.agent.plist
# running as the installing user (no login needed). Needs sudo once to install.
# Usage: see install.sh; --uninstall removes everything.
set -euo pipefail

REPO="${REPO:-0xnullsect0r/CryptoDash}"
VERSION="${VERSION:-latest}"
LABEL=com.fleetboard.agent
PLIST="/Library/LaunchDaemons/$LABEL.plist"
KEYS=(SERVER TOKEN NAME XMRIG_API XMRIG_TOKEN SRBMINER_API INTERVAL XMR_WALLET_RPC XEL_WALLET_RPC XEL_WALLET_USER XEL_WALLET_PASS)

say() { printf 'fleet-agent: %s\n' "$*"; }
die() { printf 'fleet-agent: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -ne 0 ] || die "run as your normal user (it asks for sudo when needed), not as root"
USER_NAME="$(id -un)"
DIR="$HOME/.fleet-agent"

if [ "${1:-}" = "--uninstall" ]; then
  sudo launchctl bootout "system/$LABEL" 2>/dev/null || true
  sudo rm -f "$PLIST"
  rm -rf "$DIR"
  say "removed"
  exit 0
fi

case "$(uname -m)" in
  arm64) target=darwin-arm64 ;;
  x86_64) target=darwin-x64 ;;
  *) die "unsupported architecture $(uname -m)" ;;
esac

# Keep settings from a previous install unless new values are passed.
if [ -f "$PLIST" ]; then
  for k in "${KEYS[@]}"; do
    if [ -z "${!k:-}" ]; then
      v="$(/usr/libexec/PlistBuddy -c "Print :EnvironmentVariables:$k" "$PLIST" 2>/dev/null || true)"
      [ -n "$v" ] && printf -v "$k" '%s' "$v"
    fi
  done
fi
[ -n "${SERVER:-}" ] || die "SERVER is required, e.g. SERVER=ws://100.64.0.3:8080/ws/agent"
[ -n "${TOKEN:-}" ] || die "TOKEN is required (the TOKEN from the server's .env)"
NAME="${NAME:-$(scutil --get LocalHostName 2>/dev/null || hostname -s)}"

mkdir -p "$DIR"
bin="$DIR/fleet-agent"
tmpbin="$(mktemp "$DIR/.fleet-agent.XXXXXX")"
trap 'rm -f "$tmpbin"' EXIT
if [ -n "${AGENT_FILE:-}" ]; then
  cp "$AGENT_FILE" "$tmpbin"
else
  if [ "$VERSION" = "latest" ]; then base="https://github.com/${REPO}/releases/latest/download"; else base="https://github.com/${REPO}/releases/download/${VERSION}"; fi
  url="${AGENT_URL:-$base/fleet-agent-$target}"
  say "downloading $url"
  curl -fSL --retry 3 -o "$tmpbin" "$url"
fi
chmod 0755 "$tmpbin"
# Downloaded binaries are quarantined and unsigned; clear the flag and ad-hoc sign
# so Gatekeeper (and Apple Silicon's signature requirement) lets launchd run it.
xattr -d com.apple.quarantine "$tmpbin" 2>/dev/null || true
codesign --force --sign - "$tmpbin" >/dev/null 2>&1 || true
"$tmpbin" --version >/dev/null 2>&1 || die "binary does not run on this Mac ($target)"
mv -f "$tmpbin" "$bin"

xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
envxml=""
for k in "${KEYS[@]}"; do
  [ -n "${!k:-}" ] && envxml+="    <key>$k</key><string>$(xml "${!k}")</string>"$'\n'
done

tmpplist="$(mktemp)"
cat > "$tmpplist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$bin</string></array>
  <key>UserName</key><string>$USER_NAME</string>
  <key>EnvironmentVariables</key>
  <dict>
$envxml  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>Nice</key><integer>19</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$DIR/agent.log</string>
  <key>StandardErrorPath</key><string>$DIR/agent.log</string>
</dict>
</plist>
PLIST
plutil -lint "$tmpplist" >/dev/null || die "generated plist is invalid"

say "installing LaunchDaemon (sudo)"
sudo launchctl bootout "system/$LABEL" 2>/dev/null || true
sudo install -m 0600 -o root -g wheel "$tmpplist" "$PLIST"
rm -f "$tmpplist"
sudo launchctl bootstrap system "$PLIST" 2>/dev/null || sudo launchctl load -w "$PLIST"
sudo launchctl enable "system/$LABEL" 2>/dev/null || true
say "installed $("$bin" --version) as '$NAME' -> $SERVER (starts at boot)"
say "logs: tail -f $DIR/agent.log"
