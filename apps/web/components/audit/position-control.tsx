'use client'

import { RotateCcwIcon } from 'lucide-react'
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { InfoHelp } from '@/components/help'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'

export interface Position<V extends string> {
  value: V
  label: string
}

/** The stored `allowed` of a condition, as a checkbox next to its two buttons. */
export interface AllowedBox {
  label: string
  /** What it means, for the help button next to it. */
  help: ReactNode
  /** It is chosen. */
  checked: boolean
  /** It is what applies while nothing is chosen. */
  muted: boolean
  onToggle: () => void
}

/**
 * A statement as two buttons (and, for a condition, a checkbox for "don't warn either way"), always
 * the same size whatever its state, so choosing, resetting or reading it never moves what is around:
 * - stated: the chosen button is solid (with the checkbox, both buttons are dimmed);
 * - not stated: what applies without a statement shows muted, with a dashed outline, and nothing is
 *   solid; when nothing describes it, nothing is highlighted;
 * - the way back sits in a slot that is reserved whether or not the button shows.
 * The buttons are a radio group for keyboards and screen readers: only a stated one is "checked".
 */
export function PositionControl<V extends string>({
  labelledBy,
  describedBy,
  positions,
  stated,
  muted,
  onPick,
  onReset,
  resetLabel,
  disabled,
  allowed,
}: {
  labelledBy: string
  describedBy?: string
  /** The two positions. */
  positions: readonly Position<V>[]
  /** The position that is chosen, if one is. */
  stated: V | null
  /** The position that applies while nothing is chosen, if one describes it. */
  muted: V | null
  onPick: (value: V) => void
  onReset: () => void
  resetLabel: string
  disabled?: boolean
  allowed?: AllowedBox
}) {
  const group = useRef<HTMLDivElement>(null)
  const name = useId()

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0
    if (step === 0) return
    event.preventDefault()
    const next = positions[(index + step + positions.length) % positions.length]
    if (!next) return
    onPick(next.value)
    group.current?.querySelector<HTMLButtonElement>(`[data-position="${next.value}"]`)?.focus()
  }
  // One tab stop: the chosen position, or the first when nothing is chosen.
  const focusable = stated ?? positions[0]?.value
  const dimmed = allowed?.checked === true
  const isStated = stated !== null || dimmed

  return (
    <div className="flex items-center gap-3">
      <div
        ref={group}
        role="radiogroup"
        aria-labelledby={labelledBy}
        {...(describedBy ? { 'aria-describedby': describedBy } : {})}
        className="inline-flex w-48 shrink-0 rounded-lg border bg-muted/40 p-0.5"
      >
        {positions.map((position, index) => {
          const chosen = stated === position.value
          const inherited = stated === null && !dimmed && muted === position.value
          return (
            <button
              key={position.value}
              type="button"
              role="radio"
              id={`${name}-${position.value}`}
              data-position={position.value}
              data-state={chosen ? 'stated' : inherited ? 'inherited' : 'off'}
              aria-checked={chosen}
              tabIndex={focusable === position.value ? 0 : -1}
              disabled={disabled}
              onClick={() => onPick(position.value)}
              onKeyDown={(event) => move(event, index)}
              className={cn(
                // The border is always there, and the width is the button's, not the text's: the
                // states differ in colour only.
                'h-8 min-w-0 flex-1 truncate rounded-md border border-transparent px-2 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none',
                chosen
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : inherited
                    ? 'border-dashed border-muted-foreground/50 bg-background text-muted-foreground italic'
                    : 'text-muted-foreground hover:bg-background/70 hover:text-foreground',
                dimmed && 'opacity-50',
                disabled && !chosen && 'opacity-60',
              )}
            >
              {position.label}
            </button>
          )
        })}
      </div>
      {allowed && (
        <div className="flex min-w-0 items-center gap-1">
          <label className="flex min-w-0 cursor-pointer items-center gap-1.5 text-xs">
            <Checkbox
              checked={allowed.checked || allowed.muted}
              onCheckedChange={() => allowed.onToggle()}
              disabled={disabled}
              className={cn(
                allowed.muted &&
                  !allowed.checked &&
                  'border-dashed border-muted-foreground/60 data-checked:bg-muted data-checked:text-muted-foreground',
              )}
            />
            <span
              className={cn(
                'truncate',
                allowed.muted && !allowed.checked && 'text-muted-foreground italic',
              )}
            >
              {allowed.label}
            </span>
          </label>
          <InfoHelp label={allowed.label} compact>
            {allowed.help}
          </InfoHelp>
        </div>
      )}
      {/* Reserved, so that the control does not change size when the way back shows up. */}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={resetLabel}
        title={resetLabel}
        onClick={onReset}
        disabled={disabled}
        tabIndex={!isStated || disabled ? -1 : 0}
        className={cn('ml-auto shrink-0', (!isStated || disabled) && 'invisible')}
      >
        <RotateCcwIcon />
      </Button>
    </div>
  )
}
