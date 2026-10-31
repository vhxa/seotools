// Docker HEALTHCHECK. In "all" mode the worker must be alive too, so the container is marked
// unhealthy (and restarted by most orchestrators) if jobs stopped being processed.
const mode = process.env.SEOTOOLS_MODE ?? 'all'
if (mode === 'worker' || mode === 'migrate') process.exit(0) // no HTTP server to probe

const port = process.env.PORT || '3000'
const query = mode === 'all' ? '?require=worker' : ''

try {
  const res = await fetch(`http://127.0.0.1:${port}/api/health${query}`, {
    signal: AbortSignal.timeout(4000),
  })
  process.exit(res.ok ? 0 : 1)
} catch {
  process.exit(1)
}
