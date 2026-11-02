"use client";

import { MessageSquare } from "lucide-react";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";

export function RequestUrgencyBadge({ note }: { note?: string | null }) {
  if (!note?.trim()) return null;
  return (
    <Popover>
      <PopoverTrigger
        onClick={event => event.stopPropagation()}
        aria-label="Schulnachricht öffnen – nur für das Schulamt"
        aria-haspopup="dialog"
        className="inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-md border border-primary/20 bg-primary/5 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <MessageSquare className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Schulnachricht
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-80 w-96 max-w-[90vw] overflow-y-auto p-4" onClick={event => event.stopPropagation()}>
        <PopoverTitle>Nachricht ans Schulamt</PopoverTitle>
        <p className="whitespace-pre-wrap break-words">{note}</p>
        <p className="text-xs text-muted-foreground">Nur für das Schulamt · Für Mobile Reserven nicht sichtbar</p>
      </PopoverContent>
    </Popover>
  );
}

export function RequestUrgencyNote({ note }: { note?: string | null }) {
  return <RequestUrgencyBadge note={note} />;
}
