// Local-only dialog QA, no database and no real credentials or network side effects.
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { encryptBackup } from './full-backup-format.mjs';

const js = await build({ entryPoints: ['tests/fixtures/fullBackupPreview.tsx'], bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } });
const css = await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: 'src/app/globals.css' });
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'POST' && req.url === '/api/backup/export') {
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (raw.length > 4096) { res.writeHead(413); res.end(); return; } }
    try {
      const body = JSON.parse(raw);
      if (body.password !== 'UI-Testpasswort') { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Das aktuelle Passwort ist nicht korrekt.' })); return; }
      const data = await encryptBackup({ fixture: 'UI-only, not a restorable backup' }, body.backupPassword);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="ui-test.mrbackup"' }); res.end(data);
    } catch { res.writeHead(400); res.end(); }
    return;
  }
  const routes = { '/': ['text/html', '<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Backup UI-Test</title><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/app.js"></script></html>'], '/app.js': ['text/javascript', js.outputFiles[0].contents], '/style.css': ['text/css', css.css] };
  const route = routes[req.url];
  if (req.method !== 'GET' || !route) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': route[0] }); res.end(route[1]);
});
server.listen(3138, '127.0.0.1', () => console.log('Synthetic backup dialog: http://127.0.0.1:3138'));
