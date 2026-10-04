/* views.jsx — one component per page, plus the actions that write to the store. */

const runsDesc = runs => Object.values(runs).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
const completedRuns = runs => runsDesc(runs).filter(r => r.results && r.results.length);
const baselineOf = (W, runs) => runs[W.baselineRunId] || null;
const latestOf = (W, runs) => completedRuns(runs).find(r => r.id !== W.baselineRunId) || completedRuns(runs)[0] || null;

/* ---- actions ---- */
const Actions = {
  saveCase(id, v) {
    Actions.edit(W => {
      if (id) Object.assign(W.cases.find(c => c.id === id), v);
      else W.cases.push({ id: uid(), ...v });
    });
    toast(id ? 'Case saved' : 'Case added');
  },
  deleteCase(id) { Actions.edit(W => { W.cases = W.cases.filter(c => c.id !== id); }); toast('Case deleted'); },
  addCases(cases) { Actions.edit(W => { W.cases.push(...cases); }); toast(`${plural(cases.length, 'case')} added`); },
  saveCriterion(id, v) {
    Actions.edit(W => {
      if (id) Object.assign(W.criteria.find(c => c.id === id), v);
      else W.criteria.push({ id: v.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 20) + '_' + uid().slice(0, 3), ...v });
    });
    toast('Rubric saved');
  },
  deleteCriterion(id) { Actions.edit(W => { W.criteria = W.criteria.filter(c => c.id !== id); }); toast('Criterion removed'); },
  saveVariant(id, v) {
    Actions.edit(W => {
      if (id) Object.assign(W.variants.find(x => x.id === id), v);
      else W.variants.push({ id: uid(), createdAt: new Date().toISOString(), ...v });
    });
    toast('Variant saved');
  },
  deleteVariant(id) { Actions.edit(W => { W.variants = W.variants.filter(v => v.id !== id); }); toast('Variant deleted'); },
  setBaseline(run) {
    Actions.edit(W => { W.baselineRunId = run.id; W.baselineVariantId = run.variantId; });
    toast('Baseline set to ' + runLabel(Store.state.W, run));
  },
  deleteRun(id) {
    Store.dropRun(id);
    if (Store.state.W.baselineRunId === id) {
      const next = completedRuns(Store.state.runs)[0];
      Actions.edit(W => { W.baselineRunId = next ? next.id : null; });
    }
    toast('Run deleted');
  },
  label(runId, caseId, verdict) {
    const run = Store.state.runs[runId];
    if (!run) return;
    const results = run.results.map(r => (r.caseId === caseId ? { ...r, human: verdict ? { verdict, at: new Date().toISOString() } : null } : r));
    Store.putRun({ ...run, results }, true);
  },
  edit(fn) { Store.editW(fn); },
  reset() {
    Object.keys(Store.state.runs).forEach(id => Store.dropRun(id));
    const d = demoData();
    Store.set({ W: d.W, runs: d.RUNS });
    Store.editW(() => {});
    Object.values(d.RUNS).forEach(r => Store.putRun(r, true));
    toast('Reset to the sample project');
  },
};

async function draftCases(W) {
  const sample = await Store.sample();
  if (!sample) { toast('Live model calls aren’t available in this view.'); return null; }
  const cov = coverage(W);
  const out = await sample.json(`Write 5 new evaluation test cases for this AI feature.

FEATURE: ${W.feature.name} — ${W.feature.surface}
${W.feature.desc}

Scenarios already covered and how many cases each has: ${Object.entries(cov.sc).map(([k, n]) => `${k} (${n})`).join(', ') || 'none'}.
Favor gaps, realistic edge cases, and at least one adversarial input (a user trying to get the feature to break its rules).

Each case needs a realistic user input and an expected behavior written so two graders would agree.
Reply with only a JSON array of 5 objects: [{"scenario":"short label","tier":"critical|standard|edge","input":"what the user sends","expected":"what a correct reply must do"}]`, { modelTier: 'default' });
  const arr = Array.isArray(out) ? out : [];
  return arr.slice(0, 5).map(c => ({
    id: uid(),
    scenario: String(c.scenario || '').slice(0, 40),
    tier: TIER_LABEL[c.tier] ? c.tier : 'standard',
    input: String(c.input || '').slice(0, 2000),
    expected: String(c.expected || '').slice(0, 2000),
    notes: 'Drafted by Claude, review before trusting',
  })).filter(c => c.input && c.expected);
}

async function draftAnalysis(W, run, base) {
  const sample = await Store.sample();
  if (!sample) return;
  const s = stats(W, run);
  const reg = base && base.id !== run.id ? regressions(W, base, run) : [];
  const { text } = await sample(`You are a product manager writing the analysis section of an evaluation report. Be specific and plain. No hype, no bullet lists longer than four items.

Feature: ${W.feature.name} — ${W.feature.desc}
Run: ${runLabel(W, run)}; ${s.n} cases; pass rate ${pct(s.pass, s.n)}%.
Criterion means: ${W.criteria.map(c => `${c.name} ${(s.crit[c.id] || 0).toFixed(2)}`).join('; ')}.
Failure modes: ${Object.entries(s.fm).map(([k, n]) => `${FM_LABEL[k]} ${n}`).join('; ')}.
Regressions against baseline: ${reg.length}${reg.length ? ' — ' + reg.map(r => `${(findCase(W, r.caseId) || {}).scenario}: ${r.rationale}`).join(' | ') : ''}.
Latency p95 ${(s.p95 / 1000).toFixed(1)}s; estimated ${money(s.costPer1k)} per 1000 requests.

Write 150-200 words: what the numbers say, the most likely cause of the failures, and the two changes you would make before the next run.`, { modelTier: 'default' });
  Store.putRun({ ...run, analysis: text.trim() }, true);
  toast('Analysis added to the report');
}

