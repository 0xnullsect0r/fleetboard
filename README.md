# FLEETBOARD

Self-hosted telemetry console for a small mining fleet: XMRig (Monero, CPU) and
SRBMiner (Xelis, GPU). An agent on each rig reads the local miner APIs and
wallet RPCs and pushes them over an outbound WebSocket. Rigs need no inbound
ports, so NAT and CGNAT are fine. The server shows live per-coin hashrate,
projected earnings, wallet balances and history behind a single-user login.

```
 rig (agent) ──ws:// :8080/ws/agent──┐
 rig (agent) ────────────────────────┤        ┌──────────── server (docker compose) ────────────┐
 rig (agent) ────────────────────────┼──────▶ │ caddy ─/ws/*─▶ collector ──▶ postgres            │
                                     │        │   └────/*─────▶ web (Next.js) ──▶ postgres        │
 you ──https:// (Tailscale)──────────┘        │ updater (pulls new GHCR releases)                 │
                                              │ [profile wallets] xmr-wallet, xel-wallet          │
                                              └───────────────────────────────────────────────────┘
```

| Path | What it is |
| --- | --- |
| `apps/collector` | Fastify WebSocket hub: agent ingest, live snapshots, price/difficulty loop, DB writes, migrations |
| `apps/web` | Next.js console: live view, history charts, login and first-run |
| `packages/shared` | zod schemas and types, coin registry, earnings formula, wallet RPC client |
| `packages/agent` | Rig agent, compiled with `bun build --compile` into single-file binaries |
| `infra/` | Dockerfiles, release compose template, agent and wallet installers |

## Deploy the server

On the server, which should be on your tailnet:

```sh
mkdir fleetboard && cd fleetboard
curl -fsSLO https://github.com/0xnullsect0r/fleetboard/releases/latest/download/docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/0xnullsect0r/fleetboard/main/.env.example -o .env
# edit .env: TOKEN, JWT_SECRET, POSTGRES_PASSWORD (openssl rand -hex 32 each),
#            BIND_ADDR=<server's Tailscale IP>, CADDY_SITE_ADDRESS
docker compose up -d
```

Two things to do before anything else:

1. **Images.** Make the GHCR packages public (GitHub → Packages → fleetboard-web /
   fleetboard-collector → Package settings → Change visibility), or run
   `docker login ghcr.io` on the server first.
2. **First login.** Open `https://<CADDY_SITE_ADDRESS>` and sign in as
   `Admin@example.com` / `Admin`. You are forced to set your own email and a
   password of at least 10 characters. Until you do, whoever reaches the page
   first can claim the account, so keep `BIND_ADDR` on the Tailscale IP. Never
   use `0.0.0.0` before this step.

### TLS

Caddy issues the certificate for `CADDY_SITE_ADDRESS`:

- `localhost` or an IP: Caddy's internal CA. The browser warns once.
- A public DNS name pointing at the server: Let's Encrypt, which needs ports 80 and 443 reachable.
- A `*.ts.net` MagicDNS name: enable HTTPS in the Tailscale admin console, then mount
  tailscaled's socket into the caddy service
  (`- /var/run/tailscale/tailscaled.sock:/var/run/tailscale/tailscaled.sock`) so Caddy can
  fetch the Tailscale certificate.

The `Secure` session cookie needs HTTPS, so always use the `https://` URL.

### Behind your own reverse proxy

If another proxy (Nginx Proxy Manager, Traefik, a host-level Caddy) already
terminates TLS, turn the bundled Caddy into a plain HTTP backend:

```
CADDY_SITE_ADDRESS=:80     # plain HTTP, any hostname, no certificates
HTTP_PORT=8088             # any free host port if your proxy owns 80/443
BIND_ADDR=127.0.0.1        # or the LAN/Tailscale IP your proxy reaches it on
```

Point the proxy at `http://<BIND_ADDR>:<HTTP_PORT>` with WebSocket support
enabled. It must pass `Upgrade`/`Connection` and keep the `Host` header. The
console needs `/ws/ui` and agents can use `/ws/agent` through it. Serve it
over HTTPS, because the session cookie is `Secure`. No idle-timeout tuning is
needed, since live updates flow every 3 seconds. Agents can then use
`SERVER=wss://<your-domain>/ws/agent` instead of the plain `:8080` port. If
the proxy is public, finish the first-login credential change before opening it.

