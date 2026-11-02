import { PATCH } from './end/route';

/** Legacy cancellation entry point: keep history instead of deleting the request. */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return PATCH(new Request(request.url, {
    method: 'PATCH', headers: request.headers, body: JSON.stringify({ action: 'CANCEL' }),
  }), context);
}
