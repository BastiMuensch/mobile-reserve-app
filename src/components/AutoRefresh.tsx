'use client'

import { useEffect } from 'react'
import { useAuth } from './AuthProvider'
import { handleUnauthorized } from '@/lib/authClient'

export function AutoRefresh() {
  const { user, isLoading, setUser } = useAuth()

  useEffect(() => {
    const shouldPoll = !isLoading && (user?.role === 'SCHOOL' || user?.role === 'SCHULAMT' || user?.role === 'TEACHER')
    if (!shouldPoll) return

    const controller = new AbortController()

    async function refresh() {
      const now = Date.now()
      if (now - lastRefreshAt < 750) return
      lastRefreshAt = now
      // Assignment polling intentionally does not re-fetch the whole auth state.
      // Teacher rows can still change through an approved profile update, so rehydrate
      // that role in the background without touching dashboard-local form state.
      if (user?.role === 'TEACHER') {
        try {
          const response = await fetch(`/api/auth/me?t=${now}`, { cache: 'no-store', signal: controller.signal })
          if (controller.signal.aborted) return
          if (response.status === 401) {
            setUser(null)
            handleUnauthorized()
            return
          }
          if (response.ok) {
            const data = await response.json()
            if (!controller.signal.aborted && data.user) setUser(data.user)
          }
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') return
          // Normal assignment refresh remains available while offline.
        }
      }
      window.dispatchEvent(new Event('app-refresh'))
    }

    let interval: ReturnType<typeof setInterval> | null = null
    let lastRefreshAt = 0

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

    // A push-capable worker may notify an open client after it receives a
    // relevant background message. Refresh through the same debounced path.
    function handleServiceWorkerMessage() {
      void refresh()
    }

    if (document.visibilityState === 'visible') {
      startPolling()
    }

    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    navigator.serviceWorker?.addEventListener('message', handleServiceWorkerMessage)

    return () => {
      controller.abort()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', refresh)
      navigator.serviceWorker?.removeEventListener('message', handleServiceWorkerMessage)
      stopPolling()
    }
  }, [isLoading, setUser, user?.role])

  return null
}
