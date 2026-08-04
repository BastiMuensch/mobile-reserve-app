"use client";

import { useState } from "react";
import { useSchulamtData } from "@/hooks/useSchulamtData";
import { useSchulamtYear } from "@/hooks/useSchulamtYear";
import { useToast } from "@/components/ui/toast";
import { SchoolManager } from "@/components/schulamt/SchoolManager";
import { NewSchoolForm } from "@/types/models";

/**
 * Schulen des Schulamts: anlegen, Kontaktdaten einsehen, Zugangsdaten ändern.
 *
 * Bewusst eine eigene Seite neben den Mobilen Reserven statt ein Abschnitt der
 * Einstellungen: Die Schulliste ist Stammdaten- und Nachschlagewerk, kein Schalterkasten.
 * Unter "Einstellungen" stehen jetzt nur noch echte Einstellungen.
 */
export default function SchulamtSchulenPage() {
  const { selectedYear, setSelectedYear } = useSchulamtYear();
  const data = useSchulamtData({ endpoints: ["schools"], year: selectedYear, setYear: setSelectedYear });
  const { toast } = useToast();

  const [isAddingSchool, setIsAddingSchool] = useState(false);
  const [newSchool, setNewSchool] = useState<NewSchoolForm>({
    name: "", address: "", type: "GRUNDSCHULE", email: "", password: ""
  });
  const [editingPasswordId, setEditingPasswordId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");

  // Kopfzeile und KPI-Kacheln im Layout haben ihre eigene Hook-Instanz - das
  // app-refresh-Event bringt sie mit auf den neuen Stand.
  const refresh = () => {
    data.loadData();
    window.dispatchEvent(new Event('app-refresh'));
  };

  const handleAddSchool = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAddingSchool(true);
    try {
      const res = await fetch("/api/schools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSchool)
      });
      if (res.ok) {
        setNewSchool({ name: "", address: "", type: "GRUNDSCHULE", email: "", password: "" });
        toast({ variant: "success", title: "Schule angelegt." });
        refresh();
      } else {
        const err = await res.json().catch(() => ({}));
        toast({ variant: "error", title: err.error || "Fehler beim Anlegen der Schule." });
      }
    } catch {
      toast({ variant: "error", title: "Netzwerkfehler beim Anlegen der Schule." });
    } finally {
      setIsAddingSchool(false);
    }
  };

  const handleUpdateCredentials = async (schoolId: string) => {
    if (!newPassword && !newEmail) return;
    try {
      const res = await fetch("/api/schools", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schoolId, newPassword: newPassword || undefined, newEmail: newEmail || undefined })
      });
      if (res.ok) {
        setEditingPasswordId(null);
        setNewPassword("");
        setNewEmail("");
        toast({ variant: "success", title: "Zugangsdaten erfolgreich aktualisiert." });
        refresh();
      } else {
        toast({ variant: "error", title: "Fehler beim Aktualisieren der Zugangsdaten." });
      }
    } catch {
      toast({ variant: "error", title: "Fehler beim Aktualisieren der Zugangsdaten." });
    }
  };

  return (
    <div className="max-w-5xl">
      <SchoolManager
        handleAddSchool={handleAddSchool}
        newSchool={newSchool}
        setNewSchool={setNewSchool}
        isAddingSchool={isAddingSchool}
        sortedSchools={data.sortedSchools}
        editingPasswordId={editingPasswordId}
        setEditingPasswordId={setEditingPasswordId}
        newEmail={newEmail}
        setNewEmail={setNewEmail}
        newPassword={newPassword}
        setNewPassword={setNewPassword}
        handleUpdateCredentials={handleUpdateCredentials}
        onChanged={refresh}
      />
    </div>
  );
}