/* ---- dialogs used by more than one view ---- */
function CaseDialog({ W, id, onClose }) {
  const c = id ? findCase(W, id) : { tier: 'standard', scenario: '', input: '', expected: '', notes: '' };
  return (
    <FormDialog title={id ? (c.scenario || 'Case') : 'New case'} onClose={onClose} initial={c} wide
      saveLabel={id ? 'Save case' : 'Add case'}
      onDelete={id ? () => Actions.deleteCase(id) : null} deleteLabel="Delete case"
      fields={[
        { k: 'scenario', label: 'Scenario', hint: 'Group cases so coverage is visible' },
        { k: 'tier', label: 'Risk tier', type: 'select', options: TIERS },
        { k: 'input', label: 'Input the user sends', type: 'textarea', wide: true, rows: 4 },
        { k: 'expected', label: 'What a correct reply must do', type: 'textarea', wide: true, rows: 4, hint: 'Write it so two people would grade it the same way' },
        { k: 'notes', label: 'Notes', type: 'textarea', wide: true, rows: 2 },
      ]}
      onSave={v => {
        if (!v.input.trim() || !v.expected.trim()) { toast('A case needs an input and an expected behavior.'); return false; }
        Actions.saveCase(id, v);
      }} />
  );
}

function RunDialog({ W, runs, onClose, variantId }) {
  const latest = latestOf(W, runs);
  return (
    <FormDialog title="Run evaluation" onClose={onClose} saveLabel="Start run"
      initial={{ variantId: variantId || W.baselineVariantId || (W.variants[0] || {}).id, scope: 'all', label: '' }}
      fields={[
        { k: 'variantId', label: 'Variant', type: 'select', options: W.variants.map(v => [v.id, v.name]) },
        { k: 'scope', label: 'Cases', type: 'select', options: [['all', `The whole golden set (${W.cases.length})`], ['critical', 'Critical tier only'], ['fail', 'Only cases the latest run failed']] },
        { k: 'label', label: 'Run label', wide: true, hint: 'Optional, e.g. "v3 after escalation fix"' },
      ]}
      note={`Each case costs two model calls on this view’s Claude account: one to produce the output, one to grade it.`}
      onSave={v => {
        let ids = W.cases.map(c => c.id);
        if (v.scope === 'critical') ids = W.cases.filter(c => c.tier === 'critical').map(c => c.id);
        else if (v.scope === 'fail' && latest) ids = latest.results.filter(r => !casePass(W, r)).map(r => r.caseId);
        if (!ids.length) { toast('No cases match that scope.'); return false; }
        startRun(v.variantId, ids, v.label);
      }} />
  );
}

/* ---- overview ---- */
function Overview({ W, runs, go, openRun }) {
  const cand = latestOf(W, runs), base = baselineOf(W, runs);
  if (!cand) {
    return (
      <>
        <ViewHead title={W.feature.name} desc={W.feature.desc}>
          <button className="btn pri" onClick={openRun}>Run evaluation</button>
        </ViewHead>
        <Empty action={<button className="btn pri" onClick={openRun}>Run evaluation</button>}>
          No evaluation has been run yet. Run one against the golden set to get a verdict.
        </Empty>
      </>
    );
  }
  const useBase = base && base.id !== cand.id ? base : null;
  const v = verdictOf(W, cand, useBase), s = stats(W, cand);
  const reg = useBase ? regressions(W, useBase, cand) : [];
  const cov = coverage(W);
  const thin = Object.entries(cov.sc).filter(([, n]) => n < 2).map(([k]) => k);
  const trend = completedRuns(runs).slice().reverse().map(r => { const st = stats(W, r); return pct(st.pass, st.n); });
  const covMax = Math.max(...Object.values(cov.sc), 1);
  return (
    <>
      <ViewHead title={W.feature.name} desc={W.feature.desc}>
        <button className="btn pri" onClick={openRun}>Run evaluation</button>
      </ViewHead>
      <div className="stack">
        <Panel className="gatepanel"
          title={<div><h2>Ship gate</h2><p className="small muted">{runLabel(W, cand)} · {s.n} cases · {fmtTime(cand.startedAt)}{cand.synthetic ? ' · sample data' : ''}</p></div>}
          actions={<button className="btn sm ghost" onClick={() => go('report')}>Write the report</button>}>
          <div className="vcard">
            <div>
              <div className={'vbadge ' + v.cls}>
                <b>{v.v}</b>
                <span>{v.checks.filter(c => !c.ok).length ? plural(v.checks.filter(c => !c.ok).length, 'failing check') : 'all checks passed'}</span>
                <div className="vstat">{pct(s.pass, s.n)}% pass rate{useBase ? `, ${plural(reg.length, 'regression')}` : ''}</div>
              </div>
              {trend.length > 1 ? (
                <div className="trend">
                  <div className="cap">Pass rate across runs</div>
                  <Sparkline values={trend} />
                </div>
              ) : null}
            </div>
            <ul className="checks">
              {v.checks.map(c => (
                <li key={c.name}>
                  <span className={'mark ' + (c.ok ? 'ok' : c.hard ? 'bad' : 'warn')}>{c.ok ? '✓' : c.hard ? '✕' : '!'}</span>
                  <span>{c.name}{!c.hard && !c.ok ? <> <Chip tone="warn">warning</Chip></> : null}</span>
                  <span className="val">{c.val}</span>
                </li>
              ))}
            </ul>
          </div>
        </Panel>
        <div className="grid2">
          <Panel title="Scores by criterion">
            {W.criteria.map(c => (
              <Bar key={c.id} label={c.name} value={s.crit[c.id] || 0} max={5}
                text={(s.crit[c.id] || 0).toFixed(2)}
                tone={(s.crit[c.id] || 0) >= (c.gateAvg || W.gate.criterionAvgMin) ? 'ok' : 'bad'} />
            ))}
            <p className="small muted" style={{ marginTop: 8 }}>
              Mean score out of 5 across {plural(s.n, 'case')}. A case passes only when every criterion clears its own minimum.
            </p>
          </Panel>
          <Panel title="Failure modes">
            <FailureBar fm={s.fm} n={s.n} />
            <div style={{ marginTop: 14 }}>
              {TIERS.map(([k, l]) => {
                const t = s.byTier[k];
                return t.n ? <Bar key={k} label={l + ' cases'} value={t.pass} max={t.n} text={`${t.pass}/${t.n}`} tone={t.pass === t.n ? 'ok' : k === 'critical' ? 'bad' : 'warn'} /> : null;
              })}
            </div>
          </Panel>
          <Panel title="Cost and latency">
            <div className="tiles compact">
              <Tile value={`${(s.p50 / 1000).toFixed(1)}s`} label="median latency" />
              <Tile value={`${(s.p95 / 1000).toFixed(1)}s`} label="p95 latency" />
              <Tile value={money(s.costPer1k)} label="per 1,000 requests, estimated" />
            </div>
            <p className="small muted" style={{ marginTop: 10 }}>
              Estimated from output length at {money(W.costModel.inPerM)} per million input tokens and {money(W.costModel.outPerM)} per million output tokens.
            </p>
          </Panel>
          <Panel title="Coverage of the golden set" actions={<button className="btn sm ghost" onClick={() => go('cases')}>Golden set</button>}>
            {Object.entries(cov.sc).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
              <Bar key={k} label={k} value={n} max={covMax} text={String(n)} tone={n < 2 ? 'warn' : undefined} />
            ))}
            <p className="small muted" style={{ marginTop: 8 }}>
              {thin.length ? `Thin coverage: ${thin.join(', ')}. One case per scenario can’t tell signal from noise.` : 'Every scenario has at least two cases.'}
            </p>
          </Panel>
        </div>
      </div>
    </>
  );
}

