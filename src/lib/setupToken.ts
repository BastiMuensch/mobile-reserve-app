import { timingSafeEqual } from "crypto";

export function hasValidSetupToken(provided: string | undefined): boolean {
  const expected = process.env.SETUP_TOKEN;
  if (!expected) return process.env.NODE_ENV !== "production";
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided || "");
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}
