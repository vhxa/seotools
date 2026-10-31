'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

/** Re-fetches the server components every few seconds while the tab is visible. */
export function AutoRefresh({ intervalMs = 3000 }: { intervalMs?: number }) {
  const router = useRouter()
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh()
    }, intervalMs)
    return () => clearInterval(id)
  }, [router, intervalMs])
  return null
}
