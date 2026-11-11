'use client'
import { useTranslations } from 'next-intl'
import {
  toggleIgnoredParameterAction,
  type ActionState,
} from '@/app/(protected)/domains/[host]/actions'
import { useCanEdit } from '@/components/domain-access'
import { Button } from '@/components/ui/button'
import { useFormActionState } from '@/hooks/use-form-action-state'
export function ParameterToggle({
  host,
  name,
  ignored,
}: {
  host: string
  name: string
  ignored: boolean
}) {
  const t = useTranslations('Parameters')
  const canEdit = useCanEdit()
  const [state, onSubmit, pending] = useFormActionState<ActionState>(
    toggleIgnoredParameterAction.bind(null, host, name),
    {},
  )
  if (!canEdit) return null
  return (
    <form onSubmit={onSubmit}>
      <Button size="sm" variant="outline" disabled={pending}>
        {t(ignored ? 'stopIgnoring' : 'ignore')}
      </Button>
      {state.error && <p role="alert">{state.error}</p>}
    </form>
  )
}
