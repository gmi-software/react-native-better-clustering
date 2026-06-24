import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.join(__dirname, '..')

const requiredOutputs = [
  'lib/index.js',
  'lib/index.d.ts',
  'lib/compat/index.js',
  'lib/compat/index.d.ts',
  'lib/hooks/index.js',
  'lib/hooks/index.d.ts',
  'lib/engine/index.js',
  'lib/engine/index.d.ts',
]

const missing = requiredOutputs.filter(
  (rel) => !fs.existsSync(path.join(packageRoot, rel))
)

if (missing.length > 0) {
  console.error('Build verification failed — missing compiled outputs:')
  for (const file of missing) {
    console.error(`  - ${file}`)
  }
  console.error('Run: bun run build')
  process.exit(1)
}

console.log(`Build OK (${requiredOutputs.length} required lib/ outputs present)`)
