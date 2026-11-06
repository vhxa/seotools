'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { DropdownMenuGroup, DropdownMenuItem } from '@/components/ui/dropdown-menu'

function applyTheme(theme: string) {
  document.documentElement.classList.toggle(
    'dark',
    theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches),
  )
}

export function ThemeChoices() {
  const t = useTranslations('Common.theme')
  useEffect(() => {
    const update = () => {
      let theme = 'system'
      try {
        theme = localStorage.getItem('seotools-theme') ?? 'system'
      } catch {
        /* Storage can be unavailable in private browsing. */
      }
      applyTheme(theme)
    }
    const media = matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', update)
    window.addEventListener('storage', update)
    return () => {
      media.removeEventListener('change', update)
      window.removeEventListener('storage', update)
    }
  }, [])
  return (
    <DropdownMenuGroup>
      {(['system', 'light', 'dark'] as const).map((theme) => (
        <DropdownMenuItem
          key={theme}
          onClick={() => {
            try {
              localStorage.setItem('seotools-theme', theme)
            } catch {
              /* Storage can be unavailable in private browsing. */
            }
            applyTheme(theme)
          }}
        >
          {t(theme)}
        </DropdownMenuItem>
      ))}
    </DropdownMenuGroup>
  )
}
