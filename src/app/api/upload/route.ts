import { NextResponse } from "next/server";
import { unlink, writeFile, mkdir } from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { getSessionUser } from "@/lib/auth";
import { createRateLimiter, getClientIp } from "@/lib/rateLimit";
import { ensurePrivateSignaturesDir, getPublicUploadsDir, privateSignatureUrl } from "@/lib/mediaStorage";
import { prisma } from "@/lib/prisma";

const uploadLimiter = createRateLimiter({ windowMs: 5 * 60 * 1000, maxAttempts: 10 });

const ALLOWED_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp'
];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export async function POST(request: Request) {
  const userSession = await getSessionUser();
  if (!userSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ip = getClientIp(request);
  const { success } = uploadLimiter.check(ip);
  if (!success) {
    return NextResponse.json(
      { error: 'Zu viele Uploads. Bitte warten Sie einige Minuten.' },
      { status: 429 }
    );
  }

  if (userSession.role !== 'SCHULAMT' && userSession.role !== 'SCHOOL') {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Route Handlers expose multipart parsing via request.formData(), which buffers
  // the body. Require a bounded Content-Length before calling it; deployments
  // must additionally enforce the same limit at the reverse proxy (DEPLOYMENT).
  const contentLength = request.headers.get("content-length");
  if (!contentLength || !/^\d+$/.test(contentLength)) {
    return NextResponse.json(
      { error: "Für Uploads ist eine gültige Content-Length erforderlich." },
      { status: 411 },
    );
  }
  const declaredLength = Number(contentLength);
  if (!Number.isSafeInteger(declaredLength) || declaredLength > 6 * 1024 * 1024) {
    return NextResponse.json(
      { error: "Datei ist zu groß. Maximal 5 MB erlaubt." },
      { status: 413 }
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const purpose = formData.get("purpose") as string | null;

    if (!file) {
      return NextResponse.json({ error: "Keine Datei übermittelt." }, { status: 400 });
    }

    if (!purpose || !["signature", "logo", "school_image"].includes(purpose)) {
      return NextResponse.json(
        { error: "Ungültiger oder fehlender Verwendungszweck (purpose). Erlaubt: 'signature', 'logo', 'school_image'." },
        { status: 400 }
      );
    }

    // Role-based authorization per purpose
    if (purpose === "signature" && userSession.role !== "SCHULAMT") {
      return NextResponse.json({ error: "Forbidden: Signaturen können nur vom Schulamt hochgeladen werden." }, { status: 403 });
    }
    if (purpose === "logo" && userSession.role !== "SCHULAMT") {
      return NextResponse.json({ error: "Forbidden: Logos können nur vom Schulamt hochgeladen werden." }, { status: 403 });
    }

    // Post-Check: file.size <= 5 MB
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "Datei ist zu groß. Maximal 5 MB erlaubt." },
        { status: 413 }
      );
    }

    // Allowed MIME types per purpose
    const allowedMimeTypes = (purpose === "signature" || purpose === "logo")
      ? ["image/jpeg", "image/png"]
      : ALLOWED_MIME_TYPES;

    if (!allowedMimeTypes.includes(file.type)) {
      return NextResponse.json(
        { error: purpose === "signature" || purpose === "logo"
            ? "Ungültiger Dateityp. Erlaubt sind nur PNG und JPEG."
            : "Ungültiger Dateityp. Erlaubt sind: JPEG, PNG, GIF, WebP." },
        { status: 400 }
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Magic byte validation: ensure file content matches claimed MIME type
    const isValidMagicBytes = (buf: Buffer, mimeType: string): boolean => {
      if (buf.length < 12) return false;
      switch (mimeType) {
        case 'image/jpeg':
          return buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
        case 'image/png':
          return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
        case 'image/gif':
          return buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38;
        case 'image/webp':
          return (
            buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
            buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
          );
        default:
          return false;
      }
    };

    if (!isValidMagicBytes(buffer, file.type)) {
      return NextResponse.json(
        { error: 'Ungültiges Dateiformat' },
        { status: 400 }
      );
    }

    // Create safe filename: UUID + sanitized original extension
    const ext = path.extname(file.name).toLowerCase().replace(/[^a-z0-9.]/g, '');
    const allowedExtensions = (purpose === "signature" || purpose === "logo")
      ? ['.jpg', '.jpeg', '.png']
      : ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const safeExt = allowedExtensions.includes(ext) ? ext : (file.type === 'image/png' ? '.png' : '.jpg');
    const filename = `${uuidv4()}${safeExt}`;

    const isSignature = purpose === "signature";
    const uploadDir = isSignature ? await ensurePrivateSignaturesDir() : getPublicUploadsDir();
    await mkdir(uploadDir, { recursive: true });
    const filepath = path.join(uploadDir, filename);
    const url = isSignature ? privateSignatureUrl(filename) : `/uploads/${filename}`;

    // Store ownership metadata immediately. Without it, a guessed but otherwise
    // valid private URL could later be claimed in the school-office profile.
    await writeFile(filepath, buffer, { flag: "wx" });
    try {
      await prisma.uploadedAsset.create({
        data: { ownerUserId: userSession.id, url, purpose },
      });
    } catch (error) {
      await unlink(filepath).catch(() => undefined);
      throw error;
    }

    return NextResponse.json({ success: true, url });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json({ error: "Failed to upload file" }, { status: 500 });
  }
}
