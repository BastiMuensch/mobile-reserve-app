import { NextResponse } from 'next/server';
import { getVapidKeys } from '@/lib/push';
import { isDemoMode } from '@/lib/demoMode';

export async function GET() {
  try {
    if (await isDemoMode()) return NextResponse.json({ error: 'Geräte-Push ist in dieser Demo deaktiviert.' }, { status: 403 });
    const { publicKey } = await getVapidKeys();
    return NextResponse.json({ publicKey });
  } catch (error) {
    console.error('Failed to retrieve VAPID public key:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
