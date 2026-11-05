/**
 * The emails that give someone a link to set their password. The worker sends them, away from the
 * web app's message catalogs, so their copy lives here in the same two languages; a test keeps both
 * with the same keys.
 */
export const ACCESS_EMAIL_COPY = {
  en: {
    invite: {
      subject: 'You have been invited to seotools',
      intro: 'You have an account on seotools. Choose a password to start using it:',
      expires: 'This link works once, for {hours} hours.',
    },
    reset: {
      subject: 'Reset your seotools password',
      intro: 'Someone asked to reset the password of your seotools account. To choose a new one:',
      expires:
        'This link works once, for {hours} hours. If it was not you, you can ignore this email: your password has not changed.',
    },
  },
  es: {
    invite: {
      subject: 'Te han invitado a seotools',
      intro: 'Tienes una cuenta en seotools. Elige una contraseña para empezar a usarla:',
      expires: 'Este enlace funciona una vez, durante {hours} horas.',
    },
    reset: {
      subject: 'Restablece tu contraseña de seotools',
      intro:
        'Alguien ha pedido restablecer la contraseña de tu cuenta de seotools. Para elegir una nueva:',
      expires:
        'Este enlace funciona una vez, durante {hours} horas. Si no has sido tú, puedes ignorar este correo: tu contraseña no ha cambiado.',
    },
  },
} as const

export type AccessEmailLocale = keyof typeof ACCESS_EMAIL_COPY
export type AccessEmailKind = keyof (typeof ACCESS_EMAIL_COPY)['en']

export function accessEmail(input: {
  kind: AccessEmailKind
  locale: AccessEmailLocale
  link: string
  ttlMs: number
}): { subject: string; text: string } {
  const copy = ACCESS_EMAIL_COPY[input.locale][input.kind]
  const hours = Math.round(input.ttlMs / (60 * 60_000))
  return {
    subject: copy.subject,
    text: `${copy.intro}\n\n${input.link}\n\n${copy.expires.replace('{hours}', String(hours))}\n`,
  }
}

/** The address of the page that sets a password, for a token. */
export const setPasswordLink = (publicUrl: string, token: string) =>
  `${publicUrl.replace(/\/$/, '')}/set-password?token=${encodeURIComponent(token)}`
