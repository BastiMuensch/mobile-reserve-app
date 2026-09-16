/**
 * Deliberately framework-free recovery screen.  The recovery gateway serves the
 * document and this script itself, so it remains usable while Next is stopped.
 */
export function recoveryHtml() {
  return String.raw`<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Wiederherstellung · MobileReserve.digital</title>
  <style>
    :root{color-scheme:light;--ink:#10352d;--muted:#59736b;--line:#d6e5df;--paper:#fff;--wash:#f3faf7;--green:#087a5a;--green-dark:#075c45;--warn:#8a4c00;--danger:#a62b2b;--shadow:0 20px 55px #174d3b18}*{box-sizing:border-box}body{margin:0;background:linear-gradient(140deg,#e5f5ef,#f7fbf9 50%,#eaf4f1);color:var(--ink);font:16px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;min-height:100vh}.shell{width:min(720px,calc(100% - 32px));margin:0 auto;padding:36px 0 48px}.brand{font-size:1.08rem;font-weight:800;letter-spacing:-.035em;color:var(--green-dark);margin-bottom:30px}.brand span{color:#50a184}.eyebrow{text-transform:uppercase;letter-spacing:.1em;font-weight:750;font-size:.74rem;color:var(--green)}h1{font-size:clamp(1.7rem,5vw,2.5rem);line-height:1.14;letter-spacing:-.045em;margin:7px 0 12px}p{margin:0 0 17px;color:var(--muted)}.card{background:var(--paper);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow);padding:clamp(21px,5vw,36px);margin-top:24px}.steps{display:flex;gap:7px;margin:21px 0 0}.step{height:4px;flex:1;border-radius:3px;background:#dbe9e4}.step.active{background:var(--green)}label{display:block;font-size:.91rem;font-weight:700;margin:17px 0 6px}input,select,button{font:inherit}input,select{width:100%;min-height:46px;border:1px solid #a9c9bd;border-radius:9px;padding:10px 12px;background:#fff;color:var(--ink)}input:focus,select:focus{outline:3px solid #64cba833;outline-offset:1px;border-color:var(--green)}button,.button-link{display:inline-flex;align-items:center;justify-content:center;min-height:45px;border:0;border-radius:9px;padding:10px 16px;background:var(--green);color:white;font-weight:750;cursor:pointer;text-decoration:none}button:hover,.button-link:hover{background:var(--green-dark)}button.secondary{background:#e4f1ec;color:var(--green-dark)}button.danger{background:var(--danger)}button:disabled{opacity:.52;cursor:not-allowed}.actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:23px}.notice{border-left:4px solid #d59221;background:#fff8e9;padding:13px 15px;border-radius:0 9px 9px 0;color:#714100;margin:18px 0}.notice strong{color:#543100}.error{border-left-color:var(--danger);background:#fff0f0;color:#7e2525}.success{border-left-color:var(--green);background:#eaf8f2;color:#135740}.status{margin-top:18px;min-height:1.5em;color:var(--muted)}.status[role=status]{font-weight:600}.summary{background:var(--wash);border-radius:12px;padding:16px;margin:19px 0}.summary dl{display:grid;grid-template-columns:1fr auto;gap:8px 16px;margin:0}.summary dt{color:var(--muted)}.summary dd{margin:0;font-weight:750;text-align:right}.check{display:flex;gap:10px;align-items:flex-start;margin-top:18px;color:var(--ink);font-weight:600}.check input{width:20px;min-height:20px;margin:2px 0 0}.hidden{display:none!important}.progress{height:8px;background:#d9e9e3;border-radius:99px;overflow:hidden;margin:20px 0}.progress i{display:block;width:42%;height:100%;background:var(--green);border-radius:99px;animation:run 1.5s ease-in-out infinite}@keyframes run{0%{transform:translateX(-100%)}100%{transform:translateX(330%)}}.small{font-size:.9rem}.file-name{font-size:.9rem;color:var(--green-dark);font-weight:700;margin-top:8px}@media(max-width:460px){.shell{width:min(100% - 24px,720px);padding-top:24px}.card{border-radius:14px}.actions button,.actions .button-link{width:100%}}
  </style>
</head>
<body>
  <main class="shell">
    <div class="brand" aria-label="MobileReserve.digital"><img src="/_recovery/logo.png" alt="" width="44" height="44" style="vertical-align:middle;margin-right:10px">MobileReserve<span>.digital</span></div>
    <div class="eyebrow">Geschützter Wiederherstellungsmodus</div>
    <h1>Vollständige Sicherung wiederherstellen</h1>
    <p>Diese Seite bleibt über das Wiederherstellungs-Gateway erreichbar, auch wenn die Anwendung gerade gewartet wird.</p>
    <div class="steps" aria-label="Fortschritt"><i class="step active"></i><i class="step"></i><i class="step"></i></div>
    <section class="card" id="app" aria-live="polite" aria-busy="true">
      <p id="loading">Wiederherstellungsmodus wird geprüft …</p>
    </section>
  </main>
  <script src="/_recovery/app.js" defer></script>
</body>
</html>`;
}

