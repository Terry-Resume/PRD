/* store.js — state outside React: persistence (shared db or local), the
   sampling capability, and the run engine. Components subscribe through
   useSyncExternalStore, so every write lands in one place. */

const LS_KEY = 'verdict:v2';
const LS_THEME = 'verdict:theme';

const Store = {
  state: { W: null, runs: {}, running: null, live: null, sample: undefined, downloads: null, shared: false, ready: false },
  listeners: new Set(),
  db: null,
  queues: {},
  timers: {},

  subscribe(fn) { Store.listeners.add(fn); return () => Store.listeners.delete(fn); },
  snapshot() { return Store.state; },
  set(patch) { Store.state = { ...Store.state, ...patch }; Store.listeners.forEach(fn => fn()); },
  touch() { Store.set({}); },

  /* ---- persistence ---- */
  localLoad() {
    try {
      const j = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      if (j && j.W) return { W: j.W, runs: j.runs || {} };
    } catch (e) { /* ignore */ }
    return null;
  },
  localSave() {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ W: Store.state.W, runs: Store.state.runs })); } catch (e) { /* quota */ }
  },
  enqueue(path, fn) {
    const p = (Store.queues[path] || Promise.resolve()).then(fn).catch(e => {
      console.error(e);
      toast(e && (e.code === 'permission_denied' || e.code === 'not_granted')
        ? 'You have view-only access, so this change wasn’t saved.'
        : 'A change didn’t save.');
    });
    Store.queues[path] = p;
    return p;
  },

  /* Mutate the workspace: pass a function that edits a draft. */
  editW(fn) {
    const W = clone(Store.state.W);
    fn(W);
    Store.set({ W });
    if (Store.db) {
      clearTimeout(Store.timers.W);
      Store.timers.W = setTimeout(() => {
        const body = clone(Store.state.W);
        Store.enqueue('workspace/main', () => Store.db.doc('workspace/main').set(body));
      }, 250);
    } else Store.localSave();
  },
  putRun(run, immediate) {
    const runs = { ...Store.state.runs, [run.id]: run };
    Store.set({ runs });
    if (!Store.db) { Store.localSave(); return; }
    const go = () => { const b = clone(run); Store.enqueue('runs/' + run.id, () => Store.db.doc('runs/' + run.id).set(b)); };
    clearTimeout(Store.timers[run.id]);
    if (immediate) go(); else Store.timers[run.id] = setTimeout(go, 1200);
  },
  dropRun(id) {
    const runs = { ...Store.state.runs };
    delete runs[id];
    Store.set({ runs });
    if (Store.db) Store.enqueue('runs/' + id, () => Store.db.doc('runs/' + id).delete());
    else Store.localSave();
  },

  /* ---- sampling ---- */
  async sample() {
    if (Store.state.sample !== undefined) return Store.state.sample;
    let s = null;
    if (window.claude && typeof window.claude.use === 'function') {
      try { s = await window.claude.use('sample'); } catch (e) { s = null; }
    }
    Store.set({ sample: s });
    return s;
  },

  /* ---- boot ---- */
  async init() {
    let db = null;
    if (window.claude && typeof window.claude.use === 'function') {
      try {
        db = await Promise.race([window.claude.use('db'), new Promise(r => setTimeout(() => r(null), 6000))]);
      } catch (e) { db = null; }
      window.claude.use('downloads').then(d => Store.set({ downloads: d })).catch(() => {});
      Store.sample();
    } else {
      Store.set({ sample: null });
    }

    const offline = () => {
      const local = Store.localLoad();
      if (local) Store.set({ ...local, ready: true });
      else { const d = demoData(); Store.set({ W: d.W, runs: d.RUNS, ready: true }); Store.localSave(); }
    };

    if (!db) { offline(); return; }
    Store.db = db;
    Store.set({ shared: true });
    let gotW = false, gotR = false, seeded = false;
    const fail = err => {
      console.error(err);
      if (!gotW || !gotR) {
        Store.db = null;
        Store.set({ shared: false });
        offline();
        toast('Shared storage isn’t available here, so changes stay in this browser.');
      }
    };
    const ready = async () => {
      if (!gotW || !gotR) return;
      if (!Store.state.W && !seeded) {
        seeded = true;
        const d = demoData();
        Store.set({ W: d.W, runs: d.RUNS, ready: true });
        try {
          await db.doc('workspace/main').set(clone(d.W));
          for (const r of Object.values(d.RUNS)) await db.doc('runs/' + r.id).set(clone(r));
        } catch (e) {
          console.error(e);
          toast('The sample project couldn’t be saved. You may have view-only access.');
        }
        return;
      }
      Store.set({ ready: true });
    };
    db.doc('workspace/main').onSnapshot(s => {
      if (s.exists) Store.set({ W: clone(s.data()) });
      else if (!seeded) Store.set({ W: null });
      gotW = true; ready();
    }, fail);
    db.collection('runs').onSnapshot(q => {
      const n = {};
      q.docs.forEach(d => { n[d.id] = clone(d.data()); });
      const running = Store.state.running;
      if (running && Store.state.runs[running.runId]) n[running.runId] = Store.state.runs[running.runId];
      if (seeded && !Object.keys(n).length) return;
      Store.set({ runs: n });
      gotR = true; ready();
    }, fail);
  },
};

