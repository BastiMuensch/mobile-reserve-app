import { lookup } from "node:dns/promises";
import https from "node:https";
import net from "node:net";

const DNS_LOOKUP_TIMEOUT_MS = 3_000;

const nonPublicIpv4Addresses = new net.BlockList();
const nonPublicIpv6Addresses = new net.BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  nonPublicIpv4Addresses.addSubnet(address, prefix, "ipv4");
}
for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 32],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  nonPublicIpv6Addresses.addSubnet(address, prefix, "ipv6");
}

export function isPublicIpAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return !nonPublicIpv4Addresses.check(address, "ipv4");
  if (family === 6) return !nonPublicIpv6Addresses.check(address, "ipv6");
  return false;
}

/** Synchronous checks used before a DNS lookup and covered by unit tests. */
export function parsePushEndpoint(endpoint: string): URL | null {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    // Browser Push API endpoints are HTTPS. Restrict explicit non-standard ports
    // so a valid public hostname cannot be used as a proxy to an internal port.
    if (url.port && url.port !== "443") return null;
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) return null;
    if (net.isIP(hostname) && !isPublicIpAddress(hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

async function lookupWithTimeout(hostname: string): Promise<Array<{ address: string }>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("DNS lookup timed out")), DNS_LOOKUP_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Validates generic standards-compliant browser push endpoints without a
 * vendor allowlist. All DNS answers must be publicly routable; a single local
 * answer is rejected to avoid internal access through multi-answer DNS names.
 */
export async function isSafePushEndpoint(endpoint: string): Promise<boolean> {
  const url = parsePushEndpoint(endpoint);
  if (!url) return false;
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(hostname)) return isPublicIpAddress(hostname);
  try {
    const records = await lookupWithTimeout(hostname);
    return records.length > 0 && records.every((record) => isPublicIpAddress(record.address));
  } catch {
    return false;
  }
}

export async function assertSafePushEndpoint(endpoint: string): Promise<void> {
  if (!await isSafePushEndpoint(endpoint)) {
    throw new Error("UNSAFE_PUSH_ENDPOINT");
  }
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Operation timed out")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Resolves each outgoing HTTPS connection to a freshly validated public IP.
 * Passing this agent to web-push closes the DNS-rebinding gap between our
 * validation and Node's normal resolver in https.request().
 */
export function createSafePushAgent(): https.Agent {
  return new https.Agent({
    lookup: ((hostname: string, _options: unknown, callback: (error: Error | null, address?: string, family?: number) => void) => {
      void lookupWithTimeout(hostname)
        .then((records) => {
          const publicRecord = records.find((record) => isPublicIpAddress(record.address));
          if (!publicRecord) {
            callback(new Error("Push endpoint DNS resolved to a non-public address"));
            return;
          }
          callback(null, publicRecord.address, net.isIP(publicRecord.address));
        })
        .catch((error: unknown) => callback(error instanceof Error ? error : new Error("Push endpoint DNS lookup failed")));
    }) as never,
  });
}
