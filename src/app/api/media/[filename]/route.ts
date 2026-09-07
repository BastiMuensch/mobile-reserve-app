import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getPrivateSignaturePath, privateSignatureUrl } from "@/lib/mediaStorage";

const SAFE_FILENAME_REGEX = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(png|jpe?g)$/i;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ filename: string }> }
) {
  const userSession = await getSessionUser();
  if (!userSession) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { filename } = await params;

  // Strict filename validation: UUID + allowed extension only; reject traversal
  if (!filename || !SAFE_FILENAME_REGEX.test(filename) || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return NextResponse.json({ error: "Ungültiger Dateiname" }, { status: 400 });
  }

  // A handwritten signature is not UI media. It is only shown to the school
  // office for configuration. Teachers and schools receive PDFs generated on
  // the server and therefore never need raw access to this personal datum.
  if (userSession.role !== 'SCHULAMT') {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const signatureUrl = privateSignatureUrl(filename);
  const profile = await prisma.schulamtProfile.findUnique({
    where: { userId: userSession.id },
    select: { signatureUrl: true },
  });
  // Reject both foreign files and orphans. The old implementation permitted
  // any orphan simply because it did not yet have a profile reference.
  if (profile?.signatureUrl !== signatureUrl) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const filepath = getPrivateSignaturePath(signatureUrl);
  if (!filepath) {
    return NextResponse.json({ error: "Ungültiger Dateiname" }, { status: 400 });
  }
  if (!fs.existsSync(filepath)) {
    return NextResponse.json({ error: "Datei nicht gefunden" }, { status: 404 });
  }

  const ext = path.extname(filename).toLowerCase();
  const contentType = ext === '.png' ? 'image/png' : 'image/jpeg';

  const nodeStream = fs.createReadStream(filepath);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;

  return new Response(webStream, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
