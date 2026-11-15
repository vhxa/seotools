import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    bootstrap: 'src/bootstrap.ts',
    recover: 'src/recover.ts',
    'migrate-db': 'src/migrate-db.ts',
  },
  format: 'esm',
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  clean: true,
  // Everything is bundled (workspace TS packages included) except the dependencies declared in
  // package.json — `better-sqlite3` and the lazily loaded `puppeteer-core`, which is installed next to the bundle.
  deps: { alwaysBundle: [/^@seotools\//], onlyBundle: false },
})
