"use client"

/**
 * Promise-basierter Ersatz für natives `confirm()`, aufbauend auf der
 * vorhandenen Dialog-Komponente (src/components/ui/dialog.tsx).
 *
 * Einbindung (einmalig, z.B. in src/app/layout.tsx):
 *
 *   <ConfirmProvider>
 *     {children}
 *   </ConfirmProvider>
 *
 * Verwendung in einer Client-Komponente:
 *
 *   const confirm = useConfirm()
 *
 *   async function handleDelete() {
 *     const ok = await confirm({
 *       title: "Anfrage löschen?",
 *       description: "Diese Aktion kann nicht rückgängig gemacht werden.",
 *       confirmLabel: "Löschen",
 *       cancelLabel: "Abbrechen",
 *       variant: "destructive",
 *     })
 *     if (!ok) return
 *     // ... eigentliche Löschung
 *   }
 */

import * as React from "react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  /** "destructive" färbt den Bestätigen-Button als gefährliche Aktion (z.B. Löschen). */
  variant?: "default" | "destructive"
  /**
   * Erzwingt als zusätzliche Hürde das exakte Eintippen dieses Textes, bevor
   * bestätigt werden kann – für besonders folgenreiche Aktionen (z.B. "RESET").
   */
  requireText?: string
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = React.createContext<ConfirmFn | null>(null)

interface PendingConfirm extends Required<Omit<ConfirmOptions, "description" | "requireText">> {
  description?: string
  requireText?: string
  resolve: (value: boolean) => void
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = React.useState<PendingConfirm | null>(null)
  const [typedText, setTypedText] = React.useState("")

  const confirm = React.useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      setTypedText("")
      setPending({
        title: options.title,
        description: options.description,
        confirmLabel: options.confirmLabel ?? "Bestätigen",
        cancelLabel: options.cancelLabel ?? "Abbrechen",
        variant: options.variant ?? "default",
        requireText: options.requireText,
        resolve,
      })
    })
  }, [])

  // Bei erzwungener Texteingabe bleibt der Bestätigen-Button gesperrt, bis der
  // geforderte Text exakt eingetippt wurde.
  const confirmDisabled = pending?.requireText != null && typedText !== pending.requireText

  const settle = React.useCallback(
    (value: boolean) => {
      setPending((current) => {
        current?.resolve(value)
        return null
      })
    },
    []
  )

  const handleOpenChange = React.useCallback(
    (open: boolean) => {
      if (!open) settle(false)
    },
    [settle]
  )

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={pending !== null} onOpenChange={handleOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pending?.title}</DialogTitle>
            {pending?.description && (
              <DialogDescription>{pending.description}</DialogDescription>
            )}
          </DialogHeader>
          {pending?.requireText && (
            <div className="space-y-2">
              <Label htmlFor="confirm-require-text" className="text-sm">
                Tippen Sie zur Bestätigung <span className="font-bold">{pending.requireText}</span> ein:
              </Label>
              <Input
                id="confirm-require-text"
                value={typedText}
                onChange={(e) => setTypedText(e.target.value)}
                autoComplete="off"
                placeholder={pending.requireText}
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => settle(false)}>
              {pending?.cancelLabel}
            </Button>
            <Button
              variant={pending?.variant === "destructive" ? "destructive" : "default"}
              onClick={() => settle(true)}
              disabled={confirmDisabled}
            >
              {pending?.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const ctx = React.useContext(ConfirmContext)
  if (!ctx) {
    throw new Error("useConfirm muss innerhalb eines <ConfirmProvider> verwendet werden.")
  }
  return ctx
}
