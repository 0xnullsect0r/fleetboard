/** One line per event; journald/launchd add their own context. */
export function log(msg: string): void {
  console.log(`${new Date().toISOString()} ${msg}`);
}