/* ---- golden set ---- */
function Cases({ W, runs, ui, setUi }) {
  const [dlg, setDlg] = useState(null);
  const [drafts, setDrafts] = useState(null);
  const [drafting, setDrafting] = useState(false);
  const sample = useStore().sample;
  const cov = coverage(W);
  const latest = latestOf(W, runs);
  const q = (ui.caseQ || '').toLowerCase();
  const list = W.cases.filter(c =>
    (ui.tier === 'all' || !ui.tier || c.tier === ui.tier) &&
    (!q || `${c.input} ${c.expected} ${c.scenario || ''}`.toLowerCase().includes(q)));
  const draft = async () => {
    setDrafting(true);
    try { const d = await draftCases(W); if (d && d.length) setDrafts(d); else toast('No cases came back. Try again.'); }
    catch (e) { toast(e && e.code === 'not_granted' ? 'Model access was declined for this view.' : 'The draft failed: ' + ((e && e.code) || 'error')); }
    finally { setDrafting(false); }
  };
  return (
    <>
      <ViewHead title="Golden set" desc={`${plural(W.cases.length, 'labeled case')} that represent what real users send. Each case states the input and what a correct reply must do, so scoring is objective rather than taste.`}>
        {sample ? <button className="btn" onClick={draft} disabled={drafting}>{drafting ? 'Drafting…' : 'Draft cases with Claude'}</button> : null}
        <button className="btn pri" onClick={() => setDlg({ id: null })}>Add case</button>
      </ViewHead>
      <div className="tiles">
        <Tile value={W.cases.length} label="cases" />
        {TIERS.map(([k, l]) => <Tile key={k} value={cov.tr[k] || 0} label={`${l.toLowerCase()} cases`} />)}
        <Tile value={Object.keys(cov.sc).length} label="scenarios covered" />
      </div>
      <div className="toolbar">
        <input className="search" type="search" placeholder="Search cases" value={ui.caseQ || ''} onChange={e => setUi({ caseQ: e.target.value })} aria-label="Search cases" />
        <Segmented size="sm" value={ui.tier || 'all'} onChange={t => setUi({ tier: t })}
          options={[['all', 'All tiers'], ...TIERS.map(([k, l]) => [k, l])]} />
        <span className="sp" />
        <span className="small muted">{plural(list.length, 'case')} shown</span>
      </div>
      <Panel className="flush">
        <div className="tblwrap">
          <table>
            <thead><tr><th>Scenario</th><th>Tier</th><th>Input</th><th>Expected behavior</th><th>Latest</th><th /></tr></thead>
            <tbody>
              {list.map(c => {
                const r = latest && latest.results.find(x => x.caseId === c.id);
                return (
                  <tr key={c.id} className="rowlink" onClick={() => setDlg({ id: c.id })}>
                    <td>{c.scenario || '—'}</td>
                    <td><TierChip tier={c.tier} /></td>
                    <td className="clamp">{c.input}</td>
                    <td className="clamp small muted">{c.expected}</td>
                    <td>{r ? (casePass(W, r) ? <Chip tone="ok">Pass</Chip> : <Chip tone="bad">Fail</Chip>) : <span className="muted small">—</span>}</td>
                    <td><button className="btn sm ghost">Edit</button></td>
                  </tr>
                );
              })}
              {!list.length ? <tr><td colSpan={6} className="empty">No cases match.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </Panel>
      {dlg ? <CaseDialog W={W} id={dlg.id} onClose={() => setDlg(null)} /> : null}
      {drafts ? (
        <FormDialog title="Review drafted cases" wide onClose={() => setDrafts(null)} saveLabel={`Add ${drafts.length} cases`}
          note="Drafted cases are a starting point, not labeled data. Edit the expected behavior before you trust a score that depends on it."
          onSave={() => { Actions.addCases(drafts); setDrafts(null); }}>
          <div className="stack">
            {drafts.map(c => (
              <div className="panel sub" key={c.id}>
                <p className="small"><b>{c.scenario}</b> <TierChip tier={c.tier} /></p>
                <div className="out" style={{ marginTop: 8 }}>{c.input}</div>
                <p className="small muted" style={{ marginTop: 6 }}>{c.expected}</p>
              </div>
            ))}
          </div>
        </FormDialog>
      ) : null}
    </>
  );
}

/* ---- rubric and gate ---- */
function Rubric({ W }) {
  const [dlg, setDlg] = useState(null);
  const g = W.gate;
  return (
    <>
      <ViewHead title="Rubric and ship gate" desc="Criteria are what the judge scores, each 1 to 5 against written anchors. The gate turns those scores into a ship decision, so the bar is set before the results come in.">
        <button className="btn pri" onClick={() => setDlg({ kind: 'criterion', id: null })}>Add criterion</button>
      </ViewHead>
      <div className="critgrid">
        {W.criteria.map(c => (
          <section className="panel crit" key={c.id}>
            <div className="phead">
              <h2>{c.name}</h2>
              <button className="btn sm ghost" onClick={() => setDlg({ kind: 'criterion', id: c.id })}>Edit</button>
            </div>
            <p className="small muted">{c.desc}</p>
            <div className="critmeta">
              <span><b>×{c.weight}</b> weight</span>
              <span><b>{c.min}</b> case minimum</span>
              <span><b>{Number(c.gateAvg || g.criterionAvgMin).toFixed(1)}</b> gate average</span>
            </div>
            <dl className="anchors">
              <div><dt className="s1">1</dt><dd>{c.a1}</dd></div>
              <div><dt className="s3">3</dt><dd>{c.a3}</dd></div>
              <div><dt className="s5">5</dt><dd>{c.a5}</dd></div>
            </dl>
          </section>
        ))}
      </div>
      <div className="grid2" style={{ marginTop: 16 }}>
        <Panel title="Ship gate" actions={<button className="btn sm" onClick={() => setDlg({ kind: 'gate' })}>Edit thresholds</button>}>
          <ul className="list1">
            <li><div className="sp">Overall pass rate</div><b>{Math.round(g.overallPass * 100)}%</b></li>
            <li><div className="sp">Critical-tier pass rate</div><b>{Math.round(g.criticalPass * 100)}%</b></li>
            <li><div className="sp">Default criterion average</div><b>{g.criterionAvgMin.toFixed(1)}</b></li>
            <li><div className="sp">Regressions allowed against baseline</div><b>{g.maxRegressions}</b></li>
            <li><div className="sp">Latency p95 budget</div><b>{(g.maxP95 / 1000).toFixed(1)}s</b></li>
            <li><div className="sp">Cost per 1,000 requests</div><b>{money(g.maxCostPer1k)}</b></li>
            <li><div className="sp">Human labels to validate the judge</div><b>{g.minLabels} at {Math.round(g.minAgreement * 100)}%</b></li>
          </ul>
          <p className="small muted" style={{ marginTop: 10 }}>
            Pass rate, critical tier, criterion averages, and regressions are hard gates. Latency, cost, and judge validation are warnings: they make the verdict “needs review” rather than blocking it.
          </p>
        </Panel>
        <Panel title="Judge and cost model" actions={<button className="btn sm" onClick={() => setDlg({ kind: 'judge' })}>Edit</button>}>
          <ul className="list1">
            <li><div className="sp">Judge model tier</div><b>{W.judgeTier}</b></li>
            <li><div className="sp">Input price per million tokens</div><b>{money(W.costModel.inPerM)}</b></li>
            <li><div className="sp">Output price per million tokens</div><b>{money(W.costModel.outPerM)}</b></li>
            <li><div className="sp">Characters per token assumed</div><b>{W.costModel.charsPerToken}</b></li>
          </ul>
          <p className="small muted" style={{ marginTop: 10 }}>
            An LLM judge is itself a measurement instrument. Label a sample of results by hand on the Runs page; agreement between your labels and the judge is tracked as its own gate check.
          </p>
        </Panel>
      </div>
      {dlg && dlg.kind === 'criterion' ? (() => {
        const c = dlg.id ? W.criteria.find(x => x.id === dlg.id) : { weight: 2, min: 4, gateAvg: W.gate.criterionAvgMin, name: '', desc: '', a1: '', a3: '', a5: '' };
        return (
          <FormDialog title={dlg.id ? c.name : 'New criterion'} wide onClose={() => setDlg(null)} initial={c}
            saveLabel={dlg.id ? 'Save criterion' : 'Add criterion'}
            onDelete={dlg.id && W.criteria.length > 1 ? () => Actions.deleteCriterion(dlg.id) : null}
            fields={[
              { k: 'name', label: 'Name' },
              { k: 'weight', label: 'Weight', type: 'number', min: 1, max: 5 },
              { k: 'min', label: 'Minimum score to pass a case', type: 'number', min: 1, max: 5 },
              { k: 'gateAvg', label: 'Gate average required', type: 'number', step: 0.1, min: 1, max: 5 },
              { k: 'desc', label: 'What this measures', type: 'textarea', wide: true, rows: 2 },
              { k: 'a1', label: 'A score of 1 looks like', wide: true },
              { k: 'a3', label: 'A score of 3 looks like', wide: true },
              { k: 'a5', label: 'A score of 5 looks like', wide: true },
            ]}
            onSave={v => { if (!v.name.trim()) { toast('Name the criterion.'); return false; } Actions.saveCriterion(dlg.id, v); }} />
        );
      })() : null}
      {dlg && dlg.kind === 'gate' ? (
        <FormDialog title="Ship gate" onClose={() => setDlg(null)} saveLabel="Save gate"
          initial={{
            overallPass: Math.round(g.overallPass * 100), criticalPass: Math.round(g.criticalPass * 100),
            criterionAvgMin: g.criterionAvgMin, maxRegressions: g.maxRegressions, maxP95: g.maxP95 / 1000,
            maxCostPer1k: g.maxCostPer1k, minLabels: g.minLabels, minAgreement: Math.round(g.minAgreement * 100),
          }}
          fields={[
            { k: 'overallPass', label: 'Overall pass rate required (%)', type: 'number', max: 100 },
            { k: 'criticalPass', label: 'Critical-tier pass rate required (%)', type: 'number', max: 100 },
            { k: 'criterionAvgMin', label: 'Default criterion average', type: 'number', step: 0.1, max: 5 },
            { k: 'maxRegressions', label: 'Regressions allowed', type: 'number' },
            { k: 'maxP95', label: 'Latency p95 budget (seconds)', type: 'number', step: 0.5 },
            { k: 'maxCostPer1k', label: 'Cost budget per 1,000 requests ($)', type: 'number', step: 0.5 },
            { k: 'minLabels', label: 'Human labels needed to validate the judge', type: 'number' },
            { k: 'minAgreement', label: 'Judge agreement required (%)', type: 'number', max: 100 },
          ]}
          onSave={v => {
            Actions.edit(W2 => {
              W2.gate = {
                overallPass: v.overallPass / 100, criticalPass: v.criticalPass / 100,
                criterionAvgMin: v.criterionAvgMin, maxRegressions: v.maxRegressions,
                maxP95: v.maxP95 * 1000, maxCostPer1k: v.maxCostPer1k,
                minLabels: v.minLabels, minAgreement: v.minAgreement / 100,
              };
            });
            toast('Gate saved');
          }} />
      ) : null}
      {dlg && dlg.kind === 'judge' ? (
        <FormDialog title="Judge and cost model" onClose={() => setDlg(null)}
          initial={{ judgeTier: W.judgeTier, ...W.costModel }}
          fields={[
            { k: 'judgeTier', label: 'Judge model tier', type: 'select', options: [['quick', 'quick — fastest, cheapest'], ['default', 'default — balanced'], ['complex', 'complex — most careful']] },
            { k: 'inPerM', label: 'Input price per million tokens ($)', type: 'number', step: 0.1 },
            { k: 'outPerM', label: 'Output price per million tokens ($)', type: 'number', step: 0.1 },
            { k: 'charsPerToken', label: 'Characters per token', type: 'number', step: 0.1 },
          ]}
          onSave={v => {
            Actions.edit(W2 => {
              W2.judgeTier = v.judgeTier;
              W2.costModel = { inPerM: v.inPerM, outPerM: v.outPerM, charsPerToken: v.charsPerToken || 4 };
            });
            toast('Saved');
          }} />
      ) : null}
    </>
  );
}

/* ---- variants ---- */
function Variants({ W, runs, openRun }) {
  const [dlg, setDlg] = useState(null);
  return (
    <>
      <ViewHead title="Variants" desc="Each variant is one configuration of the feature: a prompt and a model tier. Runs are attributed to a variant, so a quality change can be traced to the change that caused it.">
        <button className="btn pri" onClick={() => setDlg({ id: null })}>New variant</button>
      </ViewHead>
      <div className="vcards">
        {W.variants.map(v => {
          const rs = completedRuns(runs).filter(r => r.variantId === v.id);
          const s = rs.length ? stats(W, rs[0]) : null;
          return (
            <section className="panel" key={v.id}>
              <div className="phead">
                <h2>{v.name}</h2>
                {W.baselineVariantId === v.id ? <Chip tone="acc">Baseline</Chip> : null}
              </div>
              {v.notes ? <p className="small muted">{v.notes}</p> : null}
              <pre className="prompt">{v.systemPrompt}</pre>
              <p className="small muted">
                Model tier {v.modelTier} · {plural(rs.length, 'run')}
                {s ? ` · latest pass rate ${pct(s.pass, s.n)}%` : ''}
              </p>
              <div className="headacts" style={{ marginTop: 12 }}>
                <button className="btn sm pri" onClick={() => openRun(v.id)}>Run evaluation</button>
                <button className="btn sm" onClick={() => setDlg({ id: v.id })}>Edit</button>
                <button className="btn sm ghost" onClick={() => setDlg({ id: null, copyOf: v.id })}>Duplicate</button>
              </div>
            </section>
          );
        })}
      </div>
      {dlg ? (() => {
        const src = dlg.copyOf ? findVariant(W, dlg.copyOf) : null;
        const v = dlg.id ? findVariant(W, dlg.id)
          : { name: src ? src.name + ' copy' : 'New variant', systemPrompt: src ? src.systemPrompt : '', modelTier: src ? src.modelTier : 'quick', notes: '' };
        return (
          <FormDialog title={dlg.id ? v.name : 'New variant'} wide onClose={() => setDlg(null)} initial={v}
            saveLabel={dlg.id ? 'Save variant' : 'Create variant'}
            onDelete={dlg.id && W.variants.length > 1 ? () => Actions.deleteVariant(dlg.id) : null}
            fields={[
              { k: 'name', label: 'Name', hint: 'Name the change, e.g. “v3 escalation rules”' },
              { k: 'modelTier', label: 'Model tier', type: 'select', options: MODEL_TIERS },
              { k: 'notes', label: 'What changed and why', type: 'textarea', wide: true, rows: 2 },
              { k: 'systemPrompt', label: 'Prompt', type: 'textarea', wide: true, rows: 12, hint: 'The instruction sent with each case input' },
            ]}
            onSave={x => {
              if (!x.name.trim() || !x.systemPrompt.trim()) { toast('A variant needs a name and a prompt.'); return false; }
              Actions.saveVariant(dlg.id, x);
            }} />
        );
      })() : null}
    </>
  );
}

/* ---- runs and results ---- */
function ResultDrawer({ W, run, caseId, onClose, onStep, live }) {
  const r = run.results.find(x => x.caseId === caseId);
  const c = findCase(W, caseId);
  if (!c) return null;
  const streaming = live && live.caseId === caseId && !r;
  const pass = r ? casePass(W, r) : null;
  return (
    <Drawer open title={c.scenario || 'Result'} subtitle={`${runLabel(W, run)} · ${TIER_LABEL[c.tier]} tier`}
      onClose={onClose} onPrev={() => onStep(-1)} onNext={() => onStep(1)}
      footer={r && !r.error ? (
        <>
          <span className="small muted">Your label</span>
          <span className="sp" />
          <button className={'btn sm' + (r.human && r.human.verdict === 'pass' ? ' pri' : '')} onClick={() => Actions.label(run.id, caseId, 'pass')}>Acceptable</button>
          <button className={'btn sm' + (r.human && r.human.verdict === 'fail' ? ' pri' : '')} onClick={() => Actions.label(run.id, caseId, 'fail')}>Not acceptable</button>
          {r.human && r.human.verdict ? <button className="btn sm ghost" onClick={() => Actions.label(run.id, caseId, null)}>Clear</button> : null}
        </>
      ) : null}>
      <div>
        <div className="cap">Input</div>
        <div className="out">{c.input}</div>
      </div>
      <div>
        <div className="cap">Expected behavior</div>
        <p className="small">{c.expected}</p>
      </div>
      <div>
        <div className="cap">Output{streaming ? ' — writing…' : ''}</div>
        <div className="out">{streaming ? live.text : (r ? (r.error ? `(call failed: ${r.error})` : r.output) : 'Not evaluated in this run.')}</div>
      </div>
      {r && !r.error ? (
        <div>
          <div className="cap">Judge</div>
          <div className="scorerow">
            {W.criteria.map(cr => (
              <span key={cr.id} className="scoretag">
                <ScoreBox n={r.scores[cr.id]} />
                <span className="small">{cr.name}</span>
              </span>
            ))}
          </div>
          <p className="small" style={{ marginTop: 10 }}>{r.rationale}</p>
          <div className="headacts" style={{ marginTop: 10 }}>
            <FailureChip mode={r.failureMode || 'none'} />
            {r.latencyMs ? <Chip>{(r.latencyMs / 1000).toFixed(1)}s</Chip> : null}
            <Chip tone={pass ? 'ok' : 'bad'}>{pass ? 'Passes the rubric' : 'Fails the rubric'}</Chip>
            {r.human && r.human.verdict ? (
              <Chip tone={(r.human.verdict === 'pass') === pass ? 'ok' : 'bad'}>
                {(r.human.verdict === 'pass') === pass ? 'Judge agrees with you' : 'Judge disagrees with you'}
              </Chip>
            ) : null}
          </div>
        </div>
      ) : null}
    </Drawer>
  );
}

function Runs({ W, runs, ui, setUi, openRun, live, running }) {
  const list = runsDesc(runs);
  if (!list.length) {
    return (
      <>
        <ViewHead title="Runs and results" desc="Every evaluation run, case by case." >
          <button className="btn pri" onClick={() => openRun()}>Run evaluation</button>
        </ViewHead>
        <Empty action={<button className="btn pri" onClick={() => openRun()}>Run evaluation</button>}>No runs yet.</Empty>
      </>
    );
  }
  const run = runs[ui.runId] || list[0];
  const s = stats(W, run);
  const filter = ui.resFilter || 'all';
  let results = run.results.slice();
  if (filter === 'fail') results = results.filter(r => !casePass(W, r));
  else if (filter === 'labeled') results = results.filter(r => r.human && r.human.verdict);
  else if (filter === 'disagree') results = results.filter(r => r.human && r.human.verdict && (r.human.verdict === 'pass') !== casePass(W, r));
  results.sort((a, b) => (casePass(W, a) ? 1 : 0) - (casePass(W, b) ? 1 : 0));
  const open = caseId => setUi({ drawer: caseId });
  const step = dir => {
    const i = results.findIndex(r => r.caseId === ui.drawer);
    const next = results[(i + dir + results.length) % Math.max(1, results.length)];
    if (next) setUi({ drawer: next.caseId });
  };
  const isRunning = running && running.runId === run.id;
  return (
    <>
      <ViewHead title="Runs and results" desc="Open a result to see the output, the judge’s scores and reasoning, and to label it yourself. Arrow keys or j and k move between results.">
        <select className="selectlike" value={run.id} onChange={e => setUi({ runId: e.target.value, drawer: null })} aria-label="Run">
          {list.map(r => <option key={r.id} value={r.id}>{runLabel(W, r)} · {fmtTime(r.startedAt)}</option>)}
        </select>
        <button className="btn" onClick={() => Actions.setBaseline(run)} disabled={run.id === W.baselineRunId}>Set as baseline</button>
        <button className="btn pri" onClick={() => openRun()}>Run evaluation</button>
      </ViewHead>
      <div className="tiles">
        <Tile value={`${pct(s.pass, s.n)}%`} label={`pass rate, ${s.pass} of ${s.n}`} />
        <Tile value={s.weighted.toFixed(2)} label="weighted score out of 5" />
        <Tile value={`${(s.p95 / 1000).toFixed(1)}s`} label="p95 latency" />
        <Tile value={money(s.costPer1k)} label="per 1,000 requests" />
        <Tile value={s.agreeRate == null ? '—' : `${pct(s.agree, s.labeled)}%`} label={`judge agreement on ${plural(s.labeled, 'label')}`} />
      </div>
      {run.synthetic ? <p className="banner">Sample data: this run ships with the demo so the console has something to show. Your own runs call the model live.</p> : null}
      {isRunning ? <p className="banner acc">Running now: {running.done} of {running.total} cases graded. Results appear as they finish.</p> : null}
      <div className="toolbar">
        <Segmented size="sm" value={filter} onChange={v => setUi({ resFilter: v })}
          options={[['all', 'All'], ['fail', 'Failures'], ['labeled', 'Labeled'], ['disagree', 'Disagreements']]} />
        <Segmented size="sm" value={ui.resView || 'table'} onChange={v => setUi({ resView: v })}
          options={[['table', 'Table'], ['matrix', 'Matrix']]} />
        <span className="sp" />
        <button className="btn sm ghost danger" onClick={() => Actions.deleteRun(run.id)}>Delete run</button>
      </div>
      {(ui.resView || 'table') === 'matrix' ? (
        <Panel>
          <div className="matrix" style={{ gridTemplateColumns: `minmax(140px, 1.6fr) repeat(${W.criteria.length}, 34px) 64px` }}>
            <div className="mh" />
            {W.criteria.map(c => <div key={c.id} className="mh rot" title={c.name}>{c.name.split(' ')[0]}</div>)}
            <div className="mh">Verdict</div>
            {results.map(r => {
              const c = findCase(W, r.caseId) || {};
              return (
                <React.Fragment key={r.caseId}>
                  <button className="mcell name" onClick={() => open(r.caseId)}>{c.scenario || '—'}<span className="small muted"> {String(c.input || '').slice(0, 40)}…</span></button>
                  {W.criteria.map(cr => (
                    <button key={cr.id} className="mcell" onClick={() => open(r.caseId)} title={`${cr.name}: ${(r.scores || {})[cr.id] || '—'}`}>
                      <ScoreBox n={(r.scores || {})[cr.id]} />
                    </button>
                  ))}
                  <button className="mcell" onClick={() => open(r.caseId)}>
                    {r.error ? <Chip>Error</Chip> : casePass(W, r) ? <Chip tone="ok">Pass</Chip> : <Chip tone="bad">Fail</Chip>}
                  </button>
                </React.Fragment>
              );
            })}
          </div>
        </Panel>
      ) : (
        <Panel className="flush">
          <div className="tblwrap">
            <table>
              <thead>
                <tr>
                  <th>Case</th><th>Tier</th><th>Verdict</th><th>Failure mode</th>
                  {W.criteria.map(c => <th key={c.id} className="num" title={c.name}>{c.name.split(' ')[0]}</th>)}
                  <th className="num">Latency</th><th>Judge said</th><th>You</th>
                </tr>
              </thead>
              <tbody>
                {results.map(r => {
                  const c = findCase(W, r.caseId) || { input: '(deleted case)', tier: 'standard' };
                  return (
                    <tr key={r.caseId} className="rowlink" onClick={() => open(r.caseId)}>
                      <td className="clamp">{c.input}</td>
                      <td><TierChip tier={c.tier} /></td>
                      <td>{r.error ? <Chip>Error</Chip> : casePass(W, r) ? <Chip tone="ok">Pass</Chip> : <Chip tone="bad">Fail</Chip>}</td>
                      <td><FailureChip mode={r.error ? 'error' : (r.failureMode || 'none')} /></td>
                      {W.criteria.map(cr => <td key={cr.id} className="num"><ScoreBox n={(r.scores || {})[cr.id]} /></td>)}
                      <td className="num small">{r.latencyMs ? `${(r.latencyMs / 1000).toFixed(1)}s` : '—'}</td>
                      <td className="clamp small muted">{r.rationale}</td>
                      <td>{r.human && r.human.verdict ? <Chip tone={r.human.verdict === 'pass' ? 'ok' : 'bad'}>{r.human.verdict === 'pass' ? 'Pass' : 'Fail'}</Chip> : <span className="muted small">—</span>}</td>
                    </tr>
                  );
                })}
                {!results.length ? <tr><td colSpan={5 + W.criteria.length} className="empty">Nothing matches this filter.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      {ui.drawer ? <ResultDrawer W={W} run={run} caseId={ui.drawer} live={live} onClose={() => setUi({ drawer: null })} onStep={step} /> : null}
    </>
  );
}

/* ---- compare ---- */
function Compare({ W, runs, ui, setUi }) {
  const list = completedRuns(runs);
  if (list.length < 2) {
    return (
      <>
        <ViewHead title="Compare runs" desc="Baseline against candidate: what improved, what regressed, and whether it clears the gate." />
        <Empty>Two completed runs are needed to compare. Run the golden set against a second variant.</Empty>
      </>
    );
  }
  const a = runs[ui.cmpA] || baselineOf(W, runs) || list[1];
  const b = runs[ui.cmpB] && runs[ui.cmpB].id !== a.id ? runs[ui.cmpB] : list.find(r => r.id !== a.id);
  const sa = stats(W, a), sb = stats(W, b);
  const reg = regressions(W, a, b), imp = improvements(W, a, b);
  const v = verdictOf(W, b, a);
  const Delta = ({ from, to, dp = 0, suffix = '' }) => {
    const d = to - from;
    return <Chip tone={Math.abs(d) < 1e-9 ? undefined : d > 0 ? 'ok' : 'bad'}>{(d > 0 ? '+' : '') + d.toFixed(dp) + suffix}</Chip>;
  };
  const sel = (val, key) => (
    <select className="selectlike" value={val} onChange={e => setUi({ [key]: e.target.value })} aria-label={key === 'cmpA' ? 'Baseline run' : 'Candidate run'}>
      {list.map(r => <option key={r.id} value={r.id}>{runLabel(W, r)}</option>)}
    </select>
  );
  return (
    <>
      <ViewHead title="Compare runs" desc="Baseline against candidate.">
        {sel(a.id, 'cmpA')}<span className="muted">vs</span>{sel(b.id, 'cmpB')}
      </ViewHead>
      <div className="stack">
        <Panel>
          <div className="vcard">
            <div className={'vbadge ' + v.cls}>
              <b>{v.v}</b>
              <span>{runLabel(W, b)} against {runLabel(W, a)}</span>
            </div>
            <div>
              <div className="tiles compact">
                <Tile value={`${pct(sb.pass, sb.n)}%`} label={<>pass rate <Delta from={pct(sa.pass, sa.n)} to={pct(sb.pass, sb.n)} suffix=" pts" /></>} />
                <Tile value={reg.length} label="regressions" tone={reg.length ? 'bad' : undefined} />
                <Tile value={imp.length} label="newly passing" tone={imp.length ? 'ok' : undefined} />
                <Tile value={money(sb.costPer1k)} label={<>per 1k <Delta from={sa.costPer1k} to={sb.costPer1k} dp={2} /></>} />
                <Tile value={`${(sb.p95 / 1000).toFixed(1)}s`} label={<>p95 <Delta from={sa.p95 / 1000} to={sb.p95 / 1000} dp={1} suffix="s" /></>} />
              </div>
              <div style={{ marginTop: 14 }}>
                {W.criteria.map(c => (
                  <Bar key={c.id} label={c.name} value={sb.crit[c.id] || 0} max={5}
                    tone={(sb.crit[c.id] || 0) >= (sa.crit[c.id] || 0) ? 'ok' : 'bad'}
                    text={`${(sb.crit[c.id] || 0).toFixed(2)} ${(sb.crit[c.id] || 0) >= (sa.crit[c.id] || 0) ? '▲' : '▼'}`} />
                ))}
              </div>
            </div>
          </div>
        </Panel>
        <div className="grid2">
          <Panel title="Regressions">
            <p className="small muted">Cases the baseline passed and the candidate fails. These are what block a ship decision.</p>
            <ul className="list1" style={{ marginTop: 8 }}>
              {reg.map(r => {
                const c = findCase(W, r.caseId) || {};
                return (
                  <li key={r.caseId}>
                    <Chip tone="bad">{FM_LABEL[r.failureMode] || 'Fail'}</Chip>
                    <div className="sp">
                      <div className="clamp">{c.input}</div>
                      <div className="small muted">{r.rationale}</div>
                    </div>
                  </li>
                );
              })}
              {!reg.length ? <li className="muted">None. The candidate keeps everything the baseline got right.</li> : null}
            </ul>
          </Panel>
          <Panel title="Newly passing">
            <p className="small muted">Cases the candidate fixed.</p>
            <ul className="list1" style={{ marginTop: 8 }}>
              {imp.map(r => {
                const c = findCase(W, r.caseId) || {};
                return (
                  <li key={r.caseId}>
                    <Chip tone="ok">Fixed</Chip>
                    <div className="sp">
                      <div className="clamp">{c.input}</div>
                      <div className="small muted">{r.rationale}</div>
                    </div>
                  </li>
                );
              })}
              {!imp.length ? <li className="muted">None.</li> : null}
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}

/* ---- report ---- */
function Report({ W, runs }) {
  const st = useStore();
  const cand = latestOf(W, runs), base = baselineOf(W, runs);
  const [busy, setBusy] = useState(false);
  const md = useMemo(() => reportMarkdown(W, cand, base), [W, cand, base]);
  const copy = () => {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(md).then(() => toast('Report copied'), () => toast('Copy failed; select the text instead.'));
    else toast('Select the text and copy it manually.');
  };
  const analyze = async () => {
    setBusy(true);
    try { await draftAnalysis(W, cand, base); }
    catch (e) { toast(e && e.code === 'not_granted' ? 'Model access was declined for this view.' : 'That failed: ' + ((e && e.code) || 'error')); }
    finally { setBusy(false); }
  };
  return (
    <>
      <ViewHead title="Report" desc="A shareable write-up of the latest run: the gate, the numbers, the regressions, and the method. Export it into your repo as docs/eval-report.md.">
        {st.sample && cand ? <button className="btn" onClick={analyze} disabled={busy}>{busy ? 'Writing…' : 'Draft the analysis with Claude'}</button> : null}
        <button className="btn" onClick={() => saveFile('eval-report.md', md)}>Export report</button>
        <button className="btn" onClick={() => saveFile('eval-results.csv', resultsCsv(W, cand))}>Results CSV</button>
        <button className="btn" onClick={() => saveFile('golden-set.jsonl', goldenJsonl(W))}>Golden set</button>
        <button className="btn pri" onClick={copy}>Copy markdown</button>
      </ViewHead>
      <Panel><pre className="report">{md}</pre></Panel>
    </>
  );
}
