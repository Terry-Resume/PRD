/* build.mjs — compiles the JSX and inlines React, the styles and the app into
   one self-contained HTML file. No bundler: the sources share one scope and are
   concatenated in order.
   Usage: node build.mjs  ->  dist/verdict.html and index.html (served by GitHub Pages) */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { transformSync } from '@babel/core';

const SRC = ['domain.js', 'demo.js', 'store.js', 'ui.jsx', 'views.jsx', 'App.jsx'];

const source = SRC.map(f => `/* ===== ${f} ===== */\n` + readFileSync(new URL(`src/${f}`, import.meta.url), 'utf8')).join('\n\n');

const { code } = transformSync(source, {
  filename: 'app.jsx',
  presets: [['@babel/preset-react', { runtime: 'classic' }]],
  compact: false,
  babelrc: false,
  configFile: false,
});

const css = readFileSync(new URL('src/styles.css', import.meta.url), 'utf8');
const react = readFileSync(new URL('node_modules/react/umd/react.production.min.js', import.meta.url), 'utf8');
const reactDom = readFileSync(new URL('node_modules/react-dom/umd/react-dom.production.min.js', import.meta.url), 'utf8');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Verdict — AI feature quality console</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
${css}
</style>
</head>
<body>
<div id="root"></div>
<script>${react}</script>
<script>${reactDom}</script>
<script>
${code}
</script>
</body>
</html>
`;

mkdirSync(new URL('dist/', import.meta.url), { recursive: true });
writeFileSync(new URL('dist/verdict.html', import.meta.url), html);
writeFileSync(new URL('index.html', import.meta.url), html);
console.log('built dist/verdict.html + index.html', (html.length / 1024).toFixed(0) + ' KB');
