"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useAuth } from "@/components/AuthProvider";
import { LoginScreen } from "@/components/LoginScreen";
import { Loader2 } from "lucide-react";

const DashboardLoading = () => (
  <div className="flex h-64 items-center justify-center" role="status" aria-label="Übersicht wird geladen">
    <Loader2 className="h-10 w-10 animate-spin text-primary" />
  </div>
);
const SchoolDashboard = dynamic(() => import("@/components/SchoolDashboard").then(module => module.SchoolDashboard), { loading: DashboardLoading });
const TeacherDashboard = dynamic(() => import("@/components/TeacherDashboard").then(module => module.TeacherDashboard), { loading: DashboardLoading });

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
      {user.role === "SCHOOL" ? <SchoolDashboard /> :
       user.role === "TEACHER" ? <TeacherDashboard /> :
       <LoginScreen />}
    </div>
  );
}
