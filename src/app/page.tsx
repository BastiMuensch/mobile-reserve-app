"use client";

import { useAuth } from "@/components/AuthProvider";
import { SchoolDashboard } from "@/components/SchoolDashboard";
import { SchulamtDashboard } from "@/components/SchulamtDashboard";
import { TeacherDashboard } from "@/components/TeacherDashboard";
import { AdminDashboard } from "@/components/AdminDashboard";
import { LoginScreen } from "@/components/LoginScreen";
import { Loader2 } from "lucide-react";

export default function Home() {
  const { user, isLoading } = useAuth();

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

  return (
    <div className="fade-in">
      {user.role === "ADMIN" ? <AdminDashboard /> :
       user.role === "SCHOOL" ? <SchoolDashboard /> : 
       user.role === "TEACHER" ? <TeacherDashboard /> : 
       <SchulamtDashboard />}
    </div>
  );
}

