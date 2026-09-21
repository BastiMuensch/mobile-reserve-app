"use client";

import { ChangePasswordForm } from '@/components/auth/ChangePasswordForm';
import { useAuth } from '@/components/AuthProvider';

export default function PasswordPage() {
  const { user, isLoading } = useAuth();
  if (isLoading) return null;
  if (!user || user.role !== 'SCHOOL') return <main className="mx-auto max-w-xl p-8 text-sm text-muted-foreground">Diese Seite steht nur angemeldeten Schulaccounts zur Verfügung.</main>;
  return <ChangePasswordForm />;
}
