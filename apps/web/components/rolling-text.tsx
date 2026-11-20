'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * A text that, when it changes, moves up and fades out while the new one comes up from below.
 * Both sit in the same grid cell, so the box is as wide as the wider of the two, and both are
 * aligned to the left (a button centres its text, which would make the new one start further in
 * and jump back when the old one goes). The first text
 * is not animated, and with reduced motion the text just changes.
 */
export function RollingText({ text, className }: { text: string; className?: string }) {
  const [state, setState] = useState({ text, previous: null as string | null, turn: 0 })
  // Derived while rendering, so the old text is already there in the frame the new one appears.
  if (state.text !== text) setState({ text, previous: state.text, turn: state.turn + 1 })
  return (
    <span className={cn('-my-0.5 inline-grid min-w-0 overflow-hidden py-0.5 text-left', className)}>
      {state.previous !== null && (
        <span
          key={`out-${state.turn}`}
          aria-hidden="true"
          className="col-start-1 row-start-1 animate-[roll-out_250ms_ease-in_forwards] truncate motion-reduce:hidden"
          onAnimationEnd={() => setState((current) => ({ ...current, previous: null }))}
        >
          {state.previous}
        </span>
      )}
      <span
        key={`in-${state.turn}`}
        className={cn(
          'col-start-1 row-start-1 truncate',
          state.previous !== null && 'animate-[roll-in_250ms_ease-out] motion-reduce:animate-none',
        )}
      >
        {text}
      </span>
    </span>
  )
}