### Automatic updates

The release `docker-compose.yml` runs web and collector at `FLEETBOARD_TAG`
(default `latest`). The `updater` service checks GHCR every `UPDATE_INTERVAL`
seconds (default 600). When a new release is pushed, it pulls the new images and
recreates only web and collector. Database migrations run when the collector
boots. db, caddy and the wallets are never touched.

To pin a version, set `FLEETBOARD_TAG=v0.2.0` in `.env` and run `docker compose up -d`.
The updater uses the official `docker:27-cli` image and needs the Docker socket.
Watchtower was archived in December 2025, so no third-party updater gets that access.

## Enroll the fleet

The same command works on every machine. Only `NAME` changes. `SERVER` is the
server's Tailscale IP on the plain agent port 8080, and `TOKEN` is the `TOKEN`
from the server's `.env`.

```sh
curl -fsSL https://github.com/0xnullsect0r/fleetboard/releases/latest/download/install.sh \
  | SERVER=ws://100.x.y.z:8080/ws/agent TOKEN=<TOKEN> NAME=<name> bash
```

| Host | NAME | Notes |
| --- | --- | --- |
| Garuda PC | `garuda-pc` | Finds XMRig and SRBMiner and reports XMR + XEL. Can also host the wallets (below) |
| Garuda laptop | `garuda-laptop` | XMR + XEL |
| Apple Silicon Mac | `mac-m` | LaunchDaemon; asks for sudo once |
| Intel Mac | `mac-intel` | LaunchDaemon; asks for sudo once |
| Proxmox host | `proxmox` | Runs as root already |
| Debian VMs | `debian-vm1` … `debian-vm4` | |

How the agent behaves:

- **Starts at boot:** a systemd unit enabled for `multi-user.target` on Linux, a LaunchDaemon on macOS.
- **Only talks while something is running.** It polls `127.0.0.1` miner APIs and
  wallet RPCs and opens the WebSocket only when at least one answers. When a rig
  stops mining (gaming, powered down, `systemctl stop`), the agent sends one final
  empty report. The console then shows that rig's miners as **OFF** (gray), not
  **DOWN** (red). DOWN means an agent went silent without saying goodbye: a crash,
  a network loss, or a pulled plug.
- **Reads localhost only.** Non-loopback API URLs are refused. Nothing listens on the rig.

Optional agent settings (pass them alongside `SERVER`, or edit them later):

- `XMRIG_API` (default `http://127.0.0.1:18088/2/summary`)
- `XMRIG_TOKEN`, if the XMRig HTTP API has an access token
- `SRBMINER_API` (default `http://127.0.0.1:21550`)
- `INTERVAL` (seconds, default 5)

Settings live in `/etc/fleet-agent.env` on Linux and the plist on macOS.
Re-running the installer upgrades the binary and keeps the existing settings.

Checking on the agent:

- Linux: `systemctl status fleet-agent`, `journalctl -u fleet-agent -f`
- macOS: `sudo launchctl print system/com.fleetboard.agent`, `tail -f ~/.fleet-agent/agent.log`
- Remove: pipe the installer the same way with `--uninstall`

XMRig's HTTP API must be enabled (`"http": {"enabled": true, "host": "127.0.0.1", "port": 18088}`),
and SRBMiner's API must be on (`--api-enable --api-port 21550`).

## Wallet balances

Balances come from wallet RPCs on one of your machines, never from keys on the
dashboard. Each wallet report carries the public address, so the same wallet
seen from two places is counted once and shown as "via garuda-pc, server".

**Never paste a seed or recovery phrase into a chat, a ticket or this repo.**
Type it only into the setup prompts below, on the machine that will hold it.

### On the Garuda PC

```sh
sudo bash infra/wallets/setup-wallets.sh xmr xel
```

- **XMR:** a view-only wallet built from your primary address and secret view key. It
  can see incoming funds but cannot spend. The Monero CLI is checked against
  binaryfate's signed hash list (with `gpg` installed) and SHA-256.
- **XEL:** Xelis has no view-only mode, so the setup asks for your Genesix recovery
  phrase and creates a headless `xelis_wallet` holding the full key, encrypted
  with a password you choose. That makes it a hot wallet: anyone with root on
  this PC can spend it. The phrase is visible in the process list for the few
  seconds the restore runs.
