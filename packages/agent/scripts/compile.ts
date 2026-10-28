/**
 * Compile single-file agent binaries with `bun build --compile`.
 *   bun scripts/compile.ts                 # all four release targets
 *   bun scripts/compile.ts linux-x64       # just one
 * AGENT_VERSION (e.g. v1.2.3) is baked in; defaults to "dev".
 */
const TARGETS = ["linux-x64", "linux-arm64", "darwin-arm64", "darwin-x64"] as const;

const wanted = process.argv.slice(2);
const targets = wanted.length ? TARGETS.filter((t) => wanted.includes(t)) : TARGETS;
if (!targets.length) {
  console.error(`unknown target; choose from ${TARGETS.join(", ")}`);
  process.exit(2);
}
const version = process.env.AGENT_VERSION ?? "dev";

for (const t of targets) {
  const out = `bin/fleet-agent-${t}`;
  const proc = Bun.spawnSync(
    [process.execPath, "build", "--compile", "--minify", `--target=bun-${t}`, `--define`, `AGENT_VERSION=${JSON.stringify(version)}`, "src/index.ts", "--outfile", out],
    { stdout: "inherit", stderr: "inherit" },
  );
  if (proc.exitCode !== 0) process.exit(proc.exitCode ?? 1);
  console.log(`built ${out} (${version})`);
}
