'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export function AutoRefresh() {
  const router = useRouter()

  useEffect(() => {
    // Refresh the page data every 30 seconds
    const interval = setInterval(() => {
      router.refresh()
      window.dispatchEvent(new Event('app-refresh'))
    }, 30000)

    return () => clearInterval(interval)
  }, [router])

  return null
}
