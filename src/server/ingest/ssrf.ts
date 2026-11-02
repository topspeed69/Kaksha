import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const BLOCKED_V4 = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
  "255.255.255.255/32",
];

const METADATA_V4 = ["169.254.0.0/16", "100.100.100.200/32"];

function ipv4ToUint32(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    out = ((out << 8) | n) >>> 0;
  }
  return out;
}

function uint32ToIpv4(value: number): string {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ].join(".");
}

function inCidrV4(ip: string, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split("/");
  const bits = Number(bitsRaw);
  const baseInt = ipv4ToUint32(base);
  const targetInt = ipv4ToUint32(ip);
  if (baseInt === null || targetInt === null || Number.isNaN(bits)) return false;
  if (bits <= 0) return true;
  const mask = bits >= 32 ? 0xffffffff : (~((1 << (32 - bits)) - 1)) >>> 0;
  return ((baseInt & mask) >>> 0) === ((targetInt & mask) >>> 0);
}

/** Parse any valid IPv6 literal (including :: compression and embedded IPv4) into 8 uint16 groups. */
export function parseIpv6Groups(raw: string): number[] | null {
  const stripped = raw.replace(/^\[|\]$/g, "").split("%")[0].trim().toLowerCase();
  if (!stripped || isIP(stripped) !== 6) return null;

  let working = stripped;
  const lastColon = working.lastIndexOf(":");
  if (lastColon !== -1 && working.slice(lastColon + 1).includes(".")) {
    const v4Int = ipv4ToUint32(working.slice(lastColon + 1));
    if (v4Int === null) return null;
    const hi = ((v4Int >>> 16) & 0xffff).toString(16);
    const lo = (v4Int & 0xffff).toString(16);
    working = `${working.slice(0, lastColon)}:${hi}:${lo}`;
  }

  const halves = working.split("::");
  if (halves.length > 2) return null;
  const parseSide = (side: string): number[] | null => {
    if (!side) return [];
    const tokens = side.split(":");
    const nums: number[] = [];
    for (const t of tokens) {
      if (!/^[0-9a-f]{1,4}$/.test(t)) return null;
      nums.push(parseInt(t, 16));
    }
    return nums;
  };

  const left = parseSide(halves[0]);
  if (!left) return null;
  if (halves.length === 1) {
    return left.length === 8 ? left : null;
  }
  const right = parseSide(halves[1]);
  if (!right) return null;
  const fill = 8 - left.length - right.length;
  if (fill < 1) return null;
  return [...left, ...new Array<number>(fill).fill(0), ...right];
}

function embeddedIpv4FromIpv6(groups: number[]): string | null {
  const allZeroPrefix = groups.slice(0, 5).every((g) => g === 0);
  // ::ffff:a.b.c.d (IPv4-mapped) or ::a.b.c.d (IPv4-compatible, excluding :: and ::1)
  if (allZeroPrefix && (groups[5] === 0xffff || (groups[5] === 0 && (groups[6] !== 0 || groups[7] > 1)))) {
    return uint32ToIpv4(((groups[6] << 16) | groups[7]) >>> 0);
  }
  // 64:ff9b::/96 or 64:ff9b:1::/48 (NAT64)
  if (
    groups[0] === 0x0064 &&
    groups[1] === 0xff9b &&
    ((groups[2] === 0 && groups[3] === 0 && groups[4] === 0 && groups[5] === 0) ||
      groups[2] === 1)
  ) {
    return uint32ToIpv4(((groups[6] << 16) | groups[7]) >>> 0);
  }
  // 2002::/16 (6to4 embeds IPv4 in groups[1..2])
  if (groups[0] === 0x2002) {
    return uint32ToIpv4(((groups[1] << 16) | groups[2]) >>> 0);
  }
  return null;
}

/** Link-local / cloud metadata ranges that must NEVER be fetched, even for local providers. */
export function isMetadataIp(rawIp: string): boolean {
  const clean = rawIp.replace(/^\[|\]$/g, "").split("%")[0].trim();
  const kind = isIP(clean);
  if (kind === 4) {
    return METADATA_V4.some((cidr) => inCidrV4(clean, cidr));
  }
  if (kind === 6) {
    const groups = parseIpv6Groups(clean);
    if (!groups) return true;
    // fe80::/10 link-local
    if ((groups[0] & 0xffc0) === 0xfe80) return true;
    const embedded = embeddedIpv4FromIpv6(groups);
    if (embedded && METADATA_V4.some((cidr) => inCidrV4(embedded, cidr))) return true;
  }
  return false;
}

