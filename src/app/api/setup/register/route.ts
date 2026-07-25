import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";

const RegisterAdminSchema = z.object({
  name: z.string().min(1, "Name ist erforderlich"),
  email: z.string().email("Ungültige E-Mail Adresse"),
  password: z.string().min(8, "Passwort muss mindestens 8 Zeichen lang sein"),
});

export async function POST(req: Request) {
  try {
    const data = await req.json();

    const parsedData = RegisterAdminSchema.safeParse(data);
    if (!parsedData.success) {
      return NextResponse.json({ error: parsedData.error.issues[0].message }, { status: 400 });
    }
    const { name, password } = parsedData.data;
    // E-Mail normalisieren, damit sie exakt so gespeichert wird, wie die Login-Route sucht
    // (email.trim().toLowerCase()) – sonst kann sich der Admin nach dem Setup nie einloggen.
    const email = parsedData.data.email.trim().toLowerCase();

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
