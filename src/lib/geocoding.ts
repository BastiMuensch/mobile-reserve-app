import "server-only";

import { z } from "zod";
import { prisma } from "@/lib/prisma";

export type GeocodingResult =
  | { status: "RESOLVED"; latitude: number; longitude: number }
  | { status: "NOT_FOUND"; error: string }
  | { status: "UNAVAILABLE"; error: string };

export const POSTAL_CODE_SCHEMA = z.string().trim().regex(/^\d{5}$/, "Bitte geben Sie eine fünfstellige Postleitzahl ein.");

const responseSchema = z.array(z.object({
  lat: z.string(),
  lon: z.string(),
})).max(10);

const MAX_RESPONSE_BYTES = 64 * 1024;
const MIN_REQUEST_INTERVAL_MS = 1_100;

type QueueState = {
  tail: Promise<void>;
  lastStartedAt: number;
};

const globalForGeocoding = globalThis as typeof globalThis & {
  nominatimQueueState?: QueueState;
  postalCodeGeocodeRequests?: Map<string, Promise<GeocodingResult>>;
};

const queueState = globalForGeocoding.nominatimQueueState ?? {
  tail: Promise.resolve(),
  lastStartedAt: 0,
};
globalForGeocoding.nominatimQueueState = queueState;

const postalCodeRequests = globalForGeocoding.postalCodeGeocodeRequests ?? new Map<string, Promise<GeocodingResult>>();
globalForGeocoding.postalCodeGeocodeRequests = postalCodeRequests;

function getServiceBaseUrl(): URL {
  const configured = process.env.GEOCODING_BASE_URL?.trim() || "https://nominatim.openstreetmap.org";
  const url = new URL(configured);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("GEOCODING_BASE_URL ist ungültig konfiguriert.");
  }
  url.pathname = `${url.pathname.replace(/\/$/, "")}/search`;
  return url;
}

async function readLimitedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error("Die Antwort des Geodienstes ist zu groß.");
  }
  if (!response.body) return null;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("Die Antwort des Geodienstes ist zu groß.");
    }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();
  return JSON.parse(body);
}

async function enqueueRequest<T>(task: () => Promise<T>): Promise<T> {
  let release!: () => void;
  const turn = new Promise<void>(resolve => { release = resolve; });
  const previous = queueState.tail;
  queueState.tail = previous.then(() => turn, () => turn);

  await previous.catch(() => undefined);
  const remainingDelay = Math.max(0, MIN_REQUEST_INTERVAL_MS - (Date.now() - queueState.lastStartedAt));
  if (remainingDelay > 0) await new Promise(resolve => setTimeout(resolve, remainingDelay));
  queueState.lastStartedAt = Date.now();

  try {
    return await task();
  } finally {
    release();
  }
}

async function requestCoordinates(params: URLSearchParams): Promise<GeocodingResult> {
  try {
    const url = getServiceBaseUrl();
    url.search = params.toString();
    const response = await enqueueRequest(() => fetch(url, {
      headers: {
        Accept: "application/json",
        "Accept-Language": "de",
        "User-Agent": process.env.GEOCODING_USER_AGENT?.trim() || "MobileReserve.digital/1.0 (school authority installation)",
      },
      signal: AbortSignal.timeout(7_000),
      cache: "no-store",
      redirect: "error",
    }));
    if (!response.ok) {
      return { status: "UNAVAILABLE", error: `Geokodierungsdienst antwortete mit HTTP ${response.status}.` };
    }

    const parsed = responseSchema.safeParse(await readLimitedJson(response));
    if (!parsed.success || !parsed.data[0]) {
      return { status: "NOT_FOUND", error: "Der Standort wurde nicht gefunden." };
    }

    const latitude = Number(parsed.data[0].lat);
    const longitude = Number(parsed.data[0].lon);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return { status: "NOT_FOUND", error: "Der Geodienst lieferte keine gültigen Koordinaten." };
    }
    return { status: "RESOLVED", latitude, longitude };
  } catch (error) {
    return {
      status: "UNAVAILABLE",
      error: error instanceof Error
        ? `Geokodierung derzeit nicht verfügbar: ${error.message}`
        : "Geokodierung derzeit nicht verfügbar.",
    };
  }
}

/** Geocodes public/institutional addresses such as schools and authority offices. */
export function geocodeAddress(address: string): Promise<GeocodingResult> {
  return requestCoordinates(new URLSearchParams({
    format: "jsonv2",
    limit: "1",
    countrycodes: "de",
    q: address,
  }));
}

/**
 * Resolves only a German postal code. No teacher name or full home address is sent
 * to the external service. Results are persisted because postal-code centroids are
 * stable and the public Nominatim service requires caching and low request volume.
 */
export async function geocodePostalCode(rawPostalCode: string): Promise<GeocodingResult> {
  const parsedPostalCode = POSTAL_CODE_SCHEMA.safeParse(rawPostalCode);
  if (!parsedPostalCode.success) {
    return { status: "NOT_FOUND", error: parsedPostalCode.error.issues[0]?.message || "Ungültige Postleitzahl." };
  }
  const postalCode = parsedPostalCode.data;

  const cached = await prisma.postalCodeGeocode.findUnique({ where: { postalCode } });
  if (cached) {
    return { status: "RESOLVED", latitude: cached.latitude, longitude: cached.longitude };
  }

  const existingRequest = postalCodeRequests.get(postalCode);
  if (existingRequest) return existingRequest;

  const request = (async () => {
    const result = await requestCoordinates(new URLSearchParams({
      format: "jsonv2",
      limit: "1",
      countrycodes: "de",
      postalcode: postalCode,
    }));
    if (result.status === "RESOLVED") {
      await prisma.postalCodeGeocode.upsert({
        where: { postalCode },
        update: { latitude: result.latitude, longitude: result.longitude, source: "NOMINATIM" },
        create: { postalCode, latitude: result.latitude, longitude: result.longitude, source: "NOMINATIM" },
      });
    }
    return result;
  })();
  postalCodeRequests.set(postalCode, request);
  try {
    return await request;
  } finally {
    postalCodeRequests.delete(postalCode);
  }
}
