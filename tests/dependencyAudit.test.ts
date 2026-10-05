import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateAudit } from '../scripts/audit-dependencies.mjs';

function fixture() {
  return {
    report: { auditReportVersion: 2, vulnerabilities: {
      braces: { severity: 'high', nodes: ['node_modules/braces'], via: [{ name: 'braces', severity: 'high', url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm' }] },
      tool: { severity: 'high', nodes: ['node_modules/tool'], via: ['braces'] },
    } },
    lock: { packages: {
      'node_modules/braces': { version: '3.0.3', dev: true },
      'node_modules/tool': { version: '1.0.0', dev: true },
    } },
  };
}
const options = { development: true, now: Date.parse('2026-10-05T00:00:00Z') };

test('only the known, development-only advisory and its dependency chain are excepted', () => {
  const { report, lock } = fixture();
  assert.deepEqual(evaluateAudit(report, lock, options), { blocked: [], excepted: ['braces', 'tool'] });
  assert.deepEqual(evaluateAudit(report, lock, { ...options, development: false }).blocked, ['braces', 'tool']);
  lock.packages['node_modules/braces'].dev = false;
  assert.deepEqual(evaluateAudit(report, lock, options).blocked, ['braces', 'tool']);
});

test('unknown advisories, critical severity and changed package versions block publishing', () => {
  const { report, lock } = fixture();
  report.vulnerabilities.braces.via.push({ name: 'braces', severity: 'high', url: 'https://github.com/advisories/new-finding' });
  assert.deepEqual(evaluateAudit(report, lock, options).blocked, ['braces', 'tool']);
  report.vulnerabilities.braces.via.pop();
  report.vulnerabilities.braces.severity = 'critical';
  assert.deepEqual(evaluateAudit(report, lock, options).blocked, ['braces', 'tool']);
  report.vulnerabilities.braces.severity = 'high';
  lock.packages['node_modules/braces'].version = '3.0.4';
  assert.deepEqual(evaluateAudit(report, lock, options).blocked, ['braces', 'tool']);
});

test('the exception expires and missing dependency metadata fails closed', () => {
  const { report, lock } = fixture();
  assert.deepEqual(evaluateAudit(report, lock, { ...options, now: Date.parse('2026-11-05T00:00:00Z') }).blocked, ['braces', 'tool']);
  assert.deepEqual(evaluateAudit(report, { packages: {} }, options).blocked, ['braces', 'tool']);
  assert.throws(() => evaluateAudit({ error: 'registry unavailable' }, lock, options));
  report.vulnerabilities.tool.via = ['tool'];
  assert.deepEqual(evaluateAudit(report, lock, options).blocked, ['tool']);
});
