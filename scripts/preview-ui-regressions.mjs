// Database-free local fixture: real UI components, synthetic data, no writable API.
// Run: node scripts/preview-ui-regressions.mjs
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

const root = process.cwd();
const workloadPreview = process.argv.includes('--workload');
const qualificationsPreview = process.argv.includes('--qualifications');
const planningPreview = process.argv.includes('--planning');
const releaseNotesPreview = process.argv.includes('--release-notes');
const result = await build({
  entryPoints: [workloadPreview ? 'tests/fixtures/workloadPreview.tsx' : releaseNotesPreview ? 'tests/fixtures/releaseNotesPreview.tsx' : planningPreview ? 'tests/fixtures/planningChangesPreview.tsx' : qualificationsPreview ? 'tests/fixtures/teacherQualificationsPreview.tsx' : 'tests/fixtures/uiRegressionPreview.tsx'], bundle: true, write: false,
  format: 'iife', platform: 'browser', jsx: 'automatic',
  // AssignmentConfirmation shares a module with the map, which is not rendered
  // in the planning fixture. Its Leaflet CSS is unrelated to the tested UI.
  ...(planningPreview ? { loader: { '.css': 'empty' } } : {}),
  define: { 'process.env': '{}', 'process.env.NODE_ENV': '"development"' },
});
const cssPath = path.join(root, 'src/app/globals.css');
const css = await postcss([tailwind()]).process(await readFile(cssPath, 'utf8'), { from: cssPath });
const font = await readFile(path.join(root, 'node_modules/@fontsource/rubik/files/rubik-latin-400-normal.woff2'));
const html = '<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lokale UI-Regression</title><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/app.js"></script></html>';
const routes = {
  '/': ['text/html; charset=utf-8', html],
  '/app.js': ['text/javascript; charset=utf-8', result.outputFiles[0].contents],
  '/style.css': ['text/css; charset=utf-8', '@font-face{font-family:Rubik;src:url(/rubik.woff2) format("woff2");font-weight:400;font-style:normal;font-display:swap;}' + css.css],
  '/rubik.woff2': ['font/woff2', font],
};
const server = createServer((request, response) => {
  if (request.method !== 'GET') { response.writeHead(405); response.end('Read-only UI fixture'); return; }
  const route = routes[request.url.split('?')[0]];
  if (!route) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { 'Content-Type': route[0], 'Cache-Control': 'no-store' });
  response.end(route[1]);
});
const port = workloadPreview ? 3141 : releaseNotesPreview ? 3140 : planningPreview ? 3139 : qualificationsPreview ? 3138 : 3137;
server.listen(port, '127.0.0.1', () => console.log(`Local-only UI fixture: http://127.0.0.1:${port}`));
