"use client"

/**
 * Leichtgewichtiges Toast-System als Ersatz für native `alert()`-Aufrufe.
 *
 * Einbindung (einmalig, z.B. in src/app/layout.tsx):
 *
 *   <ToastProvider>
 *     {children}
 *   </ToastProvider>
 *
 * Verwendung in einer Client-Komponente:
 *
 *   const { toast } = useToast()
 *
 *   toast({ variant: "success", title: "Gespeichert", description: "Die Änderungen wurden übernommen." })
 *   toast({ variant: "error", title: "Fehler beim Speichern des Profils." })
 *   toast({ variant: "info", title: "Aktualisiert" })
 */

import * as React from "react"
import { CheckCircle2, XCircle, Info, X } from "lucide-react"

import { cn } from "@/lib/utils"

type ToastVariant = "success" | "error" | "info"

interface ToastOptions {
  title: string
  description?: string
  variant?: ToastVariant
  /** Dauer in ms, bevor der Toast automatisch verschwindet. */
  duration?: number
}

interface ToastItem extends Required<Pick<ToastOptions, "title" | "variant" | "duration">> {
  id: string
  description?: string
}

interface ToastContextValue {
  toast: (options: ToastOptions) => string
  dismiss: (id: string) => void
}

const ToastContext = React.createContext<ToastContextValue | null>(null)

const DEFAULT_DURATION = 5000

const VARIANT_ICON: Record<ToastVariant, React.ComponentType<{ className?: string }>> = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
}

const VARIANT_CLASSES: Record<ToastVariant, string> = {
  success: "text-primary [&_svg]:text-primary",
  error: "text-destructive [&_svg]:text-destructive",
  info: "text-foreground [&_svg]:text-muted-foreground",
}

let idCounter = 0
function nextId() {
  idCounter += 1
  return `toast-${Date.now()}-${idCounter}`
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([])

  const dismiss = React.useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id))
  }, [])

  const toast = React.useCallback(
    (options: ToastOptions) => {
      const id = nextId()
      const item: ToastItem = {
        id,
        title: options.title,
        description: options.description,
        variant: options.variant ?? "info",
        duration: options.duration ?? DEFAULT_DURATION,
      }
      setToasts((current) => [...current, item])
      return id
    },
    []
  )

  const value = React.useMemo(() => ({ toast, dismiss }), [toast, dismiss])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = React.useContext(ToastContext)
  if (!ctx) {
    throw new Error("useToast muss innerhalb eines <ToastProvider> verwendet werden.")
  }
  return ctx
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[]
  onDismiss: (id: string) => void
}) {
  const successOrInfo = toasts.filter((t) => t.variant !== "error")
  const errors = toasts.filter((t) => t.variant === "error")

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:items-end sm:bottom-4 sm:right-4 sm:left-auto"
      aria-hidden={toasts.length === 0}
    >
      {/* Nicht-dringende Meldungen: höflich angekündigt */}
      <div role="status" aria-live="polite" className="contents">
        {successOrInfo.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={onDismiss} />
        ))}
      </div>
      {/* Fehler: dringend angekündigt */}
      <div role="status" aria-live="assertive" className="contents">
        {errors.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={onDismiss} />
        ))}
      </div>
    </div>
  )
}

function ToastCard({
  toast: item,
  onDismiss,
}: {
  toast: ToastItem
  onDismiss: (id: string) => void
}) {
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    if (item.duration <= 0) return
    timeoutRef.current = setTimeout(() => onDismiss(item.id), item.duration)
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [item.id, item.duration, onDismiss])

  const Icon = VARIANT_ICON[item.variant]

  return (
    <div
      className={cn(
        "glass-card pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl p-4 shadow-lg",
        "animate-in slide-in-from-bottom-2 fade-in-0 duration-200"
      )}
    >
      <Icon className={cn("mt-0.5 size-5 shrink-0", VARIANT_CLASSES[item.variant])} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{item.title}</p>
        {item.description && (
          <p className="mt-0.5 text-sm text-muted-foreground">{item.description}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(item.id)}
        className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="Meldung schließen"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