export function isBlockedIp(rawIp: string): boolean {
  const clean = rawIp.replace(/^\[|\]$/g, "").split("%")[0].trim();
  const kind = isIP(clean);
  if (kind === 4) {
    return BLOCKED_V4.some((cidr) => inCidrV4(clean, cidr));
  }
  if (kind === 6) {
    const groups = parseIpv6Groups(clean);
    if (!groups) return true;
    const isUnspecified = groups.every((g) => g === 0);
    const isLoopback = groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1;
    if (isUnspecified || isLoopback) return true;
    // fc00::/7 unique-local
    if ((groups[0] & 0xfe00) === 0xfc00) return true;
    // fe80::/10 link-local
    if ((groups[0] & 0xffc0) === 0xfe80) return true;
    // ff00::/8 multicast
    if ((groups[0] & 0xff00) === 0xff00) return true;
    // 100::/64 discard-only
    if (groups[0] === 0x0100 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0) return true;
    // 2001:db8::/32 documentation
    if (groups[0] === 0x2001 && groups[1] === 0x0db8) return true;
    const embedded = embeddedIpv4FromIpv6(groups);
    if (embedded && BLOCKED_V4.some((cidr) => inCidrV4(embedded, cidr))) return true;
    return false;
  }
  // Not a valid IPv4 or IPv6 address -> block by default
  return true;
}

export type UrlCheck =
  | { ok: true; url: URL; addresses: string[] }
  | { ok: false; reason: string };

/** Validate a user-supplied URL before the server fetches it. */
export async function checkUrl(
  raw: string,
  options: { allowLocal?: boolean; allowLocalProviders?: boolean } = {},
): Promise<UrlCheck> {
  if (!raw || typeof raw !== "string" || raw.length > 2048) {
    return { ok: false, reason: "That does not look like a valid address" };
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "That does not look like a valid address" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "Only http and https addresses can be read" };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "Addresses with embedded credentials are not allowed" };
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host) {
    return { ok: false, reason: "That does not look like a valid address" };
  }

  // If the hostname is already an IP literal, validate it directly without DNS tricks.
  if (isIP(host) !== 0) {
    if (isMetadataIp(host)) {
      return {
        ok: false,
        reason: `Refusing to connect to ${host}: link-local and metadata addresses are blocked`,
      };
    }
    if (!options.allowLocal && !options.allowLocalProviders && isBlockedIp(host)) {
      return {
        ok: false,
        reason: `Refusing to fetch ${host}: private and local addresses are blocked`,
      };
    }
    return { ok: true, url, addresses: [host] };
  }

  // Also reject non-canonical numeric/octal/hex IPv4 hostnames that some resolvers coerce.
  if (/^(0x[0-9a-f]+|\d+)(\.(0x[0-9a-f]+|\d+)){0,3}$/i.test(host)) {
    return {
      ok: false,
      reason: `Refusing to fetch ${host}: non-standard numeric IP notation is blocked`,
    };
  }

  try {
    const records = await lookup(host, { all: true });
    if (!records.length) {
      return { ok: false, reason: `Could not resolve ${host}` };
    }
    const addresses = records.map((r) => r.address);
    for (const addr of addresses) {
      if (isMetadataIp(addr)) {
        return {
          ok: false,
          reason: `Refusing to connect to ${host}: link-local and metadata addresses are blocked`,
        };
      }
      if (!options.allowLocal && !options.allowLocalProviders && isBlockedIp(addr)) {
        return {
          ok: false,
          reason: `Refusing to fetch ${host}: it resolves to a private address`,
        };
      }
    }
    return { ok: true, url, addresses };
  } catch {
    return { ok: false, reason: `Could not resolve ${host}` };
  }
}

/**
 * Validate a user-configured LLM / TTS / Embedding provider base URL.
 * Loopback and private LAN ranges are permitted ONLY when KAKSHA_ALLOW_LOCAL_PROVIDERS=1;
 * cloud metadata ranges (169.254.0.0/16, fe80::/10) are always blocked.
 */
export async function checkProviderUrl(raw: string): Promise<UrlCheck> {
  const allowLocalProviders = process.env.KAKSHA_ALLOW_LOCAL_PROVIDERS === "1";
  const result = await checkUrl(raw, { allowLocalProviders });
  if (!result.ok && !allowLocalProviders && result.reason.includes("private")) {
    return {
      ok: false,
      reason: `${result.reason}. Set KAKSHA_ALLOW_LOCAL_PROVIDERS=1 to use local providers such as Ollama or Kokoro.`,
    };
  }
  return result;
}
