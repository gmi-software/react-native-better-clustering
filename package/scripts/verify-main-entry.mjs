import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const srcRoot = path.join(__dirname, '..', 'src')
const entry = path.join(srcRoot, 'index.ts')

const FORBIDDEN_SPECIFIERS = ['@gorhom/bottom-sheet', './picker', '../picker']
const FORBIDDEN_PATH_PREFIXES = ['picker' + path.sep, 'picker/']

/** @param {string} fromFile @param {string} spec */
function resolveImport(fromFile, spec) {
  if (!spec.startsWith('.')) {
    return null
  }
  const base = path.resolve(path.dirname(fromFile), spec)
  for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
    const candidate = base + ext
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate
    }
  }
  return null
}

/** @param {string} file @param {Set<string>} visited @param {string[]} violations */
function scan(file, visited, violations) {
  const rel = path.relative(srcRoot, file)
  if (visited.has(rel)) {
    return
  }
  visited.add(rel)

  if (FORBIDDEN_PATH_PREFIXES.some((prefix) => rel.startsWith(prefix))) {
    violations.push(`main entry graph reaches picker module: ${rel}`)
  }

  const text = fs.readFileSync(file, 'utf8')
  for (const match of text.matchAll(/from ['"]([^'"]+)['"]/g)) {
    const spec = match[1]
    if (FORBIDDEN_SPECIFIERS.some((bad) => spec === bad || spec.includes('/picker'))) {
      violations.push(`${spec} imported from ${rel}`)
    }
    const resolved = resolveImport(file, spec)
    if (resolved?.startsWith(srcRoot)) {
      scan(resolved, visited, violations)
    }
  }
}

const barrel = fs.readFileSync(entry, 'utf8')
const barrelViolations = []

if (barrel.includes('./picker') || barrel.includes('MapPointPicker')) {
  barrelViolations.push('src/index.ts must not re-export picker')
}
const visited = new Set()
const graphViolations = []
scan(entry, visited, graphViolations)

const violations = [...barrelViolations, ...graphViolations]

if (violations.length > 0) {
  console.error('Main entry isolation check failed:')
  for (const violation of violations) {
    console.error(`  - ${violation}`)
  }
  process.exit(1)
}

console.log(
  `Main entry OK (${visited.size} modules, no picker or @gorhom/bottom-sheet in graph)`
)
