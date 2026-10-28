#!/usr/bin/env bash
# FLEETBOARD wallet services for a Linux/systemd host (e.g. the Garuda PC).
#
#   sudo bash setup-wallets.sh xmr        # Monero view-only wallet -> 127.0.0.1:18083
#   sudo bash setup-wallets.sh xel        # Xelis wallet (restored from your seed) -> 127.0.0.1:8081
#   sudo bash setup-wallets.sh xmr xel    # both
#   sudo bash setup-wallets.sh --uninstall
#
# Each wallet runs as the unprivileged "fleet-wallet" user, starts at boot, and
# listens on loopback only. The fleet-agent on this host is pointed at them and
# reports balances (the agent connects while any miner OR wallet answers).
#
# Secrets are typed into this terminal only. The Monero wallet is view-only (it
# can see incoming funds but cannot spend). Xelis has no view-only mode, so the
# Xelis wallet holds your full spend key, encrypted with the password you choose.
#
# Env: XMR_NODE (default xmr.support:18081), XMR_RESTORE_HEIGHT (block height to
# scan from; default asks), XEL_DAEMON (default https://node.xelis.io),
# XEL_VERSION (default v1.25.0), XEL_TABLES_L1 (precomputed table size, default 26).
set -euo pipefail

XMR_NODE="${XMR_NODE:-xmr.support:18081}"
XEL_DAEMON="${XEL_DAEMON:-https://node.xelis.io}"
XEL_VERSION="${XEL_VERSION:-v1.25.0}"
XEL_TABLES_L1="${XEL_TABLES_L1:-26}"
BINARYFATE_FPR="81AC591FE9C4B65C5806AFC3F0AF4D462A0BDF92"

OPT=/opt/fleet-wallets
DATA=/var/lib/fleet-wallets
ETC=/etc/fleet-wallets
AGENT_ENV=/etc/fleet-agent.env
SVC_USER=fleet-wallet

say() { printf '\nfleet-wallets: %s\n' "$*"; }
die() { printf 'fleet-wallets: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run with sudo"
command -v systemctl >/dev/null || die "systemd required"
[ -t 0 ] || die "run this in an interactive terminal (it asks for your wallet details)"
for t in curl tar sha256sum; do command -v "$t" >/dev/null || die "missing $t"; done

set_agent_env() { # key value: upsert into the agent's env file
  touch "$AGENT_ENV"; chmod 0600 "$AGENT_ENV"
  sed -i "/^$1=/d" "$AGENT_ENV"
  printf '%s=%s\n' "$1" "$2" >> "$AGENT_ENV"
}

ask_secret() { # prompt var: read twice without echo
  local a b
  while :; do
    read -rsp "$1: " a; echo
    read -rsp "Repeat: " b; echo
    [ "$a" = "$b" ] && [ -n "$a" ] && break
    echo "Entries differ or are empty, try again."
  done
  printf -v "$2" '%s' "$a"
}

ensure_user() {
  id "$SVC_USER" >/dev/null 2>&1 || useradd --system --home-dir "$DATA" --shell /usr/bin/false "$SVC_USER"
  install -d -m 0750 -o "$SVC_USER" -g "$SVC_USER" "$DATA"
  install -d -m 0750 -o root -g "$SVC_USER" "$ETC"
}

restart_agent() {
  if systemctl list-unit-files fleet-agent.service >/dev/null 2>&1; then
    systemctl restart fleet-agent.service && say "fleet-agent restarted; balances appear within a minute"
  else
    say "fleet-agent is not installed yet; install it (install.sh) and it will pick up $AGENT_ENV"
  fi
}

if [ "${1:-}" = "--uninstall" ]; then
  systemctl disable --now fleet-xmr-wallet.service fleet-xel-wallet.service 2>/dev/null || true
  rm -f /etc/systemd/system/fleet-xmr-wallet.service /etc/systemd/system/fleet-xel-wallet.service
  systemctl daemon-reload
  [ -f "$AGENT_ENV" ] && sed -i '/^XMR_WALLET_RPC=/d;/^XEL_WALLET_RPC=/d;/^XEL_WALLET_USER=/d;/^XEL_WALLET_PASS=/d' "$AGENT_ENV"
  rm -rf "$OPT" "$ETC"
  say "services removed. Wallet files are kept in $DATA; delete them yourself if you are sure."
  exit 0
fi

[ $# -gt 0 ] || die "choose wallets: xmr, xel, or both (see header)"
arch="$(uname -m)"

# ---------------------------------------------------------------- Monero
setup_xmr() {
  case "$arch" in x86_64) mfile_arch=x64 ;; aarch64) mfile_arch=armv8 ;; *) die "no Monero CLI build for $arch" ;; esac
  local tmp; tmp="$(mktemp -d)"
  say "Monero: fetching signed hash list"
  curl -fsSL https://www.getmonero.org/downloads/hashes.txt -o "$tmp/hashes.txt"
  if command -v gpg >/dev/null; then
    export GNUPGHOME="$tmp/gnupg"; install -d -m 0700 "$GNUPGHOME"
    curl -fsSL https://raw.githubusercontent.com/monero-project/monero/master/utils/gpg_keys/binaryfate.asc -o "$tmp/binaryfate.asc"
    gpg -q --import "$tmp/binaryfate.asc" 2>/dev/null
    gpg --status-fd 1 --verify "$tmp/hashes.txt" 2>/dev/null | grep -q "VALIDSIG $BINARYFATE_FPR" \
      || die "hashes.txt signature is not binaryfate's ($BINARYFATE_FPR); aborting"
    say "Monero: hashes.txt signature verified (binaryfate)"
  else
    say "Monero: gpg not installed, verifying SHA-256 against hashes.txt over HTTPS only"
  fi
  local line file sum
  line="$(grep -E " monero-linux-${mfile_arch}-v[0-9.]+\.tar\.bz2$" "$tmp/hashes.txt" | head -1)"
  [ -n "$line" ] || die "no linux-${mfile_arch} entry in hashes.txt"
  sum="${line%% *}"; file="${line##* }"
  say "Monero: downloading $file"
  curl -fSL --retry 3 "https://downloads.getmonero.org/cli/$file" -o "$tmp/$file"
  echo "$sum  $tmp/$file" | sha256sum -c --quiet - || die "checksum mismatch for $file"
  install -d "$OPT/monero"
  tar -xjf "$tmp/$file" -C "$tmp"
  install -m 0755 "$tmp"/monero-*/monero-wallet-cli "$tmp"/monero-*/monero-wallet-rpc "$OPT/monero/"
  rm -rf "$tmp"

  install -d -m 0700 -o "$SVC_USER" -g "$SVC_USER" "$DATA/xmr"
  if [ ! -f "$DATA/xmr/view.keys" ]; then
    say "Monero: creating a VIEW-ONLY wallet. You need your primary address (starts with 4)
