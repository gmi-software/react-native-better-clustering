// Compares two core benchmark reports (run.mjs output) and prints a Markdown
// summary. Exits 1 when a gated metric regresses past its threshold.
//
//   node bench/compare.mjs base.json head.json [--out summary.md]
//
// The gate (README.md in this directory explains the choices):
// - covers cases with at least GATE_MIN_SIZE points;
// - fails above +5% instructions or +10% allocations / engine memory, warns
//   above +2%, per operation;
// - ignores changes smaller than an absolute floor, so a few instructions on a
//   query that returns nothing never fail a pull request;
// - never gates on wall time or peak RSS, which shared runners make noisy;
// - compares nothing when the two reports were measured with different engine
//   configurations or viewports.
import fs from 'node:fs'

const GATE_MIN_SIZE = 10_000

const METRICS = [
  {
    key: 'instructions',
    label: 'instructions',
    fail: 0.05,
    warn: 0.02,
    floor: 10_000,
  },
  {
    key: 'allocationCount',
    label: 'allocations',
    fail: 0.1,
    warn: 0.02,
    floor: 16,
  },
  {
    key: 'allocationBytes',
    label: 'allocated bytes',
    fail: 0.1,
    warn: 0.02,
    floor: 64 * 1024,
  },
]

const MEMORY_METRIC = {
  key: 'memorySize',
  label: 'engine memory',
  fail: 0.1,
  warn: 0.02,
  floor: 64 * 1024,
}

const MARKER = '<!-- cluster-bench-core -->'

// The summary doubles as a pull request comment, which GitHub caps at 65,536
// characters. Long lists are cut, and past this length the per-case table is
// left out; the full numbers are in the reports.
const MAX_TABLE_ROWS = 50
const MAX_LISTED_CHANGES = 20
const MAX_MARKDOWN_LENGTH = 60_000

function classify(metric, base, head) {
  if (base == null || head == null) return null
  const delta = head - base
  const ratio = base === 0 ? (head === 0 ? 0 : Infinity) : delta / base
  let level = 'ok'
  if (Math.abs(delta) >= metric.floor) {
    if (ratio > metric.fail) level = 'fail'
    else if (ratio > metric.warn) level = 'warn'
    else if (ratio < -metric.warn) level = 'better'
  }
  return { metric, base, head, delta, ratio, level }
}

function formatSize(size) {
  return size >= 1000 ? `${size / 1000}k` : String(size)
}

function caseKey(c) {
  return `${c.dataset} ${formatSize(c.size)}`
}

// Compares every case present in both reports. Cases whose dataset hash
// differs measured different points and are skipped.
function compareReports(base, head) {
  const baseCases = new Map(base.cases.map((c) => [caseKey(c), c]))
  const rows = []
  const skipped = []
  for (const headCase of head.cases) {
    const baseCase = baseCases.get(caseKey(headCase))
    if (baseCase == null) {
      skipped.push(`${caseKey(headCase)}: not in the base report`)
      continue
    }
    if (baseCase.datasetHash !== headCase.datasetHash) {
      skipped.push(`${caseKey(headCase)}: the dataset changed`)
      continue
    }
    const gated = headCase.size >= GATE_MIN_SIZE
    const findings = []
    const memory = classify(
      MEMORY_METRIC,
      baseCase.memorySize,
      headCase.memorySize
    )
    if (memory != null) findings.push({ op: null, ...memory })
    const resultChanges = []
    for (const [op, headOp] of Object.entries(headCase.ops)) {
      const baseOp = baseCase.ops[op]
      if (baseOp == null) continue
      for (const metric of METRICS) {
        const finding = classify(metric, baseOp[metric.key], headOp[metric.key])
        if (finding != null) findings.push({ op, ...finding })
      }
      if (baseOp.result !== headOp.result) {
        resultChanges.push({ op, base: baseOp.result, head: headOp.result })
      }
    }
    rows.push({
      key: caseKey(headCase),
      baseCase,
      headCase,
      gated,
      findings,
      resultChanges,
    })
  }
  const byRatio = (a, b) => b.ratio - a.ratio
  const flagged = rows.flatMap((row) =>
    row.findings
      .filter((f) => f.level === 'fail' || f.level === 'warn')
      .map((f) => ({
        ...f,
        key: row.key,
        level: row.gated ? f.level : 'info',
      }))
  )
  return {
    rows,
    skipped,
    failures: flagged.filter((f) => f.level === 'fail').sort(byRatio),
    warnings: flagged.filter((f) => f.level === 'warn').sort(byRatio),
    ungated: flagged.filter((f) => f.level === 'info').sort(byRatio),
  }
}

