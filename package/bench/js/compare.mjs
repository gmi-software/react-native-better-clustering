// Compares two JS-path benchmark reports (run.mjs output) and prints a Markdown
// summary. Exits 1 only when an operation became more than twice as slow.
//
//   node bench/js/compare.mjs base.json head.json [--out summary.md]
//   node bench/js/compare.mjs base1.json,base2.json head1.json,head2.json
//
// Several reports per side, from runs interleaved base, head, base, head, are
// merged by keeping each operation's fastest median and fastest sample: what
// a busy runner adds to one run, it rarely adds to all of them.
//
// Wall time on a shared runner, in V8 rather than Hermes, is too noisy and too
// far from a phone to gate on small changes. So the gate:
// - covers cases with at least GATE_MIN_SIZE points;
// - fails when both the median and the fastest sample are more than FAIL_RATIO
//   times the base's, warns above WARN_RATIO;
// - never gates the `reference:` operations, which measure supercluster.
import fs from 'node:fs'

const GATE_MIN_SIZE = 10_000
const FAIL_RATIO = 2
const WARN_RATIO = 1.5
const MARKER = '<!-- cluster-bench-js -->'

function parseArgs(argv) {
  const files = []
  let out = null
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out = argv[++i]
    else files.push(argv[i])
  }
  if (files.length !== 2 || out === undefined) {
    console.error(
      'usage: node bench/js/compare.mjs base.json[,…] head.json[,…] [--out summary.md]'
    )
    process.exit(2)
  }
  return { basePath: files[0], headPath: files[1], out }
}

function readReport(file) {
  const report = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (report.kind !== 'js' || report.schemaVersion !== 1) {
    throw new Error(`${file} is not a JS-path benchmark report`)
  }
  return report
}

function readReports(files) {
  const [first, ...rest] = files.split(',').map(readReport)
  for (const report of rest) {
    for (const reportCase of report.cases) {
      const merged = first.cases.find(
        (c) => c.dataset === reportCase.dataset && c.size === reportCase.size
      )
      if (!merged) continue
      for (const [name, op] of Object.entries(reportCase.operations)) {
        const target = merged.operations[name]
        if (!target) continue
        target.medianNs = Math.min(target.medianNs, op.medianNs)
        target.minNs = Math.min(target.minNs, op.minNs)
      }
    }
  }
  return first
}

function formatMs(ns) {
  return `${(ns / 1e6).toFixed(ns < 1e6 ? 3 : 2)} ms`
}

function formatRatio(ratio) {
  return `${ratio.toFixed(2)}×`
}

function compare(base, head) {
  const rows = []
  const failures = []
  const warnings = []
  for (const headCase of head.cases) {
    const baseCase = base.cases.find(
      (c) => c.dataset === headCase.dataset && c.size === headCase.size
    )
    for (const [name, headOp] of Object.entries(headCase.operations)) {
      const baseOp = baseCase?.operations[name]
      const row = {
        label: `${headCase.dataset} ${headCase.size} ${name}`,
        base: baseOp?.medianNs,
        head: headOp.medianNs,
        ratio: baseOp ? headOp.medianNs / baseOp.medianNs : null,
        status: '',
      }
      if (baseOp) {
        const gated =
          headCase.size >= GATE_MIN_SIZE && !name.startsWith('reference:')
        const minRatio = headOp.minNs / baseOp.minNs
        if (gated && row.ratio > FAIL_RATIO && minRatio > FAIL_RATIO) {
          row.status = '❌'
          failures.push(row)
        } else if (gated && row.ratio > WARN_RATIO) {
          row.status = '⚠️'
          warnings.push(row)
        } else if (!gated) {
          row.status = 'not gated'
        }
      } else {
        row.status = 'new'
      }
      rows.push(row)
    }
  }
  return { rows, failures, warnings }
}

function summarize(base, head, { rows, failures, warnings }) {
  const lines = [MARKER, '## JS-path benchmark', '']
  if (failures.length > 0) {
    lines.push(
      `**${failures.length} operation(s) became more than ${FAIL_RATIO}× slower.**`
    )
  } else {
    lines.push(`No operation became more than ${FAIL_RATIO}× slower.`)
  }
  if (warnings.length > 0) {
    lines.push(
      `${warnings.length} operation(s) slowed down by more than ${Math.round((WARN_RATIO - 1) * 100)}%, which shared runners can cause on their own.`
    )
  }
  lines.push(
    '',
    `Median wall time per call in Node ${head.environment.node} (V8, not Hermes), on ${head.environment.cpu}. Gated from ${GATE_MIN_SIZE.toLocaleString('en-US')} points; \`reference:\` rows measure supercluster and are never gated.`,
    '',
    '| Case | Base | Head | Ratio | |',
    '| --- | ---: | ---: | ---: | --- |'
  )
  for (const row of rows) {
    lines.push(
      `| ${row.label} | ${row.base == null ? '—' : formatMs(row.base)} | ${formatMs(row.head)} | ${row.ratio == null ? '—' : formatRatio(row.ratio)} | ${row.status} |`
    )
  }
  if (base.environment.cpu !== head.environment.cpu) {
    lines.push(
      '',
      `The two reports come from different CPUs (${base.environment.cpu}, ${head.environment.cpu}), so the ratios mean little.`
    )
  }
  return `${lines.join('\n')}\n`
}

const { basePath, headPath, out } = parseArgs(process.argv.slice(2))
const base = readReports(basePath)
const head = readReports(headPath)
const result = compare(base, head)
const summary = summarize(base, head, result)
if (out) fs.writeFileSync(out, summary)
process.stdout.write(summary)
process.exit(result.failures.length > 0 ? 1 : 0)