and your SECRET VIEW key (Feather/GUI: Wallet > Keys; CLI: viewkey). Never the spend key or seed."
    local pw
    ask_secret "Choose a password to encrypt the view-only wallet file" pw
    install -m 0640 -o root -g "$SVC_USER" /dev/null "$ETC/xmr.pass"
    printf '%s' "$pw" > "$ETC/xmr.pass"; unset pw
    local height="${XMR_RESTORE_HEIGHT:-}"
    if [ -z "$height" ]; then
      read -rp "Restore height (block height before the wallet's first payout; Enter = scan from 0, slow): " height
    fi
    say "Monero: monero-wallet-cli will ask for the address and view key. When it shows its
'[wallet 4...]:' prompt and finishes refreshing, type: exit"
    sudo -u "$SVC_USER" "$OPT/monero/monero-wallet-cli" \
      --generate-from-view-key "$DATA/xmr/view" --password-file "$ETC/xmr.pass" \
      --daemon-address "$XMR_NODE" --restore-height "${height:-0}" \
      --log-file "$DATA/xmr/cli.log" --use-english-language-names
    [ -f "$DATA/xmr/view.keys" ] || die "view-only wallet was not created"
  fi

  cat > /etc/systemd/system/fleet-xmr-wallet.service <<UNIT
[Unit]
Description=FLEETBOARD Monero view-only wallet RPC (127.0.0.1:18083)
Wants=network-online.target
After=network-online.target

[Service]
User=$SVC_USER
ExecStart=$OPT/monero/monero-wallet-rpc --wallet-file $DATA/xmr/view --password-file $ETC/xmr.pass --daemon-address $XMR_NODE --rpc-bind-ip 127.0.0.1 --rpc-bind-port 18083 --disable-rpc-login --restricted-rpc --non-interactive --log-file $DATA/xmr/rpc.log --max-log-files 2
Restart=always
RestartSec=15
Nice=10
ProtectSystem=strict
ReadWritePaths=$DATA/xmr
ProtectHome=yes
PrivateTmp=yes
NoNewPrivileges=yes

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable --now fleet-xmr-wallet.service
  set_agent_env XMR_WALLET_RPC http://127.0.0.1:18083/json_rpc
  say "Monero: fleet-xmr-wallet running (view-only)"
}

