'use client'

import { useCallback, useSyncExternalStore } from 'react'

const CHANGED = 'seotools:local-storage'

/** Where values go when the browser does not let the page use `localStorage`. */
const fallback = new Map<string, string>()

function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange)
  window.addEventListener(CHANGED, onChange)
  return () => {
    window.removeEventListener('storage', onChange)
    window.removeEventListener(CHANGED, onChange)
  }
}

/**
 * A string kept in `localStorage`, shared by every component that reads the same key and by the
 * other tabs. It is `null` while rendering on the server and until it has been saved, so the first
 * render matches the server's and then switches to what is stored. Where storage is blocked
 * (private mode, policies) it lasts until the page is closed.
 */
export function useLocalStorage(key: string) {
  const value = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return window.localStorage.getItem(key)
      } catch {
        return fallback.get(key) ?? null
      }
    },
    () => null,
  )
  const save = useCallback(
    (next: string | null) => {
      try {
        if (next === null) window.localStorage.removeItem(key)
        else window.localStorage.setItem(key, next)
      } catch {
        if (next === null) fallback.delete(key)
        else fallback.set(key, next)
      }
      window.dispatchEvent(new Event(CHANGED))
    },
    [key],
  )
  return [value, save] as const
}
