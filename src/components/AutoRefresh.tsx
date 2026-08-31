'use client'

import { useEffect } from 'react'
import { useAuth } from './AuthProvider'

export function AutoRefresh() {
  const { user, isLoading } = useAuth()

  useEffect(() => {
    const shouldPoll = !isLoading && (user?.role === 'SCHOOL' || user?.role === 'SCHULAMT')
    if (!shouldPoll) return

    function refresh() {
      window.dispatchEvent(new Event('app-refresh'))
    }

    let interval: ReturnType<typeof setInterval> | null = null

    function startPolling() {
      if (interval !== null) return
      interval = setInterval(refresh, 15000)
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

    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', refresh)
      stopPolling()
    }
  }, [isLoading, user?.role])

  return null
}