export const recoveryJs = String.raw`(() => {
  'use strict';
  const API = '/_recovery/api';
  const MAX_ARCHIVE_BYTES = 192 * 1024 * 1024 + 1024;
  const app = document.getElementById('app');
  const steps = Array.from(document.querySelectorAll('.step'));
  let authenticated = false, statusTimer = null, busy = false, resuming = false, lastStatusKey = '', lastStatus = null, authMode = 'password';
  const credentialKey = () => authMode;
  const escapeFocus = selector => setTimeout(() => app.querySelector(selector)?.focus(), 0);
  const text = (node, value) => { node.textContent = value == null ? '' : String(value); };
  const request = async (path, options = {}) => {
    const response = await fetch(API + path, { cache: 'no-store', credentials: 'same-origin', ...options });
    if (response.status === 401) { showLogin('Die Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.'); throw new Error('unauthorized'); }
    if (!response.ok) {
      let code = 'request-failed';
      try { const body = await response.json(); if (typeof body?.error === 'string') code = body.error; else if (typeof body?.message === 'string') code = body.message; } catch {}
      throw new Error(code);
    }
    const type = response.headers.get('content-type') || '';
    return type.includes('application/json') ? response.json() : null;
  };
  const json = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const message = (value, kind = '') => '<div class="notice ' + kind + '" id="message"></div>';
  const setMessage = value => { const node = document.getElementById('message'); if (node) text(node, value); };
  const setSteps = index => steps.forEach((step, i) => step.classList.toggle('active', i <= index));
  const render = (markup, focus) => { app.setAttribute('aria-busy', 'false'); app.innerHTML = markup; if (focus) escapeFocus(focus); };
  // All variable content is assigned via textContent immediately after static markup.
  const errorText = detail => detail ? 'Die Wiederherstellung konnte nicht fortgesetzt werden. ' + detail : 'Die Wiederherstellung konnte nicht fortgesetzt werden. Bitte versuchen Sie es erneut oder wenden Sie sich an den Serverbetrieb.';
  const safeError = code => ({ 'invalid-backup': 'Die Sicherungsdatei konnte nicht geprüft werden.', 'wrong-password': 'Das Sicherungs-Passwort ist nicht korrekt.', 'unsupported-version': 'Die Sicherung benötigt eine nicht unterstützte Anwendungsversion.', 'resume-not-authorized': 'Die Freigabe wurde nicht autorisiert.' }[code] || 'Der Serverbetrieb muss den Vorgang prüfen.');
  function showLogin(note = '') {
    authenticated = false; stopPolling(); setSteps(0);
    render('<div class="eyebrow">Zugang bestätigen</div><h2>Wiederherstellung anmelden</h2><p>Nutzen Sie einen Zugang, der für diesen geschützten Modus eingerichtet wurde.</p>' + message(note, note ? 'error' : '') + '<form id="loginForm" novalidate><label for="loginMode">Anmeldeart</label><select id="loginMode" name="loginMode"><option value="password">Schulamts-Anmeldepasswort</option><option value="setupToken">Einrichtungsschlüssel</option><option value="rescueToken">Betreiber-Rettungsschlüssel</option></select><label for="loginSecret" id="secretLabel">Schulamts-Anmeldepasswort</label><input id="loginSecret" type="password" autocomplete="current-password" required><p class="small" id="modeHint">Melden Sie sich zuvor in der Anwendung als Schulamt an. Die Wiederherstellung bestätigt diese aktuelle Anmeldung zusätzlich mit Ihrem Passwort.</p><p class="small"><a href="/">Zur Anmeldung der Anwendung</a></p><div class="actions"><button>Anmelden</button></div></form><p class="status" role="status"></p>', '#loginSecret');
    const mode = document.getElementById('loginMode'), input = document.getElementById('loginSecret'), label = document.getElementById('secretLabel'), hint = document.getElementById('modeHint');
    const labels = { password: 'Schulamts-Anmeldepasswort', setupToken: 'Einrichtungsschlüssel', rescueToken: 'Betreiber-Rettungsschlüssel' };
    mode.addEventListener('change', () => { text(label, labels[mode.value]); text(hint, mode.value === 'setupToken' ? 'Verwenden Sie den Schlüssel der neuen Zielinstanz.' : mode.value === 'rescueToken' ? 'Dieser Schlüssel ist nur für den Betreiber-Notfall vorgesehen.' : 'Melden Sie sich zuvor in der Anwendung als Schulamt an. Die Wiederherstellung bestätigt diese aktuelle Anmeldung zusätzlich mit Ihrem Passwort.'); input.value = ''; input.focus(); });
    document.getElementById('loginForm').addEventListener('submit', login);
  }
  async function login(event) {
    event.preventDefault(); if (busy) return; const mode = document.getElementById('loginMode').value; let secret = document.getElementById('loginSecret').value;
    if (!secret) { document.getElementById('loginSecret').focus(); return; } busy = true; const button = event.currentTarget.querySelector('button'); button.disabled = true;
    const payload = mode === 'password' ? { password: secret } : mode === 'setupToken' ? { password: '', setupToken: secret } : { password: '', rescueToken: secret };
    try { await request('/login', json(payload)); authMode = mode; authenticated = true; showUpload(); startPolling(); await refreshStatus(); } catch (error) { if (error.message !== 'unauthorized') { setMessage('Anmeldung nicht möglich. Zugangsdaten prüfen und erneut versuchen.'); document.getElementById('loginSecret')?.focus(); } } finally { secret = ''; busy = false; button.disabled = false; }
  }
  function showUpload(note = '', uploaded = false) {
    setSteps(1); render('<div class="eyebrow">Schritt 1 von 3</div><h2>Sicherung auswählen</h2><p>Wählen Sie Ihre verschlüsselte Sicherungsdatei und geben Sie ihr Sicherungs-Passwort ein.</p><div class="notice">Verwenden Sie nur eine Sicherung, deren Herkunft Sie selbst geprüft haben. Die Verschlüsselung beweist nicht, von wem die Datei stammt.</div>' + message(note, note ? 'error' : '') + '<form id="uploadForm" novalidate data-uploaded="' + (uploaded ? 'true' : 'false') + '">' + (uploaded ? '<div class="notice success">Eine Sicherung ist bereits hochgeladen. Geben Sie nur das Sicherungs-Passwort ein, um die Prüfung fortzusetzen, oder verwerfen Sie sie zuerst.</div>' : '<label for="archive">Sicherungsdatei</label><input id="archive" type="file" accept=".mrbackup,.json,application/json,application/octet-stream" required><div class="file-name" id="fileName"></div>') + '<label for="backupPassword">Sicherungs-Passwort</label><input id="backupPassword" type="password" autocomplete="off" required><p class="small">Maximale Dateigröße: 192 MiB.</p><div class="actions"><button id="uploadButton">' + (uploaded ? 'Hochgeladene Sicherung prüfen' : 'Sicherung hochladen und prüfen') + '</button>' + (uploaded ? '<button class="secondary" type="button" id="cancel">Hochgeladene Sicherung verwerfen</button>' : '') + '<button class="secondary" type="button" id="logout">Abmelden</button></div></form><p class="status" role="status"></p>', uploaded ? '#backupPassword' : '#archive');
    document.getElementById('archive')?.addEventListener('change', event => { const file = event.target.files[0]; text(document.getElementById('fileName'), file ? file.name + ' · ' + Math.ceil(file.size / 1024 / 1024) + ' MiB' : ''); });
    document.getElementById('uploadForm').addEventListener('submit', upload);
    document.getElementById('cancel')?.addEventListener('click', cancel);
    document.getElementById('logout').addEventListener('click', logout);
  }
  async function upload(event) {
    event.preventDefault(); if (busy) return; const form = document.getElementById('uploadForm'), alreadyUploaded = form.dataset.uploaded === 'true', file = document.getElementById('archive')?.files[0], password = document.getElementById('backupPassword');
    if ((!alreadyUploaded && !file) || !password.value) { setMessage('Bitte wählen Sie eine Sicherungsdatei und geben Sie das Sicherungs-Passwort ein.'); return; }
    if (file && file.size > MAX_ARCHIVE_BYTES) { setMessage('Die Sicherungsdatei ist größer als 192 MiB und kann nicht hochgeladen werden.'); return; }
    if (file && await file.slice(0, 9).text() !== 'MRBACKUP1') { setMessage('Diese Datei ist kein Vollbackup. Ältere JSON-Sicherungen können Sie in der laufenden Anwendung importieren.'); return; }
    busy = true; disableForm('#uploadForm', true); text(document.querySelector('.status'), 'Sicherung wird hochgeladen …');
    try { if (!alreadyUploaded) await request('/upload', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file }); let value = password.value; password.value = ''; text(document.querySelector('.status'), 'Sicherung wird entschlüsselt und geprüft …'); await request('/prepare', json({ backupPassword: value })); value = ''; startPolling(); await refreshStatus(); }
    catch (error) { if (error.message !== 'unauthorized') { setMessage(error.message !== 'request-failed' ? error.message : errorText('Die Sicherungsdatei oder das Sicherungs-Passwort konnte nicht geprüft werden.')); disableForm('#uploadForm', false); } } finally { password.value = ''; busy = false; }
  }
  function disableForm(selector, disabled) { app.querySelectorAll(selector + ' input,' + selector + ' select,' + selector + ' button').forEach(node => { node.disabled = disabled; }); }
  function summaryView(summary) {
    const counts = summary?.counts || {}; let createdAt = summary?.createdAt;
    if (typeof createdAt === 'string') { const date = new Date(createdAt); if (!Number.isNaN(date.valueOf())) createdAt = date.toLocaleString('de-DE'); }
    const rows = [['Erstellt', createdAt], ['Anwendungsversion', summary?.appVersion], ['Nutzende', counts.users], ['Schulen', counts.schools], ['Lehrkräfte', counts.teachers], ['Anfragen', counts.requests], ['Zuweisungen', counts.assignments]];
    const box = document.getElementById('summaryRows'); rows.filter(([, value]) => value !== undefined && value !== null).forEach(([label, value]) => { const dt = document.createElement('dt'), dd = document.createElement('dd'); text(dt, label); text(dd, value); box.append(dt, dd); });
  }
  function showReady(status) {
    setSteps(2); render('<div class="eyebrow">Schritt 2 von 3</div><h2>Sicherung ist bereit</h2><p>Die verschlüsselte Sicherung wurde geprüft. Vergleichen Sie die Angaben, bevor Sie fortfahren.</p><div class="summary"><dl id="summaryRows"></dl></div><div class="notice"><strong>Achtung:</strong> Die Wiederherstellung ersetzt alle Schuljahre und Anmeldedaten dieser Instanz. Sie ist nur mit derselben unterstützten Anwendungsversion möglich.</div><form id="commitForm" novalidate><label class="check"><input type="checkbox" id="acknowledge"> <span>Ich bestätige, dass die vorhandenen Daten dieser Instanz ersetzt werden dürfen.</span></label><label for="confirmation">Zur Bestätigung WIEDERHERSTELLEN eingeben</label><input id="confirmation" autocomplete="off" required><label for="commitMode">Anmeldeart erneut bestätigen</label><select id="commitMode"><option value="password">Schulamts-Anmeldepasswort</option><option value="setupToken">Einrichtungsschlüssel</option><option value="rescueToken">Betreiber-Rettungsschlüssel</option></select><label for="currentCredential" id="currentCredentialLabel"></label><input id="currentCredential" type="password" autocomplete="current-password" required><div class="actions"><button id="commitButton" class="danger">Wiederherstellung starten</button><button class="secondary" type="button" id="cancel">Sicherung verwerfen</button></div></form><p class="status" id="message" role="alert"></p>', '#acknowledge');
    summaryView(status.summary); document.getElementById('commitForm').addEventListener('submit', commit); document.getElementById('cancel').addEventListener('click', cancel);
    const commitMode = document.getElementById('commitMode'), commitLabel = document.getElementById('currentCredentialLabel'); commitMode.value = authMode;
    const label = () => text(commitLabel, (commitMode.value === 'setupToken' ? 'Einrichtungsschlüssel' : commitMode.value === 'rescueToken' ? 'Betreiber-Rettungsschlüssel' : 'Schulamts-Anmeldepasswort') + ' erneut eingeben'); label();
    commitMode.addEventListener('change', () => { authMode = commitMode.value; document.getElementById('currentCredential').value = ''; label(); document.getElementById('currentCredential').focus(); });
  }
  async function commit(event) {
    event.preventDefault(); if (busy) return; const acknowledgement = document.getElementById('acknowledge').checked, confirmation = document.getElementById('confirmation').value, secret = document.getElementById('currentCredential').value, mode = document.getElementById('commitMode').value;
    if (!acknowledgement || confirmation !== 'WIEDERHERSTELLEN' || !secret) { setMessage('Bitte bestätigen Sie den Hinweis, geben Sie WIEDERHERSTELLEN sowie den aktuellen Zugang exakt ein.'); return; }
    const payload = { confirmation, password: mode === 'password' ? secret : '' }; if (mode === 'setupToken') payload.setupToken = secret; if (mode === 'rescueToken') payload.rescueToken = secret;
    busy = true; disableForm('#commitForm', true); try { await request('/commit', json(payload)); document.getElementById('currentCredential').value = ''; showProgress('Die Wiederherstellung wird gestartet.'); await refreshStatus(); } catch (error) { if (error.message !== 'unauthorized') { setMessage(error.message !== 'request-failed' ? error.message : errorText()); disableForm('#commitForm', false); } } finally { busy = false; }
  }
  async function cancel() { if (busy) return; busy = true; document.getElementById('cancel').disabled = true; try { await request('/cancel', json({})); showUpload('Die hochgeladene Sicherung wurde verworfen.'); } catch (error) { if (error.message !== 'unauthorized') setMessage(errorText()); } finally { busy = false; } }
  function showProgress(note) { setSteps(2); render('<div class="eyebrow">Wiederherstellung läuft</div><h2>Daten werden sicher wiederhergestellt</h2><p id="progressText"></p><div class="progress" aria-hidden="true"><i></i></div><div class="notice">Sie können dieses Browserfenster jetzt schließen. Die Wiederherstellung wird auf dem Server fortgesetzt.</div><p class="status" role="status">Status wird aktualisiert …</p>'); text(document.getElementById('progressText'), note); }
  function showCompleted(status) {
    setSteps(2); const paused = status.notificationsPaused === true, allowAnother = status.maintenance !== true;
    render('<div id="terminal" class="eyebrow">Abgeschlossen</div><h2>Wiederherstellung abgeschlossen</h2><div class="notice success">Die Sicherung wurde erfolgreich wiederhergestellt.</div>' + (paused ? '<p>Benachrichtigungen und Hintergrundjobs bleiben vorsorglich pausiert. Melden Sie sich zuerst mit einem Konto der wiederhergestellten Instanz neu an. Kehren Sie dann hierher zurück, um sie nach der Prüfung freizugeben.</p><div class="actions"><a class="button-link" href="/">Zur neuen Anmeldung</a></div><form id="resumeForm" novalidate><label class="check"><input type="checkbox" id="reviewedOutbox"> <span>Ich habe offene Nachrichten geprüft und möchte den Versand wieder freigeben.</span></label><label for="resumeMode">Aktuelle Anmeldeart</label><select id="resumeMode"><option value="password">Schulamts-Anmeldepasswort</option><option value="setupToken">Einrichtungsschlüssel</option><option value="rescueToken">Betreiber-Rettungsschlüssel</option></select><label for="resumeCredential" id="resumeCredentialLabel"></label><input id="resumeCredential" type="password" autocomplete="current-password" required><div class="actions"><button id="resumeButton">Benachrichtigungen und Hintergrundjobs freigeben</button></div></form><p class="status" role="status"></p>' : '<p>Benachrichtigungen und Hintergrundjobs sind nicht mehr pausiert.</p>') + '<div class="actions">' + (allowAnother ? '<button class="secondary" id="anotherRestore">Andere Sicherung auswählen</button>' : '') + '<button class="secondary" id="logout">Abmelden</button></div>', paused ? '#reviewedOutbox' : (allowAnother ? '#anotherRestore' : '#logout'));
    document.getElementById('logout').addEventListener('click', logout);
    document.getElementById('anotherRestore')?.addEventListener('click', anotherRestore);
    if (paused) bindResumeForm();
    stopPolling();
  }
  async function resume(event) {
    event.preventDefault(); if (busy) return; const reviewedOutbox = document.getElementById('reviewedOutbox').checked, mode = document.getElementById('resumeMode').value, credential = document.getElementById('resumeCredential').value;
    if (!reviewedOutbox || !credential) { const node = document.querySelector('.status'); if (node) text(node, 'Bitte bestätigen Sie die Prüfung und geben Sie den aktuellen Zugang erneut ein.'); return; }
    const payload = { password: mode === 'password' ? credential : '', reviewedOutbox }; if (mode === 'setupToken') payload.setupToken = credential; if (mode === 'rescueToken') payload.rescueToken = credential;
    busy = true; resuming = true; disableForm('#resumeForm', true); try { await request('/resume', json(payload)); document.getElementById('resumeCredential').value = ''; showProgress('Benachrichtigungen und Hintergrundjobs werden wieder freigegeben.'); startPolling(); await refreshStatus(); } catch (error) { resuming = false; if (error.message !== 'unauthorized') { const node = document.querySelector('.status'); if (node) text(node, error.message !== 'request-failed' ? error.message : safeError('resume-not-authorized')); disableForm('#resumeForm', false); } } finally { busy = false; }
  }
  function bindResumeForm() { const mode = document.getElementById('resumeMode'), label = document.getElementById('resumeCredentialLabel'); mode.value = authMode; const setLabel = () => text(label, (mode.value === 'setupToken' ? 'Einrichtungsschlüssel' : mode.value === 'rescueToken' ? 'Betreiber-Rettungsschlüssel' : 'Schulamts-Anmeldepasswort') + ' erneut eingeben'); setLabel(); mode.addEventListener('change', () => { authMode = mode.value; document.getElementById('resumeCredential').value = ''; setLabel(); }); document.getElementById('resumeForm').addEventListener('submit', resume); }
  const resumeMarkup = '<form id="resumeForm" novalidate><label class="check"><input type="checkbox" id="reviewedOutbox"> <span>Ich habe offene Nachrichten geprüft und möchte den Versand wieder freigeben.</span></label><label for="resumeMode">Aktuelle Anmeldeart</label><select id="resumeMode"><option value="password">Schulamts-Anmeldepasswort</option><option value="setupToken">Einrichtungsschlüssel</option><option value="rescueToken">Betreiber-Rettungsschlüssel</option></select><label for="resumeCredential" id="resumeCredentialLabel"></label><input id="resumeCredential" type="password" autocomplete="current-password" required><div class="actions"><button id="resumeButton">Benachrichtigungen und Hintergrundjobs freigeben</button></div></form><p class="status" role="status"></p>';
  function anotherRestore() { if (lastStatus?.maintenance === true) return; resuming = false; stopPolling(); lastStatusKey = ''; showUpload('Sie können eine andere Sicherung auswählen. Die bisherigen Daten bleiben aktiv, bis Sie eine neue Wiederherstellung ausdrücklich starten.'); }
  function showRolledBack(status) { const paused = status.notificationsPaused === true; resuming = false; setSteps(2); render('<div id="terminal" class="eyebrow">Wiederherstellung zurückgenommen</div><h2>Der vorherige Zustand ist aktiv</h2><div class="notice success">Die Wiederherstellung wurde zurückgenommen. Die zuvor vorhandenen Daten bleiben aktiv.</div>' + (paused ? '<p>Benachrichtigungen und Hintergrundjobs bleiben pausiert. Melden Sie sich mit einem Konto der aktiven Instanz neu an und kehren Sie anschließend zur Freigabe zurück.</p><div class="actions"><a class="button-link" href="/">Zur Anmeldung</a></div>' + resumeMarkup : '') + '<div class="actions">' + (status.maintenance === true ? '' : '<button class="secondary" id="anotherRestore">Andere Sicherung auswählen</button>') + '<button id="logout">Abmelden</button></div>', paused ? '#reviewedOutbox' : '#logout'); document.getElementById('logout').addEventListener('click', logout); document.getElementById('anotherRestore')?.addEventListener('click', anotherRestore); if (paused) bindResumeForm(); stopPolling(); }
  function showFailed(status) { const retry = status.maintenance !== true; resuming = false; setSteps(2); render('<div id="terminal" class="eyebrow">Überprüfung erforderlich</div><h2>Wiederherstellung nicht abgeschlossen</h2><div class="notice error" id="failure"></div><p>' + (retry ? 'Die bisherigen Daten bleiben aktiv. Prüfen Sie Sicherungsdatei und Sicherungs-Passwort und versuchen Sie es erneut.' : 'Der Serverbetrieb muss den Vorgang prüfen. Es werden keine technischen Detaildaten auf dieser Seite angezeigt.') + '</p><div class="actions">' + (retry ? '<button class="secondary" id="anotherRestore">Andere Sicherung auswählen</button>' : '') + '<button id="logout">Abmelden</button></div>', '#logout'); text(document.getElementById('failure'), status.error || (retry ? 'Die Sicherung konnte nicht vorbereitet werden.' : 'Der Serverbetrieb muss den Vorgang prüfen.')); document.getElementById('logout').addEventListener('click', logout); document.getElementById('anotherRestore')?.addEventListener('click', anotherRestore); stopPolling(); }
  function renderStatus(status) {
    lastStatus = status;
    const key = String(status.phase || '') + ':' + String(status.notificationsPaused === true) + ':' + String(status.maintenance === true), changed = lastStatusKey !== key;
    if (busy && (document.getElementById('uploadForm') || document.getElementById('commitForm') || document.getElementById('resumeForm'))) return;
    lastStatusKey = key;
    if (status.phase === 'ready') { if (changed || !document.getElementById('commitForm')) showReady(status); }
    else if (status.phase === 'uploaded') { if (changed || !document.getElementById('uploadForm')) showUpload('', true); }
    else if (status.phase === 'idle') { if (changed || !document.getElementById('uploadForm')) showUpload(); }
    else if (status.phase === 'preparing') { if (changed || !document.getElementById('progressText')) showProgress('Die Sicherung wird geprüft und für die Wiederherstellung vorbereitet.'); }
    else if (status.phase === 'committing' || status.phase === 'verifying') { if (changed || !document.getElementById('progressText')) showProgress('Die Wiederherstellung wird auf dem Server durchgeführt und überprüft.'); }
    else if (status.phase === 'completed') {
      if (resuming && status.notificationsPaused === true) return;
      if (resuming && status.notificationsPaused !== true) resuming = false;
      if (changed || !document.getElementById('terminal')) showCompleted(status);
    } else if (status.phase === 'rolled_back') { if (changed || !document.getElementById('terminal')) showRolledBack(status); }
    else if (status.phase === 'failed') { if (changed || !document.getElementById('terminal')) showFailed(status); }
  }
  async function refreshStatus() { if (!authenticated) return; try { const status = await request('/status'); renderStatus(status); } catch (error) { if (error.message !== 'unauthorized') { const node = document.querySelector('.status'); if (node) text(node, 'Der Status konnte gerade nicht aktualisiert werden. Erneuter Versuch folgt automatisch.'); } } }
  function startPolling() { stopPolling(); if (authenticated) statusTimer = window.setInterval(refreshStatus, 2000); }
  function stopPolling() { if (statusTimer) window.clearInterval(statusTimer); statusTimer = null; }
  async function logout() { try { await request('/logout', json({})); } catch {} showLogin(); }
  async function initialise() { try { const session = await request('/session'); if (session.authenticated) { if (['password', 'setupToken', 'rescueToken'].includes(session.authMode)) authMode = session.authMode; authenticated = true; showUpload(); startPolling(); await refreshStatus(); } else showLogin(); } catch { showLogin('Der Wiederherstellungsmodus ist momentan nicht erreichbar.'); } }
  initialise();
})();`;
