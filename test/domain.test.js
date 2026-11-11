import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadDomain, parseCsv } from './helpers.js'

const D = loadDomain()
const fresh = () => D.plain(D.demoData())
// The sample baseline misses the gate on one thing: its tone average is 3.79 against 4.00 (the story behind v3).
// These fixtures lift tone so a test can exercise the other gates in isolation.
const cleanBaseline = () => {
  const { W, RUNS } = fresh()
  const base = Object.values(RUNS).find(r => r.label === 'v2 baseline')
  base.results.forEach(r => { r.scores.tone = 5 })
  return { W, base }
}
const labelPasses = (W, run, n = 5) => {
  let k = 0
  for (const r of run.results) if (k < n && D.casePass(W, r)) { r.human = { verdict: 'pass' }; k++ }
}

test('the sample project matches what the README promises', () => {
  const { W, RUNS } = fresh()
  assert.equal(W.cases.length, 14)
  assert.equal(W.criteria.length, 5)
  assert.equal(W.variants.length, 2)
  assert.equal(Object.keys(RUNS).length, 2)
  assert.deepEqual(D.plain(D.coverage(W).tr), { standard: 7, critical: 4, edge: 3 })
})

test('a case passes only when every criterion clears its own minimum', () => {
  const { W } = fresh()
  const allFives = Object.fromEntries(W.criteria.map(c => [c.id, 5]))
  assert.equal(D.casePass(W, { scores: allFives }), true)
  // One disqualifying score sinks the case even though the average is 4.8.
  assert.equal(D.casePass(W, { scores: { ...allFives, accuracy: 2 } }), false)
  assert.equal(D.casePass(W, { scores: allFives, error: 'timeout' }), false)
  assert.equal(D.casePass(W, undefined), false)
  assert.equal(D.casePass(W, {}), false)
})

test('weighted score honours the rubric weights', () => {
  const W = { criteria: [{ id: 'a', weight: 3 }, { id: 'b', weight: 1 }] }
  assert.equal(D.weightedScore(W, { scores: { a: 5, b: 1 } }), (15 + 1) / 4)
  assert.equal(D.weightedScore(W, {}), 0)
})

test('quantile interpolates and survives empty input', () => {
  assert.equal(D.quantile([], 0.95), 0)
  assert.equal(D.quantile([10], 0.5), 10)
  assert.equal(D.quantile([1, 2, 3, 4], 0.5), 2.5)
  assert.equal(D.quantile([4, 1, 3, 2], 0.5), 2.5, 'input order does not matter')
  assert.equal(D.quantile([0, 100], 0.95), 95)
})

test('stats: the baseline passes every case and the candidate passes five of fourteen', () => {
  const { W, RUNS } = fresh()
  const [base, cand] = Object.values(RUNS).sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  const sb = D.plain(D.stats(W, base)), sc = D.plain(D.stats(W, cand))
  assert.equal(sb.pass, 14)
  assert.equal(sc.pass, 5)
  assert.equal(Math.round(sc.passRate * 100), 36)
  assert.deepEqual(sc.byTier.critical, { n: 4, pass: 2 })
  assert.deepEqual(sc.fm, { hallucination: 8, unsafe: 1, wrong_tone: 1, none: 4 })
  assert.equal(sc.labeled, 5)
  assert.ok(sc.p95 >= sc.p50)
  assert.ok(sc.costPer1k > 0)
  assert.equal(D.stats(W, null), null)
})

test('regressions and improvements compare cases that passed before and fail now', () => {
  const { W, RUNS } = fresh()
  const [base, cand] = Object.values(RUNS).sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  assert.equal(D.regressions(W, base, cand).length, 9)
  assert.equal(D.improvements(W, base, cand).length, 0)
  assert.equal(D.regressions(W, cand, base).length, 0, 'a fix is not a regression')
  assert.equal(D.improvements(W, cand, base).length, 9)
})

test('verdict: the warmer-tone candidate is a Do not ship, and says why', () => {
  const { W, RUNS } = fresh()
  const [base, cand] = Object.values(RUNS).sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  const v = D.plain(D.verdictOf(W, cand, base))
  assert.equal(v.v, 'Do not ship')
  const failedHard = v.checks.filter(c => c.hard && !c.ok).map(c => c.name)
  for (const name of ['Overall pass rate', 'Critical-tier pass rate', 'Regressions against baseline']) assert.ok(failedHard.includes(name), `${name} fails`)
  assert.ok(failedHard.includes('Factual accuracy average'))
})

test('verdict: the sample baseline misses the gate on tone alone, and says the judge is unvalidated', () => {
  const { W, RUNS } = fresh()
  const base = Object.values(RUNS).find(r => r.label === 'v2 baseline')
  const v = D.plain(D.verdictOf(W, base, null))
  assert.equal(v.v, 'Do not ship')
  assert.deepEqual(v.checks.filter(c => !c.ok).map(c => c.name), ['Tone and empathy average', 'Judge validated against human labels'])
  assert.match(v.checks.find(c => c.name === 'Tone and empathy average').val, /3\.79 vs 4\.00/)
})

