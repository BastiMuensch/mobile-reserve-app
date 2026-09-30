import { publicUploadResponse } from '@/lib/publicUploadResponse';

export const runtime = 'nodejs';

// Next's production static-file inventory does not include later uploads. This
// route also lets next/image resolve them internally without the recovery gateway.
export async function GET(_request: Request, { params }: { params: Promise<{ filename: string }> }) {
  const { filename } = await params;
  return publicUploadResponse(filename);
}
