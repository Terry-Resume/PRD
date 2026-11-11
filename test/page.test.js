import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { JSDOM, VirtualConsole, ResourceLoader } from 'jsdom'

// Loads the single-file app in jsdom exactly as a browser would run it, with the network switched off
// (fonts and other external resources return empty), and fails on any script error.
const FILE = 'index.html'

class Offline extends ResourceLoader { fetch() { return Promise.resolve(Buffer.from('')) } }
const IGNORED = /Not implemented: (window\.(scrollTo|scroll|alert|confirm|prompt)|HTMLCanvasElement|navigation|HTMLFormElement\.prototype\.(submit|requestSubmit))/

async function load() {
  const errors = []
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', e => { if (!IGNORED.test(e.message)) errors.push(e.stack || e.message) })
  const dom = new JSDOM(fs.readFileSync(FILE, 'utf8'), { url: 'http://localhost/', runScripts: 'dangerously', resources: new Offline(), pretendToBeVisual: true, virtualConsole })
  await new Promise(r => setTimeout(r, 400))
  return { dom, errors }
}

test('the page loads and runs without script errors', async () => {
  const { dom, errors } = await load()
  try {
    assert.deepEqual(errors, [])
    assert.ok(dom.window.document.body.textContent.trim().length > 200, 'something rendered')
  } finally { dom.window.close() }
})

test('the page makes no network calls of its own and holds no keys', () => {
  const html = fs.readFileSync(FILE, 'utf8')
  for (const bad of ['sk-ant-', 'api.anthropic.com', 'x-api-key', 'pk_live_']) assert.ok(!html.includes(bad), `${FILE} contains ${bad}`)
})

test('the console renders the sample project and says sampling is off without model access', async () => {
  const { dom, errors } = await load()
  try {
    await new Promise(r => setTimeout(r, 600))
    const text = dom.window.document.body.textContent
    assert.deepEqual(errors, [])
    assert.match(text, /Support reply drafter/)
    assert.match(text, /Do not ship|Needs review|Ship it/)
    assert.match(text, /Sampling off/)
  } finally { dom.window.close() }
})
