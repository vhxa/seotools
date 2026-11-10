import { z } from 'zod'

/**
 * The one way core imports zod. In a browser zod is told not to compile parsers with `new Function`:
 * the app's Content-Security-Policy forbids `eval`, and zod's probe for it, although caught, is
 * reported as a policy violation. The server keeps the faster compiled parsers.
 *
 * Imported before any schema is made (ES modules run their imports first), so the setting is in
 * place when the first `z.object` asks whether it may compile.
 */
if ('window' in globalThis) z.config({ jitless: true })

export { z }