function formatNumber(value) {
  const abs = Math.abs(value)
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}G`
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}k`
  return String(value)
}

function formatBytes(value) {
  const abs = Math.abs(value)
  if (abs >= 1048576) return `${(value / 1048576).toFixed(2)} MiB`
  if (abs >= 1024) return `${(value / 1024).toFixed(1)} KiB`
  return `${value} B`
}

function formatRatio(ratio) {
  if (!Number.isFinite(ratio)) return 'new'
  const sign = ratio > 0 ? '+' : ''
  return `${sign}${(ratio * 100).toFixed(1)}%`
}

function formatValue(metric, value) {
  return metric.key.endsWith('Bytes') || metric.key === 'memorySize'
    ? formatBytes(value)
    : formatNumber(value)
}

const ICONS = { fail: '❌', warn: '⚠️', info: 'ℹ️', better: '✅', ok: '' }

function findingRow(f) {
  const where = f.op == null ? f.key : `${f.key} \`${f.op}\``
  return `| ${ICONS[f.level]} ${where} | ${f.metric.label} | ${formatValue(f.metric, f.base)} | ${formatValue(f.metric, f.head)} | ${formatRatio(f.ratio)} |`
}

function sumOps(c, key, ops) {
  let total = 0
  for (const op of ops) {
    const value = c.ops[op]?.[key]
    if (value == null) return null
    total += value
  }
  return total
}

// Below the gate size a regression is only informational.
function cell(metric, base, head, gated) {
  if (base == null || head == null) return '–'
  const f = classify(metric, base, head)
  const icon =
    !gated && (f.level === 'fail' || f.level === 'warn')
      ? ICONS.info
      : ICONS[f.level]
  return `${formatValue(metric, head)} (${formatRatio(f.ratio)})${icon ? ` ${icon}` : ''}`
}

function timeCell(base, head) {
  if (base == null || head == null) return '–'
  const ms = (ns) =>
    ns >= 1e6 ? `${(ns / 1e6).toFixed(2)} ms` : `${(ns / 1e3).toFixed(1)} µs`
  return `${ms(head)} (${formatRatio((head - base) / base)})`
}

const FULL_REPORTS =
  'Every number is in `base.json` and `head.json` (the `bench-core` artifact in CI).'

function moreRows(count) {
  return `…and ${count} more. ${FULL_REPORTS}`
}