- Both run as the unprivileged `fleet-wallet` user, start at boot, listen on
  `127.0.0.1` only, and are wired into `/etc/fleet-agent.env`. The PC's agent then
  reports balances even while the miners are off.

### On the server as well (optional)

The release compose has a `wallets` profile with `xmr-wallet` and `xel-wallet`.
They share a network only with the collector; web and Caddy cannot reach them.

1. Set the following in `.env`:

   ```
   XMR_WALLET_PASSWORD=...
   XMR_RESTORE_HEIGHT=...
   XEL_WALLET_PASSWORD=...
   XEL_WALLET_RPC_PASS=...
   XMR_WALLET_RPC=http://xmr-wallet:18083/json_rpc
   XEL_WALLET_RPC=http://xel-wallet:8081/json_rpc
   ```

2. Restore each wallet once, then start the stack with the profile:

   ```sh
   docker compose --profile wallets run --rm xmr-wallet restore
   docker compose --profile wallets run --rm xel-wallet restore
   docker compose --profile wallets up -d
   ```

> The XEL wallet on the server holds your spend key, and its password sits in
> the server's `.env`. Root on the dashboard host, or a leak of `.env` plus the
> volume, means the XEL funds can be taken. Running it only on the PC keeps the
> key off the web-facing box. The XMR wallet is view-only everywhere.

## Develop

Requires Node 22+ and pnpm 12 (`corepack enable`, or the standalone pnpm binary).

```sh
pnpm install
cp .env.example .env    # set TOKEN, JWT_SECRET; for local dev also:
# DATABASE_URL=postgres://fleetboard:devpass@localhost:55432/fleetboard
docker run -d --name fleetboard-devdb -e POSTGRES_USER=fleetboard -e POSTGRES_PASSWORD=devpass \
  -e POSTGRES_DB=fleetboard -p 127.0.0.1:55432:5432 postgres:16
pnpm dev                                         # collector :4000, web :3000
pnpm --filter @fleetboard/collector fake-agent -- --wallets --idle garuda-laptop
pnpm test                                        # unit + integration tests
TEST_DATABASE_URL=postgres://...:55432/fleetboard_test pnpm --filter @fleetboard/collector test
```

- `fake-agent` simulates the whole fleet, including an idle rig and wallets.
- `pnpm --filter @fleetboard/agent mock-miners` serves fake XMRig and SRBMiner APIs for the real agent.
- `pnpm --filter @fleetboard/agent compile` builds the four agent binaries into `packages/agent/bin`.
- `docker compose up -d --build` builds and runs the stack from this checkout.

## Release

Push a tag and `.github/workflows/release.yml` does the rest:

```sh
git tag v0.1.0 && git push origin v0.1.0
```

It builds multi-arch (amd64 and arm64) images to
`ghcr.io/0xnullsect0r/fleetboard-{web,collector,wallet-xmr,wallet-xel}`, tagged
`:<tag>` and `:latest`. It compiles the four agent binaries, then cuts a GitHub
Release with the rendered `docker-compose.yml`, the binaries, and the three agent
installers plus the wallet setup script. Servers on `latest` pick up the release
on the updater's next check.

## Earnings math

For each coin:

- `coin/day = fleet_60s_hashrate × 86400 / (difficulty × hashesPerDiff) × block_reward`
- `usd/day = coin/day × price`; a week is ×7 and a month is ×30.

Inputs and sources:

- **Hashrate:** only miners currently UP are counted.
- **XMR:** difficulty comes from `get_info` on `DIFF_NODE`; the reward is a fixed 0.6 (tail emission).
- **XEL:** difficulty and reward come from `get_info` on `XEL_NODE`.
- **Prices:** CoinGecko.

These are expected values at the current difficulty. Pool fees and luck are not
modeled, and P2Pool and Kryptex payouts will differ day to day.

## Adding a coin or miner

Sources and coins are a registry (`packages/shared/src/coins.ts`), and the
database stores them as plain text, so new ones need no schema change.
`hashesPerDiff` covers Bitcoin-style difficulty (2³²), so a pair of SHA-256
ASICs can be added later. The work involved:

- an `asic` source the agent polls on the LAN through an explicit allowlist
  (cgminer API on :4028 or AxeOS HTTP)
- a BTC network fetcher
- a watch-only BTC balance by address or xpub, which needs no keys
