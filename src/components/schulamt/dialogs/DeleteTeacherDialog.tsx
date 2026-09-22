"use client";

import { useRef, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TeacherData } from "@/types/models";

interface DeleteTeacherDialogProps {
  teacher: TeacherData;
  onClose: () => void;
  onDeleted: () => void;
}

export function DeleteTeacherDialog({ teacher, onClose, onDeleted }: DeleteTeacherDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const cancelButton = useRef<HTMLButtonElement>(null);

  const handleDelete = async () => {
    if (pending.current) return;
    pending.current = true;
    setIsDeleting(true);
    setError(null);
    try {
      const response = await fetch(`/api/teachers/${teacher.id}`, { method: "DELETE" });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        setError(result?.error || "Die Mobile Reserve konnte nicht gelöscht werden. Bitte versuchen Sie es erneut.");
        return;
      }
    } catch {
      setError("Netzwerkfehler. Bitte prüfen Sie Ihre Verbindung und versuchen Sie es erneut.");
      return;
    } finally {
      pending.current = false;
      setIsDeleting(false);
    }
    onDeleted();
  };

  return (
    <Dialog open onOpenChange={open => { if (!open && !pending.current) onClose(); }}>
      <DialogContent className="sm:max-w-md max-h-[85dvh] overflow-y-auto" showCloseButton={!isDeleting} initialFocus={cancelButton}>
        <DialogHeader>
          <div className="mb-1 flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <Trash2 className="size-5" />
          </div>
          <DialogTitle>Mobile Reserve löschen?</DialogTitle>
          <DialogDescription className="leading-relaxed">
            <strong className="text-foreground">{teacher.name}</strong> wird aus dem Schuljahr {teacher.schoolYear} dauerhaft entfernt.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">
          <p>Profildaten und Abwesenheiten dieses Schuljahres werden gelöscht. Ein zugehöriger Zugang wird nur gelöscht, wenn er in keinem weiteren Schuljahr verwendet wird.</p>
          <p>Bei vorhandenen Einsätzen ist das Löschen gesperrt, damit die Nachweise erhalten bleiben.</p>
          <p className="font-medium text-foreground">Diese Aktion kann nicht rückgängig gemacht werden.</p>
        </div>
        {error && <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button ref={cancelButton} variant="outline" disabled={isDeleting} onClick={onClose}>Abbrechen</Button>
          <Button variant="destructive" disabled={isDeleting} onClick={handleDelete}>
            {isDeleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            {isDeleting ? "Wird gelöscht …" : "Endgültig löschen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
