"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { SchoolDashboard } from "@/components/SchoolDashboard";
import { TeacherDashboard } from "@/components/TeacherDashboard";
import { AdminDashboard } from "@/components/AdminDashboard";
import { LoginScreen } from "@/components/LoginScreen";
import { Loader2 } from "lucide-react";

export default function Home() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  // Das Schulamt-Dashboard lebt jetzt unter eigenen Routen (/schulamt/...) statt als Tab
  // hier auf der Startseite - eingeloggte Schulamt-Nutzer werden dorthin weitergeleitet.
  useEffect(() => {
    if (!isLoading && user?.role === "SCHULAMT") {
      router.replace("/schulamt");
    }
  }, [isLoading, user, router]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  if (user.role === "SCHULAMT") {
    // Weiterleitung läuft (siehe useEffect oben); bis dahin nichts Falsches anzeigen.
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="fade-in">
      {user.role === "ADMIN" ? <AdminDashboard /> :
       user.role === "SCHOOL" ? <SchoolDashboard /> :
       <TeacherDashboard />}
    </div>
  );
}

