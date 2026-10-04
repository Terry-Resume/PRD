/* ui.jsx — presentational primitives shared by every view. */

const { useState, useEffect, useMemo, useRef, useCallback, useSyncExternalStore } = React;

const useStore = () => useSyncExternalStore(Store.subscribe, Store.snapshot);

function useTheme() {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem(LS_THEME) || 'system'; } catch (e) { return 'system'; }
  });
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;
    try { localStorage.setItem(LS_THEME, theme); } catch (e) { /* ignore */ }
  }, [theme]);
  return [theme, setTheme];
}

/* Close on Escape, trap focus loosely, restore focus on unmount. */
function useDismiss(open, onClose) {
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.activeElement;
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (prev && prev.focus) prev.focus();
    };
  }, [open, onClose]);
}

const Chip = ({ tone, children, title }) => <span className={'chip' + (tone ? ' ' + tone : '')} title={title}>{children}</span>;

const Meter = ({ value, max, tone }) => (
  <div className={'meter' + (tone ? ' ' + tone : '')}>
    <i style={{ width: Math.max(0, Math.min(100, max ? (value / max) * 100 : 0)) + '%' }} />
  </div>
);

const Bar = ({ label, value, max, text, tone }) => (
  <div className="barrow">
    <span className="barlabel">{label}</span>
    <Meter value={value} max={max} tone={tone} />
    <span className="val">{text}</span>
  </div>
);

const Tile = ({ value, label, tone, hint }) => (
  <div className="tile" title={hint}>
    <b style={tone ? { color: `var(--${tone})` } : undefined}>{value}</b>
    <span>{label}</span>
  </div>
);

const ScoreBox = ({ n }) => {
  const v = Math.max(1, Math.min(5, Math.round(n || 0)));
  return <span className={'scorebox s' + (n ? v : 0)} title={n ? n.toFixed(1) : 'not scored'}>{n ? Math.round(n) : '–'}</span>;
};

const TierChip = ({ tier }) => <span className={'tier tier-' + tier}>{TIER_LABEL[tier] || tier}</span>;

const FailureChip = ({ mode }) => (
  <span className="chip" style={{
    borderColor: 'transparent',
    background: `color-mix(in srgb, ${FM_COLOR[mode] || 'var(--muted)'} 18%, transparent)`,
    color: FM_COLOR[mode] || 'var(--muted)',
  }}>{FM_LABEL[mode] || mode}</span>
);

/* Pass rate across runs, oldest first — the only trend that matters at a glance. */
function Sparkline({ values, width = 220, height = 46 }) {
  if (!values.length) return null;
  const max = 100, pad = 3;
  const x = i => pad + (i * (width - pad * 2)) / Math.max(1, values.length - 1);
  const y = v => pad + (height - pad * 2) * (1 - v / max);
  const d = values.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
  const area = `${d} L ${x(values.length - 1).toFixed(1)} ${height - pad} L ${x(0).toFixed(1)} ${height - pad} Z`;
  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Pass rate across runs">
      <path d={area} fill="var(--soft)" />
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={i === values.length - 1 ? 3.5 : 2} fill={i === values.length - 1 ? 'var(--accent)' : 'var(--panel)'} stroke="var(--accent)" strokeWidth="1.5" />)}
    </svg>
  );
}

function FailureBar({ fm, n }) {
  const keys = Object.keys(fm).sort((a, b) => (a === 'none' ? -1 : b === 'none' ? 1 : fm[b] - fm[a]));
  if (!n) return null;
  return (
    <>
      <div className="fmbar">
        {keys.map(k => <i key={k} style={{ width: (fm[k] / n) * 100 + '%', background: FM_COLOR[k] || 'var(--muted)' }} title={`${FM_LABEL[k] || k}: ${fm[k]}`} />)}
      </div>
      <div className="fmleg">
        {keys.map(k => <span key={k}><i className="dot" style={{ background: FM_COLOR[k] || 'var(--muted)' }} />{FM_LABEL[k] || k} {fm[k]}</span>)}
      </div>
    </>
  );
}

const Segmented = ({ options, value, onChange, size }) => (
  <div className={'segmented' + (size === 'sm' ? ' sm' : '')} role="tablist">
    {options.map(([v, l]) => (
      <button key={v} role="tab" aria-selected={v === value} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>
    ))}
  </div>
);

const ViewHead = ({ title, desc, children }) => (
  <div className="viewhead">
    <div><h1>{title}</h1>{desc ? <p>{desc}</p> : null}</div>
    <span className="sp" />
    <div className="headacts">{children}</div>
  </div>
);

const Panel = ({ title, actions, children, className }) => (
  <section className={'panel' + (className ? ' ' + className : '')}>
    {(title || actions) && (
      <div className="phead">
        {typeof title === 'string' ? <h2>{title}</h2> : title}
        {actions ? <div className="headacts">{actions}</div> : null}
      </div>
    )}
    {children}
  </section>
);

const Empty = ({ children, action }) => <div className="panel empty"><p>{children}</p>{action ? <div style={{ marginTop: 12 }}>{action}</div> : null}</div>;