test('verdict: a clean run is Needs review until the judge is validated, then Ship it', () => {
  const { W, base } = cleanBaseline()
  const unvalidated = D.plain(D.verdictOf(W, base, null))
  assert.equal(unvalidated.v, 'Needs review')
  const soft = unvalidated.checks.filter(c => !c.ok)
  assert.deepEqual(soft.map(c => c.name), ['Judge validated against human labels'])
  assert.match(soft[0].val, /0 of 5 labels reviewed/)

  labelPasses(W, base)
  assert.equal(D.verdictOf(W, base, null).v, 'Ship it')
})

test('verdict: labels that disagree with the judge keep a good run at Needs review', () => {
  const { W, base } = cleanBaseline()
  base.results.slice(0, 5).forEach(r => { r.human = { verdict: 'fail' } }) // the judge passed all five
  const v = D.plain(D.verdictOf(W, base, null))
  assert.equal(v.v, 'Needs review')
  assert.match(v.checks.find(c => c.name === 'Judge validated against human labels').val, /0% agreement on 5 labels/)
})

test('verdict: latency over budget downgrades a ship to review, it does not block', () => {
  const { W, base } = cleanBaseline()
  labelPasses(W, base)
  base.results.forEach(r => { r.latencyMs = W.gate.maxP95 + 5000 })
  const v = D.plain(D.verdictOf(W, base, null))
  assert.equal(v.v, 'Needs review')
  assert.deepEqual(v.checks.filter(c => !c.ok).map(c => c.name), ['Latency p95'])
})

test('verdict: one failed critical case blocks even when the overall pass rate clears the bar', () => {
  const { W, base } = cleanBaseline()
  labelPasses(W, base)
  const critical = base.results.find(r => W.cases.find(c => c.id === r.caseId).tier === 'critical')
  critical.scores.safety = 1
  const v = D.plain(D.verdictOf(W, base, null))
  assert.ok(D.stats(W, base).passRate >= W.gate.overallPass, 'overall pass rate is still 93%')
  assert.equal(v.v, 'Do not ship')
  assert.ok(v.checks.find(c => c.name === 'Critical-tier pass rate' && !c.ok))
})

test('verdict: no run yet', () => {
  const { W } = fresh()
  assert.equal(D.verdictOf(W, null, null).v, 'No run yet')
})

test('the CSV export round-trips and quotes commas, quotes and newlines', () => {
  const { W, RUNS } = fresh()
  const run = Object.values(RUNS)[0]
  run.results[0].output = 'He said "hi", then\nleft'
  const rows = parseCsv(D.resultsCsv(W, run))
  assert.equal(rows.length, 1 + run.results.length)
  assert.equal(rows[0][0], 'case_id')
  assert.ok(rows.every(r => r.length === rows[0].length), 'every row has the same number of columns')
  const outCol = rows[0].indexOf('output')
  assert.equal(rows[1][outCol], 'He said "hi", then\nleft')
  assert.equal(D.resultsCsv(W, null), '')
})

test('the CSV export neutralises spreadsheet formulas in untrusted text', () => {
  const { W, RUNS } = fresh()
  const run = Object.values(RUNS)[0]
  const bad = ['=HYPERLINK("http://evil.example","x")', '+1+1', '-2+3', '@SUM(A1)']
  bad.forEach((text, i) => { run.results[i].output = text; run.results[i].rationale = text })
  W.cases.slice(0, 4).forEach((c, i) => { c.input = bad[i] })
  const rows = parseCsv(D.resultsCsv(W, run))
  const cols = rows[0]
  for (let i = 1; i <= 4; i++) {
    for (const name of ['input', 'output', 'rationale']) {
      const cell = rows[i][cols.indexOf(name)]
      assert.ok(cell.startsWith("'"), `${name} row ${i} is prefixed: ${cell}`)
    }
  }
  for (const row of rows.slice(1)) for (const cell of row) assert.ok(!/^[=+\-@]/.test(cell), `no cell starts with a formula character: ${cell}`)
})

test('the golden-set export is one valid JSON object per case', () => {
  const { W } = fresh()
  const lines = D.goldenJsonl(W).split('\n').map(l => JSON.parse(l))
  assert.equal(lines.length, 14)
  assert.deepEqual(Object.keys(lines[0]).sort(), ['expected', 'id', 'input', 'scenario', 'tier'])
})

test('the markdown report states the verdict, the failed gates and the regressions', () => {
  const { W, RUNS } = fresh()
  const [base, cand] = Object.values(RUNS).sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  const md = D.reportMarkdown(W, cand, base)
  assert.match(md, /\*\*Verdict:\*\* Do not ship/)
  assert.match(md, /\| Overall pass rate \| 36% vs 85% required \| FAIL \|/)
  assert.match(md, /## Regressions against baseline/)
  assert.match(md, /Hallucination: 8|hallucination: 8/i)
  assert.equal(D.reportMarkdown(W, null, null), 'Run an evaluation first.')
})

test('the judge prompt fences untrusted case text and lists every criterion', () => {
  const { W } = fresh()
  const p = D.judgePrompt(W, W.cases[0], 'some output')
  assert.match(p, /CASE INPUT:\n"""/)
  assert.match(p, /OUTPUT TO GRADE:\n"""some output"""/)
  for (const c of W.criteria) assert.ok(p.includes(`id "${c.id}"`), `${c.id} is in the rubric`)
  assert.match(p, /Reply with only this JSON/)
})
