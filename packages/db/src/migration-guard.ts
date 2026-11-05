import { readMigrationFiles } from 'drizzle-orm/migrator'

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
    throw new Error(
      'The database is newer than this image or has an unknown migration history. Refusing to start. Going back requires restoring the backup taken before updating, together with the previous image.',
    )
  }
}
