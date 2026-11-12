import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** `E2E_PORT` moves the suite to another port (and another database folder) when 3210 is taken. */
export const PORT = Number(process.env.E2E_PORT ?? 3210)
export const BASE_URL = `http://localhost:${PORT}`
/** A fresh folder per run: the database lives and dies here, never in `/data`. */
export const WORK_DIR = join(tmpdir(), `seotools-e2e-${PORT}`)
export const DB_FILE = join(WORK_DIR, 'seotools.db')
export const ADMIN_STATE = join(WORK_DIR, 'admin-state.json')
export const VIEWER_STATE = join(WORK_DIR, 'viewer-state.json')
export const DATABASE_URL = `file:${DB_FILE}`
export const AUTH_SECRET = 'e2e-secret-e2e-secret-e2e-secret-e2e-secret'

export const HOST = 'example.com'
export const OTHER_HOST = 'other.example'

export const ADMIN = {
  name: 'Ada Admin',
  email: 'ada@acme.test',
  password: 'a-long-admin-password',
}
export const VIEWER = {
  name: 'Vic Viewer',
  email: 'vic@acme.test',
  password: 'a-long-viewer-password',
}
