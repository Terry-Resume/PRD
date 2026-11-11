// Loads Verdict's plain-script sources into a sandbox so the pure logic can be tested without a browser.
// The sources share one scope and have no exports (see build.mjs), so we evaluate them the same way the build does.
import vm from 'node:vm'
import fs from 'node:fs'

export function loadDomain() {
  const ctx = vm.createContext({ console, Date, Math, JSON, Intl })
  const src = ['domain.js', 'demo.js'].map(f => fs.readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8')).join('\n')
  vm.runInContext(src, ctx)
  const api = vm.runInContext(`({ casePass, weightedScore, quantile, stats, regressions, improvements, gateChecks, verdictOf,
    coverage, resultsCsv, goldenJsonl, reportMarkdown, judgePrompt, demoData, TIERS })`, ctx)
  // Results cross a vm realm boundary; round-trip through JSON so deepEqual compares plain objects.
  const plain = x => JSON.parse(JSON.stringify(x))
  return { ...api, plain }
}

/** A tiny RFC 4180 parser, just enough to prove the export round-trips. */
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else cell += ch
  }
  row.push(cell); rows.push(row)
  return rows
}
