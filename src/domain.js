/* domain.js — pure logic for the eval console. No DOM, no React. */

const TIERS = [['critical', 'Critical'], ['standard', 'Standard'], ['edge', 'Edge case']];
const TIER_LABEL = Object.fromEntries(TIERS);
const FMODES = [
  ['none', 'Acceptable', 'var(--ok)'],
  ['hallucination', 'Hallucination', 'var(--bad)'],
  ['missing_info', 'Missing information', '#C98A12'],
  ['instruction_ignored', 'Instruction ignored', '#7A5AF8'],
  ['wrong_tone', 'Wrong tone', '#0E9384'],
  ['format_break', 'Format break', '#4B5B6E'],
  ['wrong_refusal', 'Wrong refusal', '#B4467D'],
  ['unsafe', 'Unsafe or policy breach', '#8B1A10'],
  ['error', 'Call failed', 'var(--muted)'],
];
const FM_LABEL = Object.fromEntries(FMODES.map(f => [f[0], f[1]]));
const FM_COLOR = Object.fromEntries(FMODES.map(f => [f[0], f[2]]));
const MODEL_TIERS = [['quick', 'quick'], ['default', 'default'], ['complex', 'complex']];

const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
const clone = o => JSON.parse(JSON.stringify(o));
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const money = n => '$' + (n < 10 ? n.toFixed(2) : Math.round(n).toLocaleString());
const fmtTime = s => (s ? new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');

function quantile(arr, q) {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  const i = (a.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (i - lo);
}

const findCase = (W, id) => W.cases.find(c => c.id === id);
const findVariant = (W, id) => W.variants.find(v => v.id === id);

/* A case passes only when every criterion clears its own minimum, so a strong
   average cannot hide one disqualifying failure. */
function casePass(W, res) {
  if (!res || res.error) return false;
  return W.criteria.every(c => ((res.scores && res.scores[c.id]) || 0) >= c.min);
}

function weightedScore(W, res) {
  if (!res || !res.scores) return 0;
  const tw = W.criteria.reduce((a, c) => a + c.weight, 0) || 1;
  return W.criteria.reduce((a, c) => a + (res.scores[c.id] || 0) * c.weight, 0) / tw;
}

function estCost(W, res) {
  const cm = W.costModel, ct = cm.charsPerToken || 4;
  const inTok = (res.promptChars || 0) / ct;
  const outTok = ((res.output || '').length) / ct;
  return (inTok * cm.inPerM + outTok * cm.outPerM) / 1e6;
}

function stats(W, run) {
  if (!run || !run.results) return null;
  const rs = run.results;
  const passed = rs.filter(r => casePass(W, r));
  const byTier = {};
  TIERS.forEach(([k]) => {
    const t = rs.filter(r => (findCase(W, r.caseId) || {}).tier === k);
    byTier[k] = { n: t.length, pass: t.filter(r => casePass(W, r)).length };
  });
  const crit = {};
  W.criteria.forEach(c => {
    crit[c.id] = avg(rs.filter(r => r.scores && r.scores[c.id]).map(r => r.scores[c.id]));
  });
  const fm = {};
  rs.forEach(r => { const k = r.error ? 'error' : (r.failureMode || 'none'); fm[k] = (fm[k] || 0) + 1; });
  const lat = rs.filter(r => r.latencyMs).map(r => r.latencyMs);
  const labeled = rs.filter(r => r.human && r.human.verdict);
  const agree = labeled.filter(r => (r.human.verdict === 'pass') === casePass(W, r)).length;
  return {
    n: rs.length, pass: passed.length, passRate: rs.length ? passed.length / rs.length : 0,
    byTier, crit, fm,
    p50: quantile(lat, 0.5), p95: quantile(lat, 0.95),
    costPer1k: rs.length ? (rs.reduce((a, r) => a + estCost(W, r), 0) / rs.length) * 1000 : 0,
    weighted: avg(rs.map(r => weightedScore(W, r))),
    labeled: labeled.length, agree, agreeRate: labeled.length ? agree / labeled.length : null,
  };
}

function regressions(W, base, cand) {
  const bm = {};
  (base.results || []).forEach(r => { bm[r.caseId] = r; });
  return (cand.results || []).filter(r => bm[r.caseId] && casePass(W, bm[r.caseId]) && !casePass(W, r));
}
function improvements(W, base, cand) {
  const bm = {};
  (base.results || []).forEach(r => { bm[r.caseId] = r; });
  return (cand.results || []).filter(r => bm[r.caseId] && !casePass(W, bm[r.caseId]) && casePass(W, r));
}

/* The gate is set before a run and turns scores into a decision. Hard checks
   block a ship; soft checks downgrade it to "needs review". */
function gateChecks(W, run, base) {
  const s = stats(W, run);
  if (!s) return [];
  const g = W.gate, out = [];
  out.push({ name: 'Overall pass rate', ok: s.passRate >= g.overallPass, hard: true, val: `${pct(s.pass, s.n)}% vs ${Math.round(g.overallPass * 100)}% required` });
  const c = s.byTier.critical;
  out.push({ name: 'Critical-tier pass rate', ok: c.n ? c.pass / c.n >= g.criticalPass : true, hard: true, val: c.n ? `${pct(c.pass, c.n)}% vs ${Math.round(g.criticalPass * 100)}% required` : 'no critical cases' });
  W.criteria.forEach(cr => {
    const need = cr.gateAvg || g.criterionAvgMin;
    out.push({ name: `${cr.name} average`, ok: s.crit[cr.id] >= need, hard: cr.hard !== false, val: `${(s.crit[cr.id] || 0).toFixed(2)} vs ${Number(need).toFixed(2)} required` });
  });
  if (base && base.id !== run.id) {
    const reg = regressions(W, base, run);
    out.push({ name: 'Regressions against baseline', ok: reg.length <= g.maxRegressions, hard: true, val: `${reg.length} vs ${g.maxRegressions} allowed` });
  }
  out.push({ name: 'Latency p95', ok: s.p95 <= g.maxP95, hard: false, val: `${(s.p95 / 1000).toFixed(1)}s vs ${(g.maxP95 / 1000).toFixed(1)}s budget` });
  out.push({ name: 'Estimated cost per 1,000 requests', ok: s.costPer1k <= g.maxCostPer1k, hard: false, val: `${money(s.costPer1k)} vs ${money(g.maxCostPer1k)} budget` });
  out.push({
    name: 'Judge validated against human labels',
    ok: s.labeled >= g.minLabels && (s.agreeRate || 0) >= g.minAgreement, hard: false,
    val: s.labeled ? `${pct(s.agree, s.labeled)}% agreement on ${plural(s.labeled, 'label')}` : `0 of ${g.minLabels} labels reviewed`,
  });
  return out;
}

function verdictOf(W, run, base) {
  const checks = gateChecks(W, run, base);
  if (!checks.length) return { v: 'No run yet', cls: 'warn', checks };
  if (checks.some(c => c.hard && !c.ok)) return { v: 'Do not ship', cls: 'bad', checks };
  if (checks.some(c => !c.ok)) return { v: 'Needs review', cls: 'warn', checks };
  return { v: 'Ship it', cls: 'ok', checks };
}

function coverage(W) {
  const sc = {}, tr = {};
  W.cases.forEach(c => {
    sc[c.scenario || 'untagged'] = (sc[c.scenario || 'untagged'] || 0) + 1;
    tr[c.tier] = (tr[c.tier] || 0) + 1;
  });
  return { sc, tr };
}

function judgePrompt(W, c, output) {
  return `You are grading one output from an AI feature against a fixed rubric. Grade strictly and literally: judge only what the output says, not what it probably meant.

FEATURE: ${W.feature.name} — ${W.feature.surface}
${W.feature.desc}

CASE INPUT:
"""${c.input}"""

WHAT A CORRECT REPLY MUST DO:
"""${c.expected}"""

OUTPUT TO GRADE:
"""${output}"""

RUBRIC — score each criterion from 1 to 5:
${W.criteria.map(cr => `- id "${cr.id}" (${cr.name}): ${cr.desc || ''}\n  1 = ${cr.a1 || 'fails entirely'}; 3 = ${cr.a3 || 'partially meets it'}; 5 = ${cr.a5 || 'fully meets it'}`).join('\n')}

If the output is not acceptable, pick exactly one failure mode from: hallucination, missing_info, instruction_ignored, wrong_tone, format_break, wrong_refusal, unsafe. If it is acceptable, use "none".

Reply with only this JSON and nothing else:
{"scores":{${W.criteria.map(cr => `"${cr.id}":<1-5>`).join(',')}},"failureMode":"<one of the values above>","rationale":"<35 words or fewer naming the specific evidence>"}`;
}

function runLabel(W, r) {
  const v = findVariant(W, r.variantId);
  return (r.label || (v ? v.name : 'Run')) + (r.id === W.baselineRunId ? ' (baseline)' : '');
}

function reportMarkdown(W, cand, base) {
  if (!cand) return 'Run an evaluation first.';
  const s = stats(W, cand);
  const useBase = base && base.id !== cand.id ? base : null;
  const v = verdictOf(W, cand, useBase);
  const reg = useBase ? regressions(W, useBase, cand) : [];
  const L = [];
  L.push(`# Eval report: ${W.feature.name}`, '');
  L.push(`**Surface:** ${W.feature.surface}`);
  L.push(`**Run:** ${runLabel(W, cand)} — ${fmtTime(cand.startedAt)}` + (useBase ? `  \n**Baseline:** ${runLabel(W, useBase)}` : ''));
  L.push(`**Verdict:** ${v.v}`, '');
  L.push('## Gate', '', '| Check | Result | Status |', '| --- | --- | --- |');
  v.checks.forEach(c => L.push(`| ${c.name} | ${c.val} | ${c.ok ? 'pass' : c.hard ? 'FAIL' : 'warning'} |`));
  L.push('', '## Quality', '');
  L.push(`Pass rate ${pct(s.pass, s.n)}% (${s.pass} of ${s.n} cases). Weighted score ${s.weighted.toFixed(2)} of 5.`, '');
  L.push('| Criterion | Mean | Case minimum |', '| --- | --- | --- |');
  W.criteria.forEach(c => L.push(`| ${c.name} | ${(s.crit[c.id] || 0).toFixed(2)} | ${c.min} |`));
  L.push('', 'Pass rate by tier: ' + TIERS.map(([k, l]) => `${l} ${s.byTier[k].pass}/${s.byTier[k].n}`).join(', ') + '.', '');
  L.push('## Failure modes', '');
  const fails = Object.entries(s.fm).filter(([k]) => k !== 'none').sort((a, b) => b[1] - a[1]);
  if (fails.length) fails.forEach(([k, n]) => L.push(`- ${FM_LABEL[k] || k}: ${n}`));
  else L.push('- None recorded.');
  L.push('');
  if (reg.length) {
    L.push('## Regressions against baseline', '');
    reg.forEach(r => {
      const c = findCase(W, r.caseId) || {};
      L.push(`- **${c.scenario || 'case'}** — ${String(c.input || '').slice(0, 100)}`);
      L.push(`  - Judge: ${r.rationale || ''}`);
    });
    L.push('');
  }
  L.push('## Cost and latency', '');
  L.push(`Median ${(s.p50 / 1000).toFixed(1)}s, p95 ${(s.p95 / 1000).toFixed(1)}s. Estimated ${money(s.costPer1k)} per 1,000 requests at ${money(W.costModel.inPerM)}/${money(W.costModel.outPerM)} per million input/output tokens.`, '');
  L.push('## Judge validation', '');
  L.push(s.labeled
    ? `${plural(s.labeled, 'result')} labeled by hand; the judge agreed on ${pct(s.agree, s.labeled)}%.`
    : 'No human labels yet. Until a sample is labeled, the judge is unvalidated and the pass rate should be read as provisional.');
  L.push('', '## Method', '');
  L.push(`Each case is sent to the variant under test, then graded by an LLM judge against ${plural(W.criteria.length, 'criterion')} on a 1-5 scale with written anchors. A case passes only when every criterion clears its own minimum, so a strong average cannot hide one disqualifying failure. Thresholds were set before the run.`);
  if (cand.analysis) L.push('', '## Analysis', '', cand.analysis);
  return L.join('\n');
}

function resultsCsv(W, run) {
  if (!run) return '';
  const q = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const cols = ['case_id', 'scenario', 'tier', 'input', 'expected', 'output', 'pass', ...W.criteria.map(c => c.id), 'failure_mode', 'rationale', 'latency_ms', 'human_label'];
  const rows = (run.results || []).map(r => {
    const c = findCase(W, r.caseId) || {};
    return [r.caseId, c.scenario, c.tier, c.input, c.expected, r.output, casePass(W, r) ? 'pass' : 'fail',
      ...W.criteria.map(cr => (r.scores || {})[cr.id] || ''), r.failureMode, r.rationale, r.latencyMs, (r.human || {}).verdict || ''].map(q).join(',');
  });
  return [cols.join(','), ...rows].join('\n');
}
const goldenJsonl = W => W.cases.map(c => JSON.stringify({ id: c.id, scenario: c.scenario, tier: c.tier, input: c.input, expected: c.expected })).join('\n');
