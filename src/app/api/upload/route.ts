import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { getSessionUser } from "@/lib/auth";
import { createRateLimiter, getClientIp } from "@/lib/rateLimit";

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

  if (userSession.role !== 'SCHULAMT' && userSession.role !== 'ADMIN') {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate file type
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Ungültiger Dateityp. Erlaubt sind: JPEG, PNG, GIF, WebP." },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "Datei ist zu groß. Maximal 5 MB erlaubt." },
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


    // Create safe filename: UUID + sanitized original extension only
    const ext = path.extname(file.name).toLowerCase().replace(/[^a-z0-9.]/g, '');
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const safeExt = allowedExtensions.includes(ext) ? ext : '.bin';
    const filename = `${uuidv4()}${safeExt}`;
    
    // Save to public/uploads
    const uploadDir = path.join(process.cwd(), "public", "uploads");
    await mkdir(uploadDir, { recursive: true });
    const filepath = path.join(uploadDir, filename);
    
    await writeFile(filepath, buffer);

    return NextResponse.json({ success: true, url: `/uploads/${filename}` });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json({ error: "Failed to upload file" }, { status: 500 });
  }
}
