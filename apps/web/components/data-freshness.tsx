'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { dataStampAction } from '@/app/(protected)/domains/[host]/stamp-actions'

const POLL_MS = 15_000

/**
 * Keeps the pages the browser remembers honest: asks for the domain's stamp every few seconds and
 * when the tab comes back, and when it changed (the worker finished something), drops what was
 * remembered and draws the current page again. Draws nothing.
 */
export function DataFreshness({ host, initial }: { host: string; initial: string }) {
  const router = useRouter()
  const seen = useRef(initial)
  // The layout drew again with what the server knows now: that is what has been seen.
  useEffect(() => {
    seen.current = initial
  }, [initial])
  useEffect(() => {
    let running = false
    const check = async () => {
      if (running || document.visibilityState !== 'visible') return
      running = true
      try {
        const stamp = await dataStampAction(host)
        if (stamp !== seen.current) {
          seen.current = stamp
          router.refresh()
        }
      } catch {
        // The next check tries again.
      } finally {
        running = false
      }
    }
    const id = setInterval(check, POLL_MS)
    document.addEventListener('visibilitychange', check)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', check)
    }
  }, [host, router])
  return null
}
