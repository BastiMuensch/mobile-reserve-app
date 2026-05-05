"use client";

import { useState, useEffect } from "react";
import { useAuth } from "./AuthProvider";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ShieldCheck, UserPlus, Trash2, KeySquare, Building2, LogOut } from "lucide-react";

export function AdminDashboard() {
  const { user, logout } = useAuth();
  const [schulaemter, setSchulaemter] = useState<any[]>([]);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [newAccount, setNewAccount] = useState({ email: "", password: "", name: "" });
  
  const [editingPasswordId, setEditingPasswordId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const loadData = async () => {
    const res = await fetch("/api/admin/schulaemter");
    if (res.ok) {
      setSchulaemter(await res.json());
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAdding(true);
    try {
      const res = await fetch("/api/admin/schulaemter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newAccount),
      });
      if (res.ok) {
        setIsAddOpen(false);
        setNewAccount({ email: "", password: "", name: "" });
        loadData();
      } else {
        const err = await res.json();
        alert(`Fehler: ${err.error}`);
      }
    } finally {
      setIsAdding(false);
    }
  };

  const handleUpdatePassword = async (userId: string) => {
    if (!newPassword) return;
    const res = await fetch("/api/admin/schulaemter", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, newPassword }),
    });
    if (res.ok) {
      setEditingPasswordId(null);
      setNewPassword("");
      alert("Passwort erfolgreich aktualisiert.");
    } else {
      alert("Fehler beim Aktualisieren.");
    }
  };

  const handleDelete = async (userId: string) => {
    if (!confirm("Möchten Sie diesen Schulamts-Account wirklich löschen?")) return;
    const res = await fetch("/api/admin/schulaemter", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (res.ok) {
      loadData();
    } else {
      alert("Fehler beim Löschen.");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-10">
      <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
        
        {/* Header */}
        <div className="flex justify-between items-center bg-white/50 dark:bg-slate-900/50 p-6 rounded-2xl border border-slate-200/60 dark:border-slate-800/60 backdrop-blur-md shadow-sm">
          <div>
            <h1 className="text-4xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-rose-600 to-pink-600 dark:from-rose-400 dark:to-pink-400">
              Admin-Panel
            </h1>
            <p className="text-slate-500 dark:text-slate-400 mt-2 text-lg">
              System-Administration · Schulämter verwalten
            </p>
          </div>
          <Button variant="outline" onClick={logout} className="gap-2">
            <LogOut className="h-4 w-4" /> Abmelden
          </Button>
        </div>

        {/* Schulämter */}
        <Card className="shadow-xl bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border-slate-200/60 dark:border-slate-800/60">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Building2 className="h-6 w-6 text-indigo-500" />
                Schulamts-Accounts
              </CardTitle>
              <CardDescription>
                Erstellen und verwalten Sie die Zugänge für Schulämter. Jedes Schulamt kann dann seine eigenen Schulen und Lehrkräfte anlegen.
              </CardDescription>
            </div>
            <Button onClick={() => setIsAddOpen(true)} className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white shadow-md">
              <UserPlus className="h-4 w-4" /> Schulamt anlegen
            </Button>
          </CardHeader>
          <CardContent>
            {schulaemter.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                <ShieldCheck className="h-12 w-12 mx-auto mb-4 opacity-30" />
                <p className="text-lg font-medium">Noch keine Schulämter angelegt</p>
                <p className="text-sm mt-1">Erstellen Sie den ersten Schulamts-Account, um das System einzurichten.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {schulaemter.map((sa: any) => (
                  <div key={sa.id} className="flex items-center justify-between p-4 border rounded-xl bg-slate-50 dark:bg-slate-900/50 hover:shadow-md transition-shadow">
                    <div>
                      <div className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                        <ShieldCheck className="h-4 w-4 text-indigo-500" />
                        {sa.name || "Schulamt"}
                      </div>
                      <div className="text-sm text-slate-500 mt-0.5">{sa.email}</div>
                      <div className="text-xs text-slate-400 mt-1">
                        Erstellt: {new Date(sa.createdAt || Date.now()).toLocaleDateString('de-DE')}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {editingPasswordId === sa.id ? (
                        <div className="flex items-center gap-2">
                          <Input
                            type="text"
                            placeholder="Neues Passwort"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            className="w-40 h-8 text-sm"
                          />
                          <Button size="sm" onClick={() => handleUpdatePassword(sa.id)}>Speichern</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingPasswordId(null)}>X</Button>
                        </div>
                      ) : (
                        <>
                          <Button size="sm" variant="outline" className="gap-1" onClick={() => setEditingPasswordId(sa.id)}>
                            <KeySquare className="h-3 w-3" /> Passwort
                          </Button>
                          <Button size="sm" variant="destructive" className="gap-1" onClick={() => handleDelete(sa.id)}>
                            <Trash2 className="h-3 w-3" /> Löschen
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Add Dialog */}
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogContent className="sm:max-w-[420px]">
            <DialogHeader>
              <DialogTitle>Neues Schulamt anlegen</DialogTitle>
              <DialogDescription>
                Erstellen Sie einen Zugang für ein Schulamt. Dieses kann dann eigenständig Schulen und Lehrkräfte verwalten.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleAdd} className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="sa-name">Bezeichnung</Label>
                <Input
                  id="sa-name"
                  placeholder="z.B. Schulamt Unterallgäu"
                  value={newAccount.name}
                  onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sa-email">E-Mail-Adresse (Login)</Label>
                <Input
                  id="sa-email"
                  type="email"
                  placeholder="schulamt@landkreis.de"
                  value={newAccount.email}
                  onChange={(e) => setNewAccount({ ...newAccount, email: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sa-password">Passwort</Label>
                <Input
                  id="sa-password"
                  type="text"
                  placeholder="Sicheres Passwort vergeben"
                  value={newAccount.password}
                  onChange={(e) => setNewAccount({ ...newAccount, password: e.target.value })}
                  required
                />
              </div>
              <DialogFooter className="pt-4">
                <Button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white" disabled={isAdding}>
                  {isAdding ? "Wird angelegt..." : "Schulamt-Account erstellen"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
