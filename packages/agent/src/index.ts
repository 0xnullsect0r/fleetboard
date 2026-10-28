import { Agent } from "./agent.js";
import { loadConfig } from "./config.js";
import { log } from "./log.js";

declare const AGENT_VERSION: string;
const version = typeof AGENT_VERSION === "string" ? AGENT_VERSION : "dev";

if (process.argv.includes("--version")) {
  console.log(version);
  process.exit(0);
}

let agent: Agent;
try {
  agent = Agent.live(loadConfig());
} catch (e) {
  console.error(`fleet-agent: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
}

log(`fleet-agent ${version}`);
agent.start();

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    log(`${sig}: reporting off and exiting`);
    void agent.stop().then(() => process.exit(0));
  });
}
