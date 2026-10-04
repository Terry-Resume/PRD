/* App.jsx — shell: navigation, top bar, run bar, command palette, routing. */

const NAV = [
  ['Evaluate', [['overview', 'Overview'], ['cases', 'Golden set'], ['rubric', 'Rubric & gate'], ['variants', 'Variants']]],
  ['Evidence', [['runs', 'Runs & results'], ['compare', 'Compare'], ['report', 'Report']]],
];

const Logo = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
    <circle cx="10" cy="10" r="9" fill="none" stroke="var(--accent)" strokeWidth="2" />
    <path d="M5.5 10.5l3 3 6-7" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function Sidebar({ W, runs, view, go, theme, setTheme, shared }) {
  const counts = { cases: W.cases.length, variants: W.variants.length, runs: Object.keys(runs).length };
  return (
    <aside className="nav" aria-label="Views">
      <div className="brand"><Logo /><span>Verdict</span></div>
      <nav>
        {NAV.map(([group, items]) => (
          <div className="navgroup" key={group}>
            <span>{group}</span>
            {items.map(([k, l]) => (
              <button key={k} className="navbtn" aria-current={view === k ? 'page' : undefined} onClick={() => go(k)}>
                <span>{l}</span>
                {counts[k] != null ? <span className="num">{counts[k]}</span> : null}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="navfoot">
        <Segmented size="sm" value={theme} onChange={setTheme} options={[['light', 'Light'], ['dark', 'Dark'], ['system', 'Auto']]} />
        <p className="small muted">{shared ? 'Shared with everyone who opens this page' : 'Saved in this browser'}</p>
      </div>
    </aside>
  );
}

function TopBar({ W, runs, sample, onRun, onFeature, onPalette }) {
  const cand = latestOf(W, runs), base = baselineOf(W, runs);
  const v = cand ? verdictOf(W, cand, base && base.id !== cand.id ? base : null) : null;
  return (
    <header className="top">
      <button className="feat" onClick={onFeature} title="Edit the feature under test">
        <h1>{W.feature.name}</h1>
        <small>{W.feature.surface}</small>
      </button>
      <span className="sp" />
      {v ? <Chip tone={v.cls}>{v.v}</Chip> : null}
      {sample === null ? <Chip tone="warn" title="Live model calls are unavailable in this view">Sampling off</Chip> : null}
      <button className="btn ghost kbd" onClick={onPalette} aria-label="Open commands">⌘K</button>
      <button className="btn pri" onClick={() => onRun()}>Run evaluation</button>
    </header>
  );
}

function RunBar({ running }) {
  if (!running) return null;
  const elapsed = (Date.now() - running.startedAt) / 1000;
  const per = running.done ? elapsed / running.done : 0;
  const left = running.done ? Math.max(0, Math.round((running.total - running.done) * per)) : null;
  return (
    <div className="runbar">
      <span>Evaluating case {Math.min(running.done + 1, running.total)} of {running.total}</span>
      <Meter value={running.done} max={running.total} />
      <span className="small">{left != null ? `about ${left}s left` : 'starting…'}</span>
      <button className="btn sm" onClick={() => { running.ctl.abort(); toast('Stopping after the cases in flight…'); }}>Stop</button>
    </div>
  );
}

function FeatureDialog({ W, onClose }) {
  return (
    <FormDialog title="Feature under test" onClose={onClose} initial={W.feature}
      fields={[
        { k: 'name', label: 'Feature name' },
        { k: 'surface', label: 'Surface', hint: 'Where it runs, e.g. the reply box in the agent console' },
        { k: 'desc', label: 'What it does', type: 'textarea', wide: true, rows: 3 },
      ]}
      onSave={v => { Actions.edit(W2 => { W2.feature = { ...W2.feature, ...v }; }); toast('Saved'); }}
      onDelete={() => Actions.reset()} deleteLabel="Reset to sample project"
      note="Resetting deletes the current feature, golden set, rubric, variants, and every run, for everyone who uses this page." />
  );
}

function App() {
  const st = useStore();
  const [theme, setTheme] = useTheme();
  const [ui, setUiState] = useState({ view: 'overview', runId: null, resFilter: 'all', resView: 'table', caseQ: '', tier: 'all', drawer: null, cmpA: null, cmpB: null });
  const [runDlg, setRunDlg] = useState(null);
  const [featureDlg, setFeatureDlg] = useState(false);
  const [palette, setPalette] = useState(false);
  const setUi = patch => setUiState(s => ({ ...s, ...patch }));
  const go = view => { setUi({ view, drawer: null }); const m = document.querySelector('.mainwrap'); if (m) m.scrollTop = 0; };
  const openRun = variantId => setRunDlg({ variantId: variantId || null });

  /* keep the run bar's "time left" moving */
  const [, tick] = useState(0);
  useEffect(() => {
    if (!st.running) return undefined;
    const t = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, [st.running]);

  useEffect(() => {
    const onKey = e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(p => !p); }
      const typing = e.target.closest && e.target.closest('input, textarea, select');
      if (!typing && !e.metaKey && !e.ctrlKey && e.key.toLowerCase() === 'r' && !st.running) { e.preventDefault(); openRun(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [st.running]);

  useEffect(() => {
    const warn = e => { if (Store.state.running) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  if (!st.W) {
    return (
      <div className="boot">
        <Logo />
        <p className="muted">Loading the console…</p>
      </div>
    );
  }
  const W = st.W, runs = st.runs;
  const commands = [
    ...NAV.flatMap(([group, items]) => items.map(([k, l]) => ({ name: l, group: 'Go to', run: () => go(k) }))),
    { name: 'Run evaluation', group: 'Action', run: () => openRun() },
    { name: 'Add a case', group: 'Action', run: () => { go('cases'); setTimeout(() => document.querySelector('.headacts .btn.pri').click(), 60); } },
    { name: 'Copy the report', group: 'Action', run: () => { navigator.clipboard && navigator.clipboard.writeText(reportMarkdown(W, latestOf(W, runs), baselineOf(W, runs))).then(() => toast('Report copied'), () => {}); } },
    { name: 'Edit the feature under test', group: 'Action', run: () => setFeatureDlg(true) },
    { name: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', group: 'View', run: () => setTheme(theme === 'dark' ? 'light' : 'dark') },
  ];
  const viewProps = { W, runs, ui, setUi, go, openRun, live: st.live, running: st.running };
  const View = { overview: Overview, cases: Cases, rubric: Rubric, variants: Variants, runs: Runs, compare: Compare, report: Report }[ui.view] || Overview;
  return (
    <div className="app">
      <Sidebar W={W} runs={runs} view={ui.view} go={go} theme={theme} setTheme={setTheme} shared={st.shared} />
      <div className="mainwrap">
        <RunBar running={st.running} />
        <TopBar W={W} runs={runs} sample={st.sample} onRun={openRun} onFeature={() => setFeatureDlg(true)} onPalette={() => setPalette(true)} />
        <main className="main"><View {...viewProps} /></main>
      </div>
      {runDlg ? <RunDialog W={W} runs={runs} variantId={runDlg.variantId} onClose={() => setRunDlg(null)} /> : null}
      {featureDlg ? <FeatureDialog W={W} onClose={() => setFeatureDlg(false)} /> : null}
      <CommandPalette open={palette} onClose={() => setPalette(false)} commands={commands} />
      <Toaster />
    </div>
  );
}

Store.init();
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
