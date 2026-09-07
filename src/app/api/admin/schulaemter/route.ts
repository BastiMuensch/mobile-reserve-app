import { NextResponse } from 'next/server';

/**
 * Retired endpoint. A deployment used to expose this URL for creating and
 * administering multiple Schulämter. Keeping an explicit 410 makes the
 * single-instance decision visible to callers and avoids reviving the API by
 * accident; it never performs authentication or data access.
 */
function retired() {
  return NextResponse.json(
    { error: 'Diese Einzelinstanz verwaltet genau ein Schulamt. Die technische Web-Administration wurde eingestellt.' },
    { status: 410, headers: { 'Cache-Control': 'no-store' } },
  );
}

export const GET = retired;
export const POST = retired;
export const PATCH = retired;
export const DELETE = retired;
