import { NextResponse } from 'next/server';
import { getVapidKeys } from '@/lib/push';

export async function GET() {
  try {
    const { publicKey } = await getVapidKeys();
    return NextResponse.json({ publicKey });
  } catch (error) {
    console.error('Failed to retrieve VAPID public key:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
