import { EnvError, parseWorkerEnv, setPasswordLink } from '@seotools/core'
import { createDatabase, recoverAdminAccess } from '@seotools/db'

/**
 * Gets someone back in when nobody can sign in and email does not work, from the command line of the
 * installation: makes the account an active administrator and prints a link to set its password.
 * The link goes to the operator's terminal, never to the logs of the running app.
 *
 *   node worker/dist/recover.mjs person@example.com
 */
const email = process.argv[2]
if (!email) {
  console.error('Usage: recover.mjs <email of an existing account>')
  process.exit(2)
}

try {
  const env = parseWorkerEnv()
  const db = await createDatabase({ url: env.DATABASE_URL, dialect: env.DATABASE_DIALECT })
  try {
    await db.checkMigrations()
    const recovered = await recoverAdminAccess(db, { email })
    if (!recovered) {
      console.error(`There is no account with that email. Nothing was changed.`)
      process.exit(1)
    }
    const path = setPasswordLink(env.BETTER_AUTH_URL ?? '', recovered.token)
    console.log(`${recovered.user.email} is now an active administrator.`)
    console.log(`Set its password within 24 hours, once, at:\n${path}`)
    if (!env.BETTER_AUTH_URL) console.log('(Prefix it with the address of the app.)')
  } finally {
    await db.close()
  }
} catch (error) {
  console.error(error instanceof EnvError ? error.message : error)
  process.exit(1)
}
