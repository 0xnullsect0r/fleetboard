#!/usr/bin/env bash
# xmr-wallet container:
#   restore       view-only wallet from your address + secret view key (cannot spend)
#   restore-seed  full wallet from your 25-word mnemonic (holds the spend key)
#   run (default) monero-wallet-rpc on :18083 for the collector, restricted to
#                 read-only calls, so no transfer can be made through it.
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
  restore-seed)
    [ -f /data/view.keys ] && { echo "a wallet already exists in the volume; remove it first to restore again"; exit 1; }
    echo "Restoring from your 25-word mnemonic. This wallet will hold your full Monero key,"
    echo "encrypted with XMR_WALLET_PASSWORD. Paste the 25 words when asked for the seed; press"
    echo "Enter at the seed offset passphrase prompt unless you set one. When the [wallet ...]"
    echo "prompt appears and the refresh finishes, type: exit"
    exec monero-wallet-cli --restore-deterministic-wallet --generate-new-wallet /data/view \
      --password "$WALLET_PASSWORD" --daemon-address "$NODE" --restore-height "${RESTORE_HEIGHT:-0}" \
      --log-file /data/cli.log --use-english-language-names
    ;;
  run)
    if [ ! -f /data/view.keys ]; then
      echo "no wallet yet. Run once:  docker compose run --rm xmr-wallet restore   (or restore-seed)"
      exec sleep infinity
    fi
    exec monero-wallet-rpc --wallet-file /data/view --password "$WALLET_PASSWORD" --daemon-address "$NODE" \
      --rpc-bind-ip 0.0.0.0 --confirm-external-bind --rpc-bind-port 18083 --disable-rpc-login --restricted-rpc \
      --non-interactive --log-file /data/rpc.log --max-log-files 2
    ;;
  *) exec "$@" ;;
esac
