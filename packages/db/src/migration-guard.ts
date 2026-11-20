import { readMigrationFiles } from 'drizzle-orm/migrator'

const UNKNOWN_MIGRATION = 'SEOTOOLS_UNKNOWN_MIGRATION'

export class UnknownMigrationError extends Error {
  readonly code = UNKNOWN_MIGRATION

  constructor() {
    super(
      'The database is newer than this image or has an unknown migration history. Refusing to start. Going back requires restoring the backup taken before updating, together with the previous image.',
    )
    this.name = 'UnknownMigrationError'
  }
}

/** A bundled caller and the database driver can load separate copies of the error class. */
export function isUnknownMigrationError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === UNKNOWN_MIGRATION
  )
}

/** Refuse unknown journal entries before migrations or data conversions can write anything. */
export function assertKnownMigrations(
  folder: string,
  rows: readonly { hash: string; created_at: number | string | null }[],
) {
  const known = readMigrationFiles({ migrationsFolder: folder })
  if (
    rows.some(
      (row) =>
        !known.some(
          (migration) =>
            migration.hash === row.hash && migration.folderMillis === Number(row.created_at),
        ),
    )
  ) {
    throw new UnknownMigrationError()
  }
}
