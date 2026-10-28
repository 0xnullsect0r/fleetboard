#!/usr/bin/env bash
# xel-wallet container: "restore" rebuilds the wallet from its recovery phrase
# (typed here, hidden, used once), "run" (default) serves the wallet RPC on :8081.
set -euo pipefail
: "${WALLET_PASSWORD:?set XEL_WALLET_PASSWORD in .env}"
: "${RPC_PASSWORD:?set XEL_WALLET_RPC_PASS in .env}"
DAEMON="${XEL_DAEMON:-https://node.xelis.io}"
L1="${XEL_TABLES_L1:-26}"
common=(--precomputed-tables-path /data/tables --precomputed-tables-l1 "$L1" --logs-path /data/logs/
  --disable-interactive-mode --disable-ascii-art --daemon-address "$DAEMON")
mkdir -p /data/tables /data/logs

case "${1:-run}" in
  restore)
    [ -e /data/wallet ] && { echo "a wallet already exists in the volume; remove it first to restore again"; exit 1; }
    [ -t 0 ] || { echo "run with a terminal: docker compose --profile wallets run --rm xel-wallet restore"; exit 1; }
    echo "This wallet will hold your full Xelis key, encrypted with XEL_WALLET_PASSWORD."
    read -rsp "Recovery phrase (hidden): " seed; echo
    [ "$(wc -w <<<"$seed")" -ge 24 ] || { echo "that does not look like a full recovery phrase"; exit 1; }
    xelis_wallet --wallet-path /data/wallet --password "$WALLET_PASSWORD" --seed "$seed" "${common[@]}" &
    pid=$!
    unset seed
    echo "Creating wallet (first run builds ~330 MB of decryption tables; this can take minutes)..."
    for _ in $(seq 1 900); do
      [ -e /data/wallet ] && sleep 5 && break
      kill -0 "$pid" 2>/dev/null || break
      sleep 1
    done
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
    if [ ! -e /data/wallet ]; then
      echo "restore failed; see /data/logs"
      exit 1
    fi
    echo "Wallet created. Start it: docker compose --profile wallets up -d"
    ;;
  run)
    if [ ! -e /data/wallet ]; then
      echo "no wallet yet. Run once:  docker compose --profile wallets run --rm xel-wallet restore"
      exec sleep infinity
    fi
    exec xelis_wallet --wallet-path /data/wallet --password "$WALLET_PASSWORD" \
      --rpc-bind-address 0.0.0.0:8081 --rpc-username fleet --rpc-password "$RPC_PASSWORD" "${common[@]}"
    ;;
  *) exec "$@" ;;
esac
