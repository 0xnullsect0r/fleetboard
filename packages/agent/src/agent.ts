import { readWallets, type AgentMessage, type MinerReport, type WalletReport } from "@fleetboard/shared";
import type { AgentConfig } from "./config.js";
import { log } from "./log.js";
import { readMiners } from "./miners.js";

const MAX_BACKOFF_MS = 60_000;
/** After a token rejection, retry rarely: the collector's TOKEN must change first. */
const BAD_TOKEN_BACKOFF_MS = 5 * 60_000;

export interface AgentDeps {
  readMiners: () => Promise<MinerReport[]>;
  readWallets: () => Promise<WalletReport[]>;
  connect: (url: string) => WebSocket;
  now: () => number;
}

/**
 * The agent stays silent (localhost polling only) until a miner or wallet
 * answers. Then it opens one outbound WebSocket and pushes a report every
 * cycle. When everything stops answering it sends one empty report, so the
 * dashboard shows the rig as OFF rather than DOWN, and closes the socket.
 */
export class Agent {
  private ws: WebSocket | null = null;
  private active = false;
  private backoff = 1000;
  private retryAt = 0;
  private wallets: WalletReport[] = [];
  private walletsReadAt = -Infinity;
  private last: AgentMessage | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  constructor(
    private readonly cfg: AgentConfig,
    private readonly deps: AgentDeps,
  ) {}

  static live(cfg: AgentConfig): Agent {
    return new Agent(cfg, {
      readMiners: () => readMiners(cfg),
      readWallets: () => readWallets(cfg.wallets),
      connect: (url) => new WebSocket(url),
      now: () => Date.now(),
    });
  }

  start(): void {
    log(`agent "${this.cfg.name}" -> ${this.cfg.server} every ${this.cfg.interval}s` +
      (this.cfg.wallets.length ? `, wallets: ${this.cfg.wallets.map((w) => w.coin).join("+")}` : ""));
    void this.tick();
  }

  /** One cycle; exposed for tests. */
  async cycle(): Promise<void> {
    const now = this.deps.now();
    const miners = await this.deps.readMiners();
    if (this.cfg.wallets.length && now - this.walletsReadAt >= this.cfg.walletInterval * 1000) {
      this.wallets = await this.deps.readWallets();
      this.walletsReadAt = now;
    }

    const msg: AgentMessage = {
      token: this.cfg.token,
      name: this.cfg.name,
      ts: now,
      miners,
      ...(this.wallets.length ? { wallets: this.wallets } : {}),
    };
    const hasWork = miners.length > 0 || this.wallets.length > 0;

    if (hasWork) {
      if (!this.active) log(`activity: ${describe(msg)}; reporting`);
      this.active = true;
      this.last = msg;
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
      else this.ensureSocket(now);
    } else if (this.active) {
      log("no miner or wallet answering; going idle");
      this.active = false;
      this.goodbye();
    }
  }

  private ensureSocket(now: number): void {
    if (this.ws || now < this.retryAt) return;
    const ws = this.deps.connect(this.cfg.server);
    this.ws = ws;
    ws.onopen = () => {
      log("connected");
      this.backoff = 1000;
      if (this.last) ws.send(JSON.stringify(this.last));
    };
    ws.onclose = (ev) => {
      if (this.ws === ws) this.ws = null;
      if (!this.active || this.stopped) return;
      let delay = this.backoff + Math.random() * 1000;
      if (ev.code === 4001) {
        log("collector rejected TOKEN (4001); check /etc/fleet-agent.env");
        delay = BAD_TOKEN_BACKOFF_MS;
      } else {
        log(`disconnected (${ev.code}${ev.reason ? ` ${ev.reason}` : ""}); retry in ${Math.round(delay / 1000)}s`);
        this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
      }
      this.retryAt = this.deps.now() + delay;
    };
    ws.onerror = () => {};
  }

  /** Empty report (rig is OFF, not DOWN) then close. */
  private goodbye(): void {
    const ws = this.ws;
    this.ws = null;
    this.last = null;
    if (!ws) return;
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ token: this.cfg.token, name: this.cfg.name, ts: this.deps.now(), miners: [] } satisfies AgentMessage));
      ws.close(1000, "idle");
    } else {
      ws.close();
    }
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    try {
      await this.cycle();
    } catch (e) {
      log(`cycle failed: ${String(e)}`);
    }
    this.timer = setTimeout(() => void this.tick(), this.cfg.interval * 1000);
  }

  /** Graceful stop (SIGTERM on shutdown or service stop): the rig shows OFF. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.active = false;
    this.goodbye();
    await new Promise((r) => setTimeout(r, 300));
  }
}

function describe(msg: AgentMessage): string {
  const parts = msg.miners.map((m) => `${m.source}(${m.coin})`);
  if (msg.wallets?.length) parts.push(`wallets(${msg.wallets.map((w) => w.coin).join("+")})`);
  return parts.join(", ");
}