/* ---- dialog ---- */
function Dialog({ title, children, footer, onClose, wide }) {
  useDismiss(true, onClose);
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current && ref.current.querySelector('input, textarea, select, button.pri, button');
    if (el) el.focus();
  }, []);
  return (
    <div className="modal">
      <div className="scrim" onClick={onClose} />
      <div className={'dialog' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header><h2>{title}</h2><button className="x" onClick={onClose} aria-label="Close">×</button></header>
        <div className="dbody">{children}</div>
        {footer ? <footer>{footer}</footer> : null}
      </div>
    </div>
  );
}

function Field({ f, value, onChange }) {
  const id = 'f_' + f.k;
  const common = { id, name: f.k, value: value ?? '', onChange: e => onChange(f.k, e.target.value) };
  let input;
  if (f.type === 'select') input = <select {...common}>{f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>;
  else if (f.type === 'textarea') input = <textarea {...common} rows={f.rows || 4} />;
  else input = <input {...common} type={f.type || 'text'} step={f.step} min={f.min} max={f.max} />;
  return (
    <label className={'fld' + (f.wide ? ' wide' : '')} htmlFor={id}>
      <span>{f.label}</span>
      {input}
      {f.hint ? <small>{f.hint}</small> : null}
    </label>
  );
}

function FormDialog({ title, fields = [], initial = {}, onSave, onClose, onDelete, saveLabel = 'Save', deleteLabel = 'Delete', note, children, wide }) {
  const [vals, setVals] = useState(() => {
    const v = {};
    fields.forEach(f => { v[f.k] = initial[f.k] ?? (f.type === 'number' ? 0 : ''); });
    return v;
  });
  const change = (k, v) => setVals(s => ({ ...s, [k]: v }));
  const submit = e => {
    e.preventDefault();
    const out = {};
    fields.forEach(f => { out[f.k] = f.type === 'number' ? Number(vals[f.k] || 0) : vals[f.k]; });
    if (onSave(out) !== false) onClose();
  };
  return (
    <Dialog title={title} onClose={onClose} wide={wide}
      footer={
        <>
          {onDelete ? <button type="button" className="btn danger" onClick={() => { onClose(); onDelete(); }}>{deleteLabel}</button> : null}
          <span className="sp" />
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          {onSave ? <button type="submit" form="formdlg" className="btn pri">{saveLabel}</button> : null}
        </>
      }>
      <form id="formdlg" onSubmit={submit}>
        {children}
        {fields.length ? <div className="fgrid">{fields.map(f => <Field key={f.k} f={f} value={vals[f.k]} onChange={change} />)}</div> : null}
        {note ? <p className="small muted">{note}</p> : null}
      </form>
    </Dialog>
  );
}

/* ---- right-side drawer: keeps the results table visible while you read one result ---- */
function Drawer({ open, title, subtitle, onClose, onPrev, onNext, children, footer }) {
  useDismiss(open, onClose);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = e => {
      if (e.target.closest && e.target.closest('input, textarea, select')) return;
      if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); onNext && onNext(); }
      if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); onPrev && onPrev(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onPrev, onNext]);
  if (!open) return null;
  return (
    <div className="drawerwrap">
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <div>
            <h2>{title}</h2>
            {subtitle ? <p className="small muted">{subtitle}</p> : null}
          </div>
          <div className="headacts">
            <button className="btn sm ghost" onClick={onPrev} aria-label="Previous result" title="Previous (k)">↑</button>
            <button className="btn sm ghost" onClick={onNext} aria-label="Next result" title="Next (j)">↓</button>
            <button className="x" onClick={onClose} aria-label="Close">×</button>
          </div>
        </header>
        <div className="drawerbody">{children}</div>
        {footer ? <footer>{footer}</footer> : null}
      </aside>
    </div>
  );
}

function Toaster() {
  const items = useSyncExternalStore(Toasts.subscribe, Toasts.snapshot);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map(t => <div key={t.id} className={'toast' + (t.tone ? ' ' + t.tone : '')}>{t.message}</div>)}
    </div>
  );
}

/* ---- command palette: every action reachable from the keyboard ---- */
function CommandPalette({ open, onClose, commands }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  useDismiss(open, onClose);
  useEffect(() => { if (open) { setQ(''); setSel(0); } }, [open]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return commands.filter(c => !s || (c.name + ' ' + (c.group || '')).toLowerCase().includes(s)).slice(0, 9);
  }, [q, commands]);
  if (!open) return null;
  const run = c => { onClose(); c.run(); };
  return (
    <div className="modal pal">
      <div className="scrim" onClick={onClose} />
      <div className="palbox" role="dialog" aria-modal="true" aria-label="Commands">
        <input autoFocus value={q} placeholder="Jump to a view or run a command…" aria-label="Command"
          onChange={e => { setQ(e.target.value); setSel(0); }}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(list.length - 1, s + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)); }
            if (e.key === 'Enter' && list[sel]) { e.preventDefault(); run(list[sel]); }
          }} />
        <ul>
          {list.map((c, i) => (
            <li key={c.name}>
              <button className={i === sel ? 'on' : ''} onMouseEnter={() => setSel(i)} onClick={() => run(c)}>
                <span>{c.name}</span><span className="muted small">{c.group}</span>
              </button>
            </li>
          ))}
          {!list.length ? <li className="muted small" style={{ padding: '10px 14px' }}>Nothing matches.</li> : null}
        </ul>
      </div>
    </div>
  );
}
