// Verifies the published entry points resolve from the packed tarball the way
// consumers resolve them: every `exports` subpath under Node's `require` and
// `import` conditions must land on a file in lib/module, and every `types`
// target must exist. Resolution only — the root export imports react-native
// and react-native-maps, which cannot run under Node — except for
// the subpaths with no React Native dependency, which are actually imported.
// The README's Usage example is type-checked against the published types of
// each entry that exports MapView, as an Expo app's tsconfig would check it.
//
// Expects lib/ to be built already (`bun run build`).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)
const manifest = JSON.parse(
  fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')
)
const NAME = manifest.name

// Subpaths safe to execute under plain Node, with one export each to check.
const IMPORTABLE = {
  './utils': 'packPoints',
  './geojson': 'isClusterFeature',
}

// Subpaths that export MapView, whose types must also give `Marker` the
// `cluster` prop. Each is type-checked in a program of its own, so one cannot
// lend the other its augmentation of react-native-maps.
const TYPED = ['.', './compat']

// What the type-checked example needs next to the package, as an app has it.
const TYPE_DEPENDENCIES = [
  ...Object.keys(manifest.peerDependencies),
  '@types/react',
]

// The first tsx block of the README's Usage section, with the `points` it maps
// and a `cluster` marker of its own, should the README drop its one.
function readmeUsageExample() {
  const readme = fs.readFileSync(path.join(packageRoot, '../README.md'), 'utf8')
  const example = /^## Usage\n[\s\S]*?^```tsx\n([\s\S]*?)^```/m.exec(readme)
  if (example == null) {
    console.error('README.md has no tsx example under "## Usage".')
    process.exit(1)
  }
  return `${example[1]}
declare const points: Array<{ id: string; latitude: number; longitude: number }>

export const optedOut = <Marker cluster={false} coordinate={{ latitude: 0, longitude: 0 }} />

// @ts-expect-error \`cluster\` takes a boolean, so the prop is not untyped.
export const wrongCluster = <Marker cluster="no" coordinate={{ latitude: 0, longitude: 0 }} />
`
}

// Where a package resolves from this checkout, hoisted or not.
function installedPackage(name) {
  for (let dir = packageRoot; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name)
    if (fs.existsSync(candidate)) {
      return fs.realpathSync(candidate)
    }
    if (path.dirname(dir) === dir) {
      return null
    }
  }
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
  execFileSync('tar', [
    '-xzf',
    path.join(workDir, tarball),
    '-C',
    installed,
    '--strip-components=1',
  ])

  const subpaths = Object.keys(manifest.exports).filter(
    (key) => key !== './package.json'
  )

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
  const result = JSON.parse(
    execFileSync('node', [probe], { cwd: workDir, encoding: 'utf8' })
  )

  const problems = []
  const realInstalled = fs.realpathSync(installed)
  for (const subpath of subpaths) {
    for (const [condition, file] of Object.entries(result.resolved[subpath])) {
      if (typeof file !== 'string') {
        problems.push(
          `${subpath} (${condition}) does not resolve: ${file.error}`
        )
        continue
      }
      if (!fs.existsSync(file)) {
        problems.push(
          `${subpath} (${condition}) resolves to a missing file: ${path.relative(realInstalled, file)}`
        )
        continue
      }
      const relative = path.relative(realInstalled, fs.realpathSync(file))
      if (!relative.startsWith(`lib${path.sep}module${path.sep}`)) {
        problems.push(
          `${subpath} (${condition}) resolved outside lib/module: ${relative}`
        )
      }
    }
    const types = manifest.exports[subpath].types
    if (!types || !fs.existsSync(path.join(installed, types))) {
      problems.push(
        `${subpath}: types target ${types} is missing from the tarball`
      )
    }
  }
  for (const [subpath, name] of Object.entries(IMPORTABLE)) {
    if (result.imported[subpath] !== 'function') {
      problems.push(
        `${subpath}: import() did not expose ${name} as a function (${result.imported[subpath]})`
      )
    }
  }
  for (const field of ['main', 'types']) {
    if (!fs.existsSync(path.join(installed, manifest[field]))) {
      problems.push(
        `package.json ${field} (${manifest[field]}) is missing from the tarball`
      )
    }
  }

  for (const name of TYPE_DEPENDENCIES) {
    const source = installedPackage(name)
    if (source == null) {
      problems.push(`${name} is not installed, so the types cannot be checked`)
      continue
    }
    const target = path.join(workDir, 'node_modules', name)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.symlinkSync(source, target, 'dir')
  }
  const tsc = path.join(installedPackage('typescript'), 'bin', 'tsc')
  const typesDir = path.join(workDir, 'types')
  fs.mkdirSync(typesDir)
  // expo/tsconfig.base, plus the `strict` of Expo's app templates.
  const compilerOptions = {
    allowJs: true,
    esModuleInterop: true,
    jsx: 'react-jsx',
    lib: ['DOM', 'ESNext'],
    module: 'preserve',
    moduleDetection: 'force',
    moduleResolution: 'bundler',
    customConditions: ['react-native'],
    noEmit: true,
    resolveJsonModule: true,
    skipLibCheck: true,
    strict: true,
    target: 'ESNext',
    types: [],
  }
  const example = readmeUsageExample()
  for (const subpath of TYPED) {
    const entry = subpath === '.' ? 'root' : subpath.slice(2)
    fs.writeFileSync(
      path.join(typesDir, `${entry}.tsx`),
      example.replaceAll(`from '${NAME}'`, `from '${NAME}${subpath.slice(1)}'`)
    )
    const project = path.join(typesDir, `${entry}.tsconfig.json`)
    fs.writeFileSync(
      project,
      JSON.stringify({ compilerOptions, files: [`${entry}.tsx`] })
    )
    try {
      execFileSync(process.execPath, [tsc, '-p', project], {
        cwd: typesDir,
        encoding: 'utf8',
      })
    } catch (error) {
      problems.push(
        `${subpath}: the README's Usage example does not type-check:\n${error.stdout}`
      )
    }
  }

  if (problems.length > 0) {
    console.error(
      `exports verification failed (${problems.length} problem(s)):`
    )
    for (const problem of problems) {
      console.error(`  - ${problem}`)
    }
    process.exit(1)
  }
  console.log(
    `exports OK: ${subpaths.length} subpaths resolve under require and import; ${Object.keys(IMPORTABLE).length} imported under Node; ${TYPED.length} type-check the README's Usage example`
  )
} finally {
  fs.rmSync(workDir, { recursive: true, force: true })
}
