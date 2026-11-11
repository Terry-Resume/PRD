# Verdict — an AI feature quality console

Verdict is an eval workbench for a single LLM-powered feature. It holds the golden
set, the rubric, the prompt variants under test, and the ship gate, then turns a
run into a decision: **ship it**, **needs review**, or **do not ship**.

> Part of the **Kato.8 internal-tools suite** (ten tools plus the [`central-command`](https://github.com/Terry-Resume/central-command)
> hub), built on [`@kato8/core`](https://github.com/Terry-Resume/kato8-core). Verdict is the suite's quality gate: it is how
> you would decide whether a change to one of the suite's own AI features (the Legal Agent's review prompts, Director's Cut's
> task prompts) is safe to ship. It is standalone by design, with no server and no accounts.

![Verdict overview: the ship gate for a support reply drafter](docs/screenshot.png)

It ships with a worked example — a customer-support reply drafter with 14 labeled
cases, a five-criterion rubric, and two prompt variants — so the console has
something to show before you run anything.

## Why it exists

Most teams change a prompt, read a handful of outputs, and ship. Verdict makes the
quality bar explicit before the run, and makes the judge itself something you have
to validate.

Three decisions the tool encodes:

1. **A case passes only when every criterion clears its own minimum.** A strong
   average cannot hide one disqualifying failure.
2. **Regressions block, latency and cost warn.** Hard gates and soft gates are
   separated, so a slow-but-correct candidate is reviewed rather than rejected.
3. **The LLM judge is a measurement instrument, so it gets measured.** You label a
   sample by hand; agreement between your labels and the judge is its own gate
   check. Until enough labels exist, the pass rate is reported as provisional.

## Running it

Open `index.html` in a browser (or download it from this repo). It is one
self-contained file: React is inlined, there is no server, and data is kept in
`localStorage`.

In a plain browser you can explore the sample project, edit the golden set, rubric,
gate and variants, label results, compare runs and export the report. Live runs
need model access, so the top bar shows **Sampling off** and **Run evaluation**
explains why it can't start.

Hosted on claude.ai, the same file uses the artifact runtime instead: shared
storage for the workspace and runs, live model calls for generating and grading,
and file downloads for the exports.

## Build and test

```
npm install
npm run build      # -> index.html and dist/verdict.html
npm test           # gate logic, exports, the built page in jsdom
```

`index.html` is committed so the app can be opened straight from the repo; rebuild
and commit it after changing anything in `src/`. CI rebuilds it and fails if the committed
file is out of date.

The tests load the same sources the build concatenates (they share one scope and have no exports),
so the pure logic in `src/domain.js` is tested without a browser. They cover the pass rule, quantiles,
regressions, every verdict path (ship, review, do not ship, and why), judge validation, report and
export formats, and a jsdom load of the built page.

`build.mjs` compiles the JSX with Babel and inlines React, the stylesheet and the
app into one HTML file. There is no bundler: the sources share one scope and are
concatenated in order.

```
src/domain.js   pure logic — stats, gate checks, verdict, report markdown
src/demo.js     the sample project
src/store.js    persistence, sampling, the run engine
src/ui.jsx      primitives — dialog, drawer, command palette, charts
src/views.jsx   the seven pages
src/App.jsx     shell, navigation, keyboard
```

## Method

Each case is sent to the variant under test, then graded by an LLM judge against
the rubric on a 1–5 scale with written anchors for 1, 3 and 5. Two model calls per
case. Scores roll up to a pass rate, per-criterion means, failure-mode counts, a
p95 latency figure, and an estimated cost per 1,000 requests.

## Exports

- `docs/eval-report.md` — the gate, the numbers, the regressions, the method
- `eval-results.csv` — one row per case with scores, rationale and your labels. Model output and case text
  are untrusted, so any cell that starts with `=`, `+`, `-` or `@` is prefixed with an apostrophe and cannot run as
  a spreadsheet formula
- `golden-set.jsonl` — the labeled cases, so the set outlives the tool

## Known limits

- Live runs need the claude.ai artifact runtime (`window.claude`); a plain browser can explore, edit, label and export
  but not sample. The page makes no network calls of its own and holds no keys.
- The sample baseline deliberately misses the gate on tone (3.79 against 4.00), which is the reason for the v3 variant.
- A project with no critical-tier cases passes the critical-tier check (it reports "no critical cases"). Add at least one
  critical case before trusting a "Ship it".
- Data is stored in one browser's `localStorage`; export the golden set to keep it.
- The page loads IBM Plex from Google Fonts and falls back to system fonts if that is blocked.

## License

MIT — see [LICENSE](LICENSE).
