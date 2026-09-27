// Local-only dialog QA: synthetic data, no database, no credentials or external network.
// Run with: node --import tsx scripts/preview-school-year-archive.mjs
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { encryptSchoolYearArchive } from '../src/lib/schoolYearArchiveZip.ts';

const selectedYear = '2025/2026';
const summary = {
  schoolYear: selectedYear,
  createdAt: '2026-09-21T10:00:00.000Z',
  requestCount: 3,
  assignmentCount: 4,
  proofCount: 2,
  reportCount: 2,
  warnings: [
    'TEST-Hinweis: Ein bereits gelöschter Nachweis ist nicht enthalten.',
    'TEST-Hinweis: PDFs wurden mit dem aktuellen Profil neu erzeugt.',
  ],
};
const sampleFiles = [
  { path: 'Dokumentation/README.txt', data: new TextEncoder().encode('Synthetisches Archiv für die lokale UI-Prüfung.') },
  { path: 'Nachweise/Beispielnachweis.txt', data: new TextEncoder().encode('Keine echten Personen- oder Schuldaten.') },
  { path: 'Berichte/Beispielbericht.txt', data: new TextEncoder().encode('Erfundener, zuletzt gespeicherter Prüfstand.') },
];
const js = await build({
  entryPoints: ['tests/fixtures/schoolYearArchivePreview.tsx'], bundle: true, write: false,
  format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' },
});
const css = await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: 'src/app/globals.css' });

const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'POST' && req.url === '/api/schulamt/year-archive') {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 4096) { res.writeHead(413); res.end(); return; }
    }
    try {
      const body = JSON.parse(raw);
      if (body.year !== selectedYear || body.password !== 'UI-Testpasswort' || !/^[A-Za-z0-9_-]{32}$/.test(body.archivePassword)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Das aktuelle Passwort ist nicht korrekt.' }));
        return;
      }
      const archive = await encryptSchoolYearArchive(sampleFiles.map(file => ({ ...file, data: new Uint8Array(file.data) })), body.archivePassword);
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="Schuljahresarchiv_UI-Test.zip"',
        'X-Archive-Summary': Buffer.from(JSON.stringify(summary)).toString('base64url'),
      });
      res.end(archive);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Synthetisches Archiv konnte nicht erstellt werden.' }));
    }
    return;
  }
  const routes = {
    '/': ['text/html', '<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Schuljahresarchiv UI-Test</title><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/app.js"></script></html>'],
    '/app.js': ['text/javascript', js.outputFiles[0].contents],
    '/style.css': ['text/css', css.css],
  };
  const route = routes[req.url];
  if (req.method !== 'GET' || !route) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': route[0] });
  res.end(route[1]);
});

server.listen(3142, '127.0.0.1', () => console.log('Synthetic school-year archive dialog: http://127.0.0.1:3142'));
