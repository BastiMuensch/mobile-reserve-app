import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { getSessionUser } from '@/lib/auth';

// GET: List all SCHULAMT users
export async function GET() {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const schulaemter = await prisma.user.findMany({
      where: { role: 'SCHULAMT' },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });
    return NextResponse.json(schulaemter);
  } catch (error) {
    console.error('GET /api/admin/schulaemter error:', error);
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}

// POST: Create a new SCHULAMT user
export async function POST(request: Request) {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const data = await request.json();

    if (!data.email || !data.password) {
      return NextResponse.json({ error: 'E-Mail und Passwort erforderlich.' }, { status: 400 });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(data.email)) {
      return NextResponse.json({ error: 'Ungültige E-Mail-Adresse.' }, { status: 400 });
    }

    if (typeof data.password !== 'string' || data.password.length < 6) {
      return NextResponse.json({ error: 'Passwort muss mindestens 6 Zeichen lang sein.' }, { status: 400 });
    }

    // Check for existing email
    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) {
      return NextResponse.json({ error: 'Diese E-Mail-Adresse ist bereits vergeben.' }, { status: 409 });
    }

    const hashedPassword = await bcrypt.hash(data.password, 10);

    const user = await prisma.user.create({
      data: {
        email: data.email,
        password: hashedPassword,
        role: 'SCHULAMT',
        name: data.name || null,
      },
      select: { id: true, email: true, name: true, role: true },
    });

    let latitude: number | null = null;
    let longitude: number | null = null;

    if (data.address && data.address.trim() !== '') {
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(data.address.trim())}`, {
          headers: { 'User-Agent': 'MobileReserve-App' }
        });
        if (res.ok) {
          const geoData = await res.json();
          if (geoData && geoData.length > 0) {
            latitude = parseFloat(geoData[0].lat);
            longitude = parseFloat(geoData[0].lon);
          }
        }
      } catch (err) {
        console.error('Failed to geocode new Schulamt address', err);
      }
    }

    await prisma.schulamtProfile.create({
      data: {
        userId: user.id,
        contactAddress: data.address && data.address.trim() !== '' ? data.address.trim() : "Memminger Str. 18\n87719 Mindelheim",
        city: data.address && data.address.trim() !== '' ? data.address.trim() : "Mindelheim",
        latitude,
        longitude
      }
    });

    return NextResponse.json(user, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to create account' }, { status: 500 });
  }
}

// PATCH: Update password of a SCHULAMT user
export async function PATCH(request: Request) {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { userId, newPassword } = await request.json();
    if (!userId || !newPassword) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

    if (typeof newPassword !== 'string' || newPassword.length < 6) {
      return NextResponse.json({ error: 'Passwort muss mindestens 6 Zeichen lang sein.' }, { status: 400 });
    }

    // Safety: only reset password for SCHULAMT users, never ADMIN
    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target || target.role !== 'SCHULAMT') {
      return NextResponse.json({ error: 'Kann nur Passwörter von Schulamts-Accounts zurücksetzen.' }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

// DELETE: Remove a SCHULAMT user
export async function DELETE(request: Request) {
  const userSession = await getSessionUser();
  if (!userSession || userSession.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { userId } = await request.json();
    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
    }

    // Safety: only delete SCHULAMT users, never ADMIN
    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target || target.role !== 'SCHULAMT') {
      return NextResponse.json({ error: 'Kann nur Schulamts-Accounts löschen.' }, { status: 400 });
    }

    await prisma.user.delete({ where: { id: userId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
