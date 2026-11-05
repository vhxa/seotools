import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { index: 'src/index.ts', bootstrap: 'src/bootstrap.ts', recover: 'src/recover.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  clean: true,
  // Everything is bundled (workspace TS packages included) except the dependencies declared in
  // package.json — only the native `better-sqlite3`, which is installed next to the bundle.
  deps: { alwaysBundle: [/^@seotools\//], onlyBundle: false },
})
