import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

/** "5 minutes ago", "yesterday", ... */
export function formatRelative(ms: number | null | undefined, now = Date.now()): string {
  if (!ms) return "Never";
  const diff = (ms - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return "Just now";
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["minute", 60],
    ["hour", 3600],
    ["day", 86400],
    ["week", 604800],
    ["month", 2629800],
    ["year", 31557600],
  ];
  let unit: Intl.RelativeTimeFormatUnit = "minute";
  let value = diff / 60;
  for (const [u, seconds] of units) {
    if (abs >= seconds) {
      unit = u;
      value = diff / seconds;
    }
  }
  return rtf.format(Math.round(value), unit);
}

export function formatDateTime(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}

/** Human-readable byte size, e.g. "1.5 GB". */
export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let size = Math.max(0, bytes);
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat(document.documentElement.lang || undefined, {
    maximumFractionDigits: size >= 10 || unit === 0 ? (unit === 0 ? 0 : 1) : 2,
  }).format(size)} ${units[unit]}`;
}

/** Network rate in bits per second, e.g. "12.5 Mb/s". Null renders as a dash. */
export function formatBitRate(bytesPerSecond: number | null | undefined): string {
  if (bytesPerSecond == null) return "—";
  const megabits = (bytesPerSecond * 8) / 1_000_000;
  if (megabits >= 1) return `${megabits.toFixed(2)} Mb/s`;
  return `${(megabits * 1000).toFixed(0)} Kb/s`;
}

/** user@host:port, omitting the default SSH port. */
export function endpointLabel(username: string, host: string, port: number): string {
  const h = host.includes(":") ? `[${host}]` : host;
  const p = port && port !== 22 ? `:${port}` : "";
  return username ? `${username}@${h}${p}` : `${h}${p}`;
}

export const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform ?? "");

export function debounce<A extends unknown[]>(fn: (...args: A) => void, wait: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  const debounced = (...args: A) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
  debounced.cancel = () => t && clearTimeout(t);
  return debounced;
}
