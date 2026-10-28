#!/usr/bin/env bash
# xmr-wallet container: "restore" creates the view-only wallet interactively,
# "run" (default) serves monero-wallet-rpc on :18083 for the collector.
set -euo pipefail
: "${WALLET_PASSWORD:?set XMR_WALLET_PASSWORD in .env}"
NODE="${XMR_NODE:-xmr.support:18081}"

case "${1:-run}" in
  restore)
    [ -f /data/view.keys ] && { echo "a wallet already exists in the volume; remove it first to restore again"; exit 1; }
    echo "Creating a VIEW-ONLY wallet: enter your primary address and SECRET VIEW key (never the spend key)."
    echo "When the [wallet ...] prompt appears and refresh finishes, type: exit"
    exec monero-wallet-cli --generate-from-view-key /data/view --password "$WALLET_PASSWORD" \
      --daemon-address "$NODE" --restore-height "${RESTORE_HEIGHT:-0}" --log-file /data/cli.log \
      --use-english-language-names
    ;;
  run)
    if [ ! -f /data/view.keys ]; then
      echo "no wallet yet. Run once:  docker compose --profile wallets run --rm xmr-wallet restore"
      exec sleep infinity
    fi
    exec monero-wallet-rpc --wallet-file /data/view --password "$WALLET_PASSWORD" --daemon-address "$NODE" \
      --rpc-bind-ip 0.0.0.0 --confirm-external-bind --rpc-bind-port 18083 --disable-rpc-login \
      --non-interactive --log-file /data/rpc.log --max-log-files 2
    ;;
  *) exec "$@" ;;
esac