# ---------------------------------------------------------------- Xelis
setup_xel() {
  case "$arch" in x86_64) triple=x86_64-unknown-linux-gnu ;; aarch64) triple=aarch64-unknown-linux-gnu ;; *) die "no Xelis build for $arch" ;; esac
  local tmp base; tmp="$(mktemp -d)"
  base="https://github.com/xelis-project/xelis-blockchain/releases/download/$XEL_VERSION"
  say "Xelis: downloading $XEL_VERSION ($triple)"
  curl -fsSL "$base/checksums.txt" -o "$tmp/checksums.txt"
  curl -fSL --retry 3 "$base/$triple.tar.gz" -o "$tmp/$triple.tar.gz"
  (cd "$tmp" && grep " $triple.tar.gz\$" checksums.txt | sha256sum -c --quiet -) || die "checksum mismatch for $triple.tar.gz"
  tar -xzf "$tmp/$triple.tar.gz" -C "$tmp"
  install -d "$OPT/xelis"
  install -m 0755 "$tmp/$triple/xelis_wallet" "$OPT/xelis/"
  rm -rf "$tmp"

  install -d -m 0700 -o "$SVC_USER" -g "$SVC_USER" "$DATA/xel" "$DATA/xel/tables" "$DATA/xel/logs"
  if [ ! -e "$DATA/xel/wallet" ]; then
    say "Xelis: restoring your Genesix wallet from its recovery phrase (Genesix: Settings >
Recovery phrase). It is typed here, used once to create the local wallet, and not stored.
This wallet holds the full key; anyone with root on this machine plus the password can spend."
    local pw seed
    ask_secret "Choose a password to encrypt the Xelis wallet" pw
    read -rsp "Recovery phrase (25 words, hidden): " seed; echo
    [ "$(wc -w <<<"$seed")" -ge 24 ] || die "that does not look like a full recovery phrase"
    local rpcpass; rpcpass="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    install -m 0640 -o root -g "$SVC_USER" /dev/null "$ETC/xel.env"
    printf 'XEL_WALLET_PASSWORD=%s\nXEL_RPC_PASSWORD=%s\n' "$pw" "$rpcpass" > "$ETC/xel.env"
    say "Xelis: creating the wallet (first run also builds ~330 MB of decryption tables; can take minutes)"
    sudo -u "$SVC_USER" sh -c 'cd "$1" && exec "$2" --wallet-path "$1/wallet" --password "$3" --seed "$4" \
      --daemon-address "$5" --precomputed-tables-path "$1/tables/" --precomputed-tables-l1 "$6" \
      --logs-path "$1/logs/" --disable-interactive-mode --disable-ascii-art' _ \
      "$DATA/xel" "$OPT/xelis/xelis_wallet" "$pw" "$seed" "$XEL_DAEMON" "$XEL_TABLES_L1" &
    local restore_pid=$!
    unset seed pw
    for _ in $(seq 1 600); do
      [ -e "$DATA/xel/wallet" ] && sleep 5 && break
      kill -0 "$restore_pid" 2>/dev/null || break
      sleep 1
    done
    kill "$restore_pid" 2>/dev/null || true
    wait "$restore_pid" 2>/dev/null || true
    [ -e "$DATA/xel/wallet" ] || die "Xelis wallet was not created; see $DATA/xel/logs"
  fi
  # shellcheck disable=SC1091
  rpcpass="$(. "$ETC/xel.env" && printf '%s' "$XEL_RPC_PASSWORD")"

  cat > /etc/systemd/system/fleet-xel-wallet.service <<UNIT
[Unit]
Description=FLEETBOARD Xelis wallet RPC (127.0.0.1:8081)
Wants=network-online.target
After=network-online.target

[Service]
User=$SVC_USER
EnvironmentFile=$ETC/xel.env
WorkingDirectory=$DATA/xel
ExecStart=$OPT/xelis/xelis_wallet --wallet-path $DATA/xel/wallet --password \${XEL_WALLET_PASSWORD} --daemon-address $XEL_DAEMON --rpc-bind-address 127.0.0.1:8081 --rpc-username fleet --rpc-password \${XEL_RPC_PASSWORD} --precomputed-tables-path $DATA/xel/tables/ --precomputed-tables-l1 $XEL_TABLES_L1 --logs-path $DATA/xel/logs/ --disable-interactive-mode --disable-ascii-art
Restart=always
RestartSec=15
Nice=10
ProtectSystem=strict
ReadWritePaths=$DATA/xel
ProtectHome=yes
PrivateTmp=yes
NoNewPrivileges=yes

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable --now fleet-xel-wallet.service
  set_agent_env XEL_WALLET_RPC http://127.0.0.1:8081/json_rpc
  set_agent_env XEL_WALLET_USER fleet
  set_agent_env XEL_WALLET_PASS "$rpcpass"
  say "Xelis: fleet-xel-wallet running"
}

ensure_user
for w in "$@"; do
  case "$w" in
    xmr) setup_xmr ;;
    xel) setup_xel ;;
    *) die "unknown wallet '$w' (use xmr and/or xel)" ;;
  esac
done
restart_agent
say "status: systemctl status fleet-xmr-wallet fleet-xel-wallet"
