import postgres from 'postgres'
import { createDatabase } from './client'
import { describeDatabaseContract } from './test/contract'

const url = process.env.TEST_POSTGRES_URL

describeDatabaseContract(
  'postgres',
  async () => {
    const db = await createDatabase({ url: url!, dialect: 'pg' })
    await db.migrate()
    const sql = postgres(url!, { max: 1, onnotice: () => {} })
    return {
      db,
      reset: async () => {
        await sql`truncate table jobs, worker_heartbeats, settings, "user" cascade`
      },
    }
  },
  { skip: !url },
)