function renderMarkdown(base, head, comparison, { details = true } = {}) {
  const { rows, skipped, failures, warnings, ungated } = comparison
  const lines = [MARKER, '## Core benchmark: base vs head', '']

  const verdict =
    failures.length > 0
      ? `❌ **${failures.length} regression${failures.length === 1 ? '' : 's'} over the gate**`
      : '✅ **No regression over the gate**'
  const warned =
    warnings.length > 0
      ? `, ⚠️ ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`
      : ''
  lines.push(`${verdict}${warned}`)
  lines.push('')
  const revision = (report) =>
    report.environment?.engineRevision?.slice(0, 7) ?? report.label
  lines.push(
    `Engine \`${revision(base)}\` → \`${revision(head)}\` · ${head.environment?.runner ?? ''} · ${head.environment?.compiler ?? ''}`
  )
  lines.push(
    `Gate: cases with n ≥ ${GATE_MIN_SIZE.toLocaleString('en-US')}; fail above +5% instructions or +10% allocations / engine memory, warn above +2%. Wall time is informational.`
  )
  lines.push('')

  const flagged = [...failures, ...warnings, ...ungated]
  if (flagged.length > 0) {
    lines.push('| Case | Metric | Base | Head | Δ |')
    lines.push('|---|---|--:|--:|--:|')
    for (const f of flagged.slice(0, MAX_TABLE_ROWS)) lines.push(findingRow(f))
    lines.push('')
    if (flagged.length > MAX_TABLE_ROWS) {
      lines.push(moreRows(flagged.length - MAX_TABLE_ROWS), '')
    }
    if (ungated.length > 0) {
      lines.push(
        `ℹ️ rows are below n = ${GATE_MIN_SIZE.toLocaleString('en-US')} and never fail the check.`
      )
      lines.push('')
    }
  }

  const resultChanges = rows.flatMap((row) =>
    row.resultChanges.map((change) => ({ ...change, key: row.key }))
  )
  if (resultChanges.length > 0) {
    lines.push(
      '**Results changed**: these operations return something else now, so their costs are not like for like.'
    )
    lines.push('')
    for (const change of resultChanges.slice(0, MAX_LISTED_CHANGES)) {
      lines.push(
        `- ${change.key} \`${change.op}\`: ${change.base} → ${change.head}`
      )
    }
    lines.push('')
    if (resultChanges.length > MAX_LISTED_CHANGES) {
      lines.push(moreRows(resultChanges.length - MAX_LISTED_CHANGES), '')
    }
  }

  if (skipped.length > 0) {
    lines.push(`Skipped: ${skipped.join('; ')}.`, '')
  }

  if (!details) {
    lines.push(
      `The per-case table is left out to fit a pull request comment. ${FULL_REPORTS}`,
      ''
    )
    return lines.join('\n')
  }

  lines.push('<details><summary>All cases</summary>', '')
  lines.push(
    '| Case | Build instructions | Build allocations | Engine memory | Query instructions | Build time | Peak RSS |'
  )
  lines.push('|---|--:|--:|--:|--:|--:|--:|')
  const [instructions, allocations] = METRICS
  for (const row of rows) {
    const b = row.baseCase
    const h = row.headCase
    const queryOps = Object.keys(h.ops).filter((op) => op !== 'build')
    lines.push(
      `| ${row.key} | ${cell(instructions, b.ops.build?.instructions, h.ops.build?.instructions, row.gated)} | ${cell(allocations, b.ops.build?.allocationCount, h.ops.build?.allocationCount, row.gated)} | ${cell(MEMORY_METRIC, b.memorySize, h.memorySize, row.gated)} | ${cell(instructions, sumOps(b, 'instructions', queryOps), sumOps(h, 'instructions', queryOps), row.gated)} | ${timeCell(b.ops.build?.time?.medianNs, h.ops.build?.time?.medianNs)} | ${h.peakRssBytes == null ? '–' : formatBytes(h.peakRssBytes)} |`
    )
  }
  lines.push('', '</details>', '')
  return lines.join('\n')
}

// JSON with sorted keys, so two configs compare equal whatever the key order.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value != null && typeof value === 'object') {
    const keys = Object.keys(value).sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function notice(text) {
  return [MARKER, '## Core benchmark', '', text, ''].join('\n')
}

function main() {
  const args = process.argv.slice(2)
  let out = null
  const files = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out') out = args[++i]
    else files.push(args[i])
  }
  if (files.length !== 2) {
    console.error(
      'usage: node bench/compare.mjs base.json head.json [--out summary.md]'
    )
    process.exit(2)
  }
  const [basePath, headPath] = files
  const head = JSON.parse(fs.readFileSync(headPath, 'utf8'))

  let markdown
  let failed = false
  const base = fs.existsSync(basePath)
    ? JSON.parse(fs.readFileSync(basePath, 'utf8'))
    : null
  if (base == null) {
    markdown = notice(
      `⚠️ Not compared: there are no base results (\`${basePath}\` is missing), because no benchmark harness compiles against the base engine. The head results are in the reports.`
    )
  } else if (canonical(base.config) !== canonical(head.config)) {
    markdown = notice(
      [
        '⚠️ Not compared: base and head were measured with different engine configurations or viewports, so their numbers are not like for like.',
        '',
        `- base: \`${JSON.stringify(base.config)}\``,
        `- head: \`${JSON.stringify(head.config)}\``,
      ].join('\n')
    )
  } else {
    const comparison = compareReports(base, head)
    markdown = renderMarkdown(base, head, comparison)
    if (markdown.length > MAX_MARKDOWN_LENGTH) {
      markdown = renderMarkdown(base, head, comparison, { details: false })
    }
    failed = comparison.failures.length > 0
  }

  if (out != null) fs.writeFileSync(out, `${markdown}\n`)
  process.stdout.write(`${markdown}\n`)
  process.exit(failed ? 1 : 0)
}

main()
