import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// No upstream fix exists yet. Only repository-controlled development tools use
// this package; Docker's runtime installs with --omit=dev. Reassess by this date.
const developmentAdvisory = 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm';
const exceptionExpires = Date.parse('2026-11-05T00:00:00Z');

export function evaluateAudit(report, lock, { development = false, now = Date.now() } = {}) {
  if (report?.auditReportVersion !== 2 || !report.vulnerabilities || report.error) {
    throw new Error('No valid npm audit report received.');
  }

  function isExcepted(name, visited = new Set()) {
    if (!development || !Number.isFinite(now) || now >= exceptionExpires || visited.has(name)) return false;
    const finding = report.vulnerabilities[name];
    if (!finding || finding.severity !== 'high' || !finding.nodes?.length || !finding.via?.length) return false;
    if (!finding.nodes.every(node => lock.packages?.[node]?.dev === true)) return false;
    const next = new Set([...visited, name]);
    return finding.via.every(via => typeof via === 'string'
      ? isExcepted(via, next)
      : name === 'braces' && via.name === 'braces' && via.url === developmentAdvisory && via.severity === 'high'
        && finding.nodes.every(node => lock.packages[node].version === '3.0.3'));
  }

  const blocked = [];
  const excepted = [];
  for (const [name, finding] of Object.entries(report.vulnerabilities)) {
    if (!['high', 'critical'].includes(finding.severity)) continue;
    (isExcepted(name) ? excepted : blocked).push(name);
  }
  return { blocked, excepted };
}

function audit(args, lock, development) {
  const result = spawnSync('npm', ['audit', '--json', ...args], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  if (result.error || result.signal || ![0, 1].includes(result.status)) {
    throw new Error(`npm audit could not complete: ${result.error?.message || result.stderr || result.status}`);
  }
  const report = JSON.parse(result.stdout);
  const { blocked, excepted } = evaluateAudit(report, lock, { development });
  if (blocked.length) throw new Error(`High/critical dependency findings: ${blocked.join(', ')}. Run npm audit for details.`);
  if (excepted.length) {
    console.warn(`Temporary development-only exception until 2026-11-05: ${developmentAdvisory} (${excepted.join(', ')}).`);
  }
  console.log(`${development ? 'All' : 'Production'} dependencies: no unexcepted high/critical findings.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
    audit(['--omit=dev'], lock, false);
    audit([], lock, true);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
