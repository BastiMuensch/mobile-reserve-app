import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function POST(req: Request) {
  try {
    const { name, email, password } = await req.json();

    if (!name || !email || !password) {
      return NextResponse.json({ error: "Name, E-Mail und Passwort sind erforderlich" }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: "Passwort muss mindestens 8 Zeichen lang sein" }, { status: 400 });
    }

    // SICHERHEITS-CHECK: Existiert bereits ein Admin?
    const adminCount = await prisma.user.count({
      where: {
        role: "ADMIN"
      }
    });

    if (adminCount > 0) {
      return NextResponse.json({ error: "Setup ist bereits abgeschlossen. Es kann kein weiterer Admin über diese Route erstellt werden." }, { status: 403 });
    }

    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      return NextResponse.json({ error: "Diese E-Mail wird bereits verwendet" }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newAdmin = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: "ADMIN"
      }
    });

    return NextResponse.json({ success: true, user: { id: newAdmin.id, email: newAdmin.email, role: newAdmin.role } }, { status: 201 });

  } catch (error) {
    console.error("Error creating initial admin:", error);
    return NextResponse.json({ error: "Interner Serverfehler" }, { status: 500 });
  }
}
