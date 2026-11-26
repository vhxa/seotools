'use client'

import { useId } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import { InfoHelp } from '@/components/help'
import { Slider } from '@/components/ui/slider'

interface NumericSliderProps {
  name: string
  label: string
  hint?: string
  value: number | null
  onChange: (value: number | null) => void
  min: number
  max: number
  /** Ordered stops for a stepped scale. The actual value is submitted. */
  stops?: number[]
  unlimited?: boolean
  disabled?: boolean
  display?: (value: number) => string
}

export function NumericSlider({
  name,
  label,
  hint,
  value,
  onChange,
  min,
  max,
  stops,
  unlimited = false,
  disabled = false,
  display,
}: NumericSliderProps) {
  const format = useFormatter()
  const t = useTranslations('Capacity')
  const labelId = useId()
  const positionMin = stops ? 0 : min
  const positionMax = (stops ? stops.length - 1 : max) + Number(unlimited)
  const position = value === null ? positionMax : (stops?.indexOf(value) ?? value)
  const valueAt = (n: number) => {
    if (unlimited && n === positionMax) return null
    return stops?.[n] ?? n
  }
  const displayValue = (n: number | null) =>
    n === null ? t('noLimit') : (display?.(n) ?? format.number(n))

  return (
    <div className="grid min-w-0 content-start gap-2">
      <div className="flex min-h-6 items-center gap-1">
        <span id={labelId} className="text-sm font-medium">
          {label}
        </span>
        {hint && (
          <InfoHelp label={label} compact>
            {hint}
          </InfoHelp>
        )}
        <span className="ml-auto shrink-0 text-sm font-medium tabular-nums">
          {displayValue(value)}
        </span>
      </div>
      <Slider
        aria-labelledby={labelId}
        getAriaValueText={(_, n) => displayValue(valueAt(n))}
        className="flex min-h-6 items-center"
        min={positionMin}
        max={positionMax}
        value={[position]}
        disabled={disabled}
        onValueChange={(values) => {
          const next = Array.isArray(values) ? values[0] : values
          if (typeof next === 'number') onChange(valueAt(next))
        }}
      />
      <input type="hidden" name={name} value={value ?? ''} disabled={disabled} />
    </div>
  )
}
