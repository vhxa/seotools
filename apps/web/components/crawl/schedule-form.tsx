'use client'

import type { CrawlType } from '@seotools/core'
import { CRAWL_FREQUENCIES, type CrawlFrequency } from '@seotools/core/crawl/schedule'
import { useTranslations } from 'next-intl'
import { useState, useSyncExternalStore } from 'react'
import { saveScheduleAction, type ActionState } from '@/app/(protected)/domains/[host]/actions'
import { useCanEdit } from '@/components/domain-access'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useFormActionState } from '@/hooks/use-form-action-state'

export interface ScheduleFormValues {
  enabled: boolean
  frequency: CrawlFrequency
  /** `HH:MM`. */
  time: string
  dayOfWeek: number
  dayOfMonth: number
  /** The zone it was saved with. A schedule never saved takes the zone of the browser. */
  timeZone: string | null
}

const noSubscription = () => () => {}
const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone
const serverTimeZone = () => 'UTC'

// January 4th, 2026 was a Sunday: formatting that week gives the weekday names of the locale.
const weekdayNames = (locale: string) =>
  Array.from({ length: 7 }, (_, day) =>
    new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2026, 0, 4 + day)),
    ),
  )

function FormSelect({
  id,
  name,
  items,
  value,
  onChange,
  disabled,
}: {
  id: string
  name: string
  items: { value: string; label: string }[]
  value: string
  onChange: (value: string) => void
  disabled: boolean
}) {
  return (
    <Select
      name={name}
      items={items}
      value={value}
      disabled={disabled}
      onValueChange={(next) => next !== null && onChange(next)}
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function ScheduleForm({
  host,
  type,
  locale,
  values,
}: {
  host: string
  type: CrawlType
  locale: string
  values: ScheduleFormValues
}) {
  const t = useTranslations('Jobs.schedule')
  const canEdit = useCanEdit()
  const [state, onSubmit, pending] = useFormActionState<ActionState>(
    saveScheduleAction.bind(null, host, type),
    {},
  )
  // Controlled: the frequency decides which fields are shown.
  const [enabled, setEnabled] = useState(values.enabled)
  const [frequency, setFrequency] = useState<string>(values.frequency)
  const [dayOfWeek, setDayOfWeek] = useState(String(values.dayOfWeek))
  const [dayOfMonth, setDayOfMonth] = useState(String(values.dayOfMonth))
  const [time, setTime] = useState(values.time)
  const detected = useSyncExternalStore(noSubscription, browserTimeZone, serverTimeZone)
  const [chosenZone, setChosenZone] = useState<string | null>(values.timeZone)
  const timeZone = chosenZone ?? detected
  const id = (name: string) => `${type}-${name}`

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <div className="flex items-center gap-2">
        <Switch
          id={id('enabled')}
          name="enabled"
          checked={enabled}
          disabled={!canEdit}
          onCheckedChange={setEnabled}
        />
        <Label htmlFor={id('enabled')}>{t('enabled')}</Label>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="grid gap-2">
          <Label htmlFor={id('frequency')}>{t('frequency')}</Label>
          <FormSelect
            id={id('frequency')}
            name="frequency"
            value={frequency}
            disabled={!canEdit}
            onChange={setFrequency}
            items={CRAWL_FREQUENCIES.map((value) => ({
              value,
              label: t(`frequencies.${value}`),
            }))}
          />
        </div>
        {frequency === 'weekly' && (
          <div className="grid gap-2">
            <Label htmlFor={id('dayOfWeek')}>{t('dayOfWeek')}</Label>
            <FormSelect
              id={id('dayOfWeek')}
              name="dayOfWeek"
              value={dayOfWeek}
              disabled={!canEdit}
              onChange={setDayOfWeek}
              items={weekdayNames(locale).map((label, day) => ({ value: String(day), label }))}
            />
          </div>
        )}
        {frequency === 'monthly' && (
          <div className="grid gap-2">
            <Label htmlFor={id('dayOfMonth')}>{t('dayOfMonth')}</Label>
            <FormSelect
              id={id('dayOfMonth')}
              name="dayOfMonth"
              value={dayOfMonth}
              disabled={!canEdit}
              onChange={setDayOfMonth}
              items={Array.from({ length: 28 }, (_, i) => ({
                value: String(i + 1),
                label: String(i + 1),
              }))}
            />
          </div>
        )}
        <div className="grid gap-2">
          <Label htmlFor={id('time')}>{t(frequency === 'hourly' ? 'minuteOfHour' : 'time')}</Label>
          <Input
            id={id('time')}
            name="time"
            type="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            disabled={!canEdit}
            required
          />
        </div>
      </div>
      {/* Not every frequency shows these, but the form always needs a valid value for them. */}
      {frequency !== 'weekly' && <input type="hidden" name="dayOfWeek" value={dayOfWeek} />}
      {frequency !== 'monthly' && <input type="hidden" name="dayOfMonth" value={dayOfMonth} />}
      <div className="grid gap-2">
        <Label htmlFor={id('timeZone')}>{t('timeZone')}</Label>
        <Input
          id={id('timeZone')}
          name="timeZone"
          value={timeZone}
          onChange={(event) => setChosenZone(event.target.value)}
          disabled={!canEdit}
          list={id('zones')}
          required
          maxLength={100}
        />
        <datalist id={id('zones')}>
          {['UTC', ...Intl.supportedValuesOf('timeZone')].map((zone) => (
            <option key={zone} value={zone} />
          ))}
        </datalist>
      </div>
      <p className="text-xs text-muted-foreground">
        {t(frequency === 'hourly' ? 'hourlyHint' : 'timeZoneHint', { timeZone })}
      </p>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {canEdit && (
        <div className="flex items-center gap-3">
          <Button type="submit" variant="outline" disabled={pending}>
            {t('save')}
          </Button>
          {state.saved && !pending && (
            <p role="status" className="text-sm text-muted-foreground">
              {t('saved')}
            </p>
          )}
        </div>
      )}
    </form>
  )
}
