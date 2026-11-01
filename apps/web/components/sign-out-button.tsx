'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth-client'

export function SignOutButton() {
  const router = useRouter()
  const t = useTranslations('Common')
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        await authClient.signOut()
        router.push('/login')
        router.refresh()
      }}
    >
      {t('signOut')}
    </Button>
  )
}
