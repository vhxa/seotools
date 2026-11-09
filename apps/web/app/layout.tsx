import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Geist } from 'next/font/google'
import { headers } from 'next/headers'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale } from 'next-intl/server'
import { cn } from '@/lib/utils'
import './globals.css'

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' })

/** A private tool: nothing of it belongs in a search engine (see also `robots.ts`, `X-Robots-Tag`). */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [locale, requestHeaders] = await Promise.all([getLocale(), headers()])
  // Made per request by `proxy.ts`: the Content-Security-Policy lets only this inline script run.
  const nonce = requestHeaders.get('x-nonce') ?? undefined
  return (
    <html suppressHydrationWarning lang={locale} className={cn('font-sans', geist.variable)}>
      <head>
        <script
          nonce={nonce}
          // Browsers hide a nonce from the DOM once read, so the client never sees the same value.
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `try{const t=localStorage.getItem('seotools-theme');document.documentElement.classList.toggle('dark',t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches))}catch{}`,
          }}
        />
      </head>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  )
}
