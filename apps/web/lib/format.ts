const HR_UNITS = ["H/s", "kH/s", "MH/s", "GH/s", "TH/s", "PH/s"] as const;

/** 49137 -> { value: "49.14", unit: "kH/s" } */
export function hashrate(h: number, digits = 2): { value: string; unit: string } {
  let v = Math.max(0, h);
  let i = 0;
  while (v >= 1000 && i < HR_UNITS.length - 1) {
    v /= 1000;
    i++;
  }
  return { value: v.toFixed(i === 0 ? 0 : digits), unit: HR_UNITS[i]! };
}

export const hashrateText = (h: number, digits = 2) => {
  const { value, unit } = hashrate(h, digits);
  return `${value} ${unit}`;
};

/** Hashrate in a fixed unit chosen for a column, so rows line up. */
export function hashrateIn(h: number, unitOf: number, digits = 2): string {
  let div = 1;
  let v = Math.max(0, unitOf);
  while (v >= 1000 && div < 1e12) {
    v /= 1000;
    div *= 1000;
  }
  return (h / div).toFixed(div === 1 ? 0 : digits);
}

export function usd(v: number | undefined, digits = 2): string {
  if (v === undefined || !Number.isFinite(v)) return "—";
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Price: more precision for sub-dollar coins. */
export const price = (v: number | undefined) => usd(v, v !== undefined && v < 1 ? 4 : 2);

export function coinAmount(v: number | undefined, digits = 4): string {
  if (v === undefined || !Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** 762274014488 -> "762.27G" */
export function si(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return "—";
  const units = ["", "k", "M", "G", "T", "P"];
  let i = 0;
  while (Math.abs(v) >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return v.toFixed(2) + units[i];
}

export function age(sec: number): string {
  if (sec < 60) return `${Math.floor(sec)}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

export const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

/** 48edfHu7...BGUicoD */
export const shortAddress = (a: string, head = 8, tail = 6) =>
  a.length <= head + tail + 1 ? a : `${a.slice(0, head)}…${a.slice(-tail)}`;