/* ---- toasts ---- */
let toastId = 0;
const Toasts = { items: [], listeners: new Set(), subscribe(fn) { Toasts.listeners.add(fn); return () => Toasts.listeners.delete(fn); }, snapshot() { return Toasts.items; } };
function toast(message, tone) {
  const id = ++toastId;
  Toasts.items = [...Toasts.items, { id, message, tone }];
  Toasts.listeners.forEach(f => f());
  setTimeout(() => {
    Toasts.items = Toasts.items.filter(t => t.id !== id);
    Toasts.listeners.forEach(f => f());
  }, 4200);
}

/* ---- the run engine ----
   Two model calls per case: one to produce the output, one to grade it.
   Output streams into state so the drawer can show it being written. */
async function evalCase(sample, W, variant, c, signal, onDelta) {
  const prompt = `${variant.systemPrompt}\n\n---\nUser message:\n${c.input}\n\nWrite only the reply the feature would send.`;
  const t0 = Date.now();
  const gen = await sample(prompt, {
    modelTier: variant.modelTier || 'quick',
    signal,
    onText: onDelta ? ({ text }) => onDelta(c.id, text) : undefined,
  });
  const latencyMs = Date.now() - t0;
  const j = await sample.json(judgePrompt(W, c, gen.text), { modelTier: W.judgeTier || 'default', signal });
  const scores = {};
  W.criteria.forEach(cr => {
    const n = Number(j && j.scores ? j.scores[cr.id] : 0);
    scores[cr.id] = Math.max(1, Math.min(5, Math.round(n || 0))) || 1;
  });
  return {
    caseId: c.id,
    output: String(gen.text || '').slice(0, 6000),
    promptChars: prompt.length,
    latencyMs,
    scores,
    failureMode: FM_LABEL[j && j.failureMode] ? j.failureMode : 'none',
    rationale: String((j && j.rationale) || '').slice(0, 400),
  };
}

async function startRun(variantId, caseIds, label) {
  const st = Store.state;
  if (st.running) { toast('A run is already going.'); return; }
  const sample = await Store.sample();
  if (!sample) { toast('Live model calls aren’t available in this view, so a run can’t be started.'); return; }
  const W = st.W;
  const variant = findVariant(W, variantId);
  if (!variant) return;
  const ctl = new AbortController();
  const run = {
    id: uid(), variantId, label: label || variant.name,
    startedAt: new Date().toISOString(), status: 'running', results: [], caseIds,
  };
  Store.set({ running: { runId: run.id, done: 0, total: caseIds.length, ctl, startedAt: Date.now() }, live: null });
  Store.putRun(run, true);

  let i = 0, stopCode = null;
  const onDelta = (caseId, text) => Store.set({ live: { caseId, text } });
  async function worker() {
    while (i < caseIds.length && !ctl.signal.aborted) {
      const c = findCase(W, caseIds[i++]);
      if (!c) continue;
      try {
        run.results = [...run.results, await evalCase(sample, W, variant, c, ctl.signal, onDelta)];
      } catch (e) {
        const code = (e && e.code) || 'error';
        if (code === 'cancelled') break;
        run.results = [...run.results, {
          caseId: c.id, error: code, output: (e && e.text) || '', scores: {},
          failureMode: 'error', rationale: 'The call failed: ' + code, latencyMs: 0, promptChars: 0,
        }];
        if (['not_granted', 'rate_limited', 'session_expired', 'sampling_disabled'].includes(code)) { stopCode = code; ctl.abort(); break; }
      }
      Store.set({ running: { ...Store.state.running, done: run.results.length } });
      Store.putRun({ ...run });
    }
  }
  await Promise.all([worker(), worker()]);
  run.status = ctl.signal.aborted ? 'stopped' : 'done';
  run.finishedAt = new Date().toISOString();
  Store.set({ running: null, live: null });
  Store.putRun({ ...run }, true);
  if (!Store.state.W.baselineRunId) Store.editW(W2 => { W2.baselineRunId = run.id; W2.baselineVariantId = run.variantId; });
  const s = stats(Store.state.W, run);
  if (stopCode === 'not_granted') toast('The run stopped: this view declined model access.');
  else if (stopCode === 'rate_limited') toast('The run stopped: too many model calls at once. Try again in a minute.');
  else if (stopCode) toast('The run stopped: ' + stopCode);
  else toast(`Run finished: ${s.pass} of ${s.n} cases passed.`);
  return run.id;
}

async function saveFile(filename, data) {
  const dl = Store.state.downloads;
  if (!dl) {
    /* outside claude.ai: a plain browser download */
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'text/plain;charset=utf-8' }));
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return;
  }
  try { await dl.save({ filename, data }); }
  catch (e) { if (e && e.code !== 'cancelled' && e.code !== 'declined') toast('The export didn’t complete.'); }
}
