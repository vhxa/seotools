'use client'

import { useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const subscribeNever = () => () => {}

/**
 * Draws its children into an element of the app shell, outside the page's own tree (the shell owns
 * the frame, the page owns what goes in it). The element is looked up in the browser only, so the
 * server renders nothing here.
 */
export function ShellSlot({ id, children }: { id: string; children: ReactNode }) {
  const slot = useSyncExternalStore(
    subscribeNever,
    () => document.getElementById(id),
    () => null,
  )
  return slot ? createPortal(children, slot) : null
}
