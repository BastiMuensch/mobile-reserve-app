'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export function AutoRefresh() {
  const router = useRouter()

  useEffect(() => {
    function refresh() {
      router.refresh()
      window.dispatchEvent(new Event('app-refresh'))
    }

    let interval: ReturnType<typeof setInterval> | null = null

    function startPolling() {
      if (interval !== null) return
      interval = setInterval(refresh, 30000)
    }

    function stopPolling() {
      if (interval === null) return
      clearInterval(interval)
      interval = null
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        // Beim Zurückkehren in den Vordergrund einmalig aktualisieren
        // und das Polling wieder aufnehmen.
        refresh()
        startPolling()
      } else {
        stopPolling()
      }
    }

    if (document.visibilityState === 'visible') {
      startPolling()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      stopPolling()
    }
  }, [router])

  return null
}
