// Verifies the published entry points resolve from the packed tarball the way
// consumers resolve them: every `exports` subpath under Node's `require` and
// `import` conditions must land on a file in lib/module, and every `types`
// target must exist. Resolution only — the root export imports react-native,
// react-native-maps and Reanimated, which cannot run under Node — except for
// the subpaths with no React Native dependency, which are actually imported.
//
// Expects lib/ to be built already (`bun run build`).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))
const NAME = manifest.name

// Subpaths safe to execute under plain Node, with one export each to check.
const IMPORTABLE = {
  './utils': 'packPoints',
  './geojson': 'isClusterFeature',
}

if (!fs.existsSync(path.join(packageRoot, 'lib/module/index.js'))) {
  console.error('lib/ is missing — run `bun run build` first.')
  process.exit(1)
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-exports-'))
try {
  const tarball = execFileSync(
    'npm',
    ['pack', '--ignore-scripts', '--silent', '--pack-destination', workDir],
    { cwd: packageRoot, encoding: 'utf8' }
  )
    .trim()
    .split('\n')
    .pop()

  const installed = path.join(workDir, 'node_modules', NAME)
  fs.mkdirSync(installed, { recursive: true })
  execFileSync('tar', ['-xzf', path.join(workDir, tarball), '-C', installed, '--strip-components=1'])

  const subpaths = Object.keys(manifest.exports).filter((key) => key !== './package.json')

  // A probe module inside the temp project, so both resolvers see the tarball
  // exactly as an app's node_modules would.
  const probe = path.join(workDir, 'probe.mjs')
  fs.writeFileSync(
    probe,
    `import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const subpaths = ${JSON.stringify(subpaths)}
const importable = ${JSON.stringify(IMPORTABLE)}
const out = { resolved: {}, imported: {} }
const attempt = (fn) => {
  try {
    return fn()
  } catch (error) {
    return { error: String(error.message).split('\\n')[0] }
  }
}
for (const subpath of subpaths) {
  const specifier = ${JSON.stringify(NAME)} + subpath.slice(1)
  out.resolved[subpath] = {
    require: attempt(() => require.resolve(specifier)),
    import: attempt(() => fileURLToPath(import.meta.resolve(specifier))),
  }
}
for (const [subpath, name] of Object.entries(importable)) {
  try {
    const mod = await import(${JSON.stringify(NAME)} + subpath.slice(1))
    out.imported[subpath] = typeof mod[name]
  } catch (error) {
    out.imported[subpath] = 'error: ' + String(error.message).split('\\n')[0]
  }
}
console.log(JSON.stringify(out))
`
  )
  const result = JSON.parse(execFileSync('node', [probe], { cwd: workDir, encoding: 'utf8' }))

  const problems = []
  const realInstalled = fs.realpathSync(installed)
  for (const subpath of subpaths) {
    for (const [condition, file] of Object.entries(result.resolved[subpath])) {
      if (typeof file !== 'string') {
        problems.push(`${subpath} (${condition}) does not resolve: ${file.error}`)
        continue
      }
      if (!fs.existsSync(file)) {
        problems.push(`${subpath} (${condition}) resolves to a missing file: ${path.relative(realInstalled, file)}`)
        continue
      }
      const relative = path.relative(realInstalled, fs.realpathSync(file))
      if (!relative.startsWith(`lib${path.sep}module${path.sep}`)) {
        problems.push(`${subpath} (${condition}) resolved outside lib/module: ${relative}`)
      }
    }
    const types = manifest.exports[subpath].types
    if (!types || !fs.existsSync(path.join(installed, types))) {
      problems.push(`${subpath}: types target ${types} is missing from the tarball`)
    }
  }
  for (const [subpath, name] of Object.entries(IMPORTABLE)) {
    if (result.imported[subpath] !== 'function') {
      problems.push(`${subpath}: import() did not expose ${name} as a function (${result.imported[subpath]})`)
    }
  }
  for (const field of ['main', 'types']) {
    if (!fs.existsSync(path.join(installed, manifest[field]))) {
      problems.push(`package.json ${field} (${manifest[field]}) is missing from the tarball`)
    }
  }

  if (problems.length > 0) {
    console.error(`exports verification failed (${problems.length} problem(s)):`)
    for (const problem of problems) {
      console.error(`  - ${problem}`)
    }
    process.exit(1)
  }
  console.log(
    `exports OK: ${subpaths.length} subpaths resolve under require and import; ${Object.keys(IMPORTABLE).length} imported under Node`
  )
} finally {
  fs.rmSync(workDir, { recursive: true, force: true })
}
