'use client'

/**
 * Last resort: it replaces the root layout when that throws, so there is no `next-intl` provider
 * and no stylesheet to rely on. It reads the language from the browser and picks from this tiny
 * map instead, and styles itself inline. It shows only the digest, never the message or stack.
 */
const COPY = {
  en: {
    title: 'Something went wrong',
    description:
      'The application could not be shown. Try again; if it keeps failing, check the server logs.',
    reference: 'Reference',
    retry: 'Try again',
  },
  es: {
    title: 'Algo ha ido mal',
    description:
      'No se ha podido mostrar la aplicación. Inténtalo de nuevo; si sigue fallando, revisa los registros del servidor.',
    reference: 'Referencia',
    retry: 'Reintentar',
  },
} as const

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const language = typeof navigator === 'undefined' ? 'en' : navigator.language
  const lang = language.toLowerCase().startsWith('es') ? 'es' : 'en'
  const copy = COPY[lang]
  return (
    <html lang={lang}>
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          display: 'grid',
          placeItems: 'center',
          minHeight: '100vh',
          margin: 0,
          padding: 16,
          textAlign: 'center',
        }}
      >
        <main>
          <h1 style={{ fontSize: 24 }}>{copy.title}</h1>
          <p style={{ maxWidth: 480 }}>{copy.description}</p>
          {error.digest && (
            <p style={{ fontSize: 12, opacity: 0.7 }}>
              {copy.reference}: {error.digest}
            </p>
          )}
          <button type="button" onClick={() => reset()} style={{ padding: '8px 16px' }}>
            {copy.retry}
          </button>
        </main>
      </body>
    </html>
  )
}
