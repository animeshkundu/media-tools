#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPORT_PATH = path.join(REPO_ROOT, 'e2e-results.json');
const EXPECTED_MIN = Number(process.env.E2E_EXPECTED_MIN ?? '10');

function fail(message) {
  process.stderr.write(`[assert-e2e-ran] FAIL: ${message}\n`);
  process.exit(1);
}

let raw;
try {
  raw = readFileSync(REPORT_PATH, 'utf8');
} catch (error) {
  fail(`could not read Playwright JSON report at ${REPORT_PATH}: ${error.message}`);
}

let report;
try {
  report = JSON.parse(raw);
} catch (error) {
  fail(`Playwright JSON report is not valid JSON: ${error.message}`);
}

const stats = report?.stats;
if (!stats || typeof stats !== 'object') {
  fail('report has no `stats` object');
}
for (const key of ['expected', 'skipped', 'unexpected', 'flaky']) {
  if (!Number.isInteger(stats[key]) || stats[key] < 0) {
    fail(`report.stats.${key} is not a non-negative integer`);
  }
}

if (!Number.isInteger(EXPECTED_MIN) || EXPECTED_MIN < 1) {
  fail(`E2E_EXPECTED_MIN must be a positive integer, got ${process.env.E2E_EXPECTED_MIN}`);
}

const tests = [];
function collectTests(suites = []) {
  for (const suite of suites) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) tests.push({ title: spec.title, ...test });
    }
    collectTests(suite.suites);
  }
}
collectTests(report.suites);

const invalidTests = [];
let cleanPasses = 0;
for (const test of tests) {
  const results = Array.isArray(test.results) ? test.results : [];
  const cleanPass =
    test.expectedStatus === 'passed' &&
    test.status === 'expected' &&
    results.length > 0 &&
    results.every((result) => result.status === 'passed');
  if (cleanPass) cleanPasses += 1;
  else invalidTests.push(`${test.projectName ?? 'default'}: ${test.title}`);
}

const { expected, skipped, unexpected, flaky } = stats;
if ((report.errors?.length ?? 0) !== 0) fail('the report contains run-level errors');
if (unexpected !== 0) fail(`${unexpected} test(s) failed`);
if (flaky !== 0) fail(`${flaky} test(s) were flaky`);
if (skipped !== 0) fail(`${skipped} test(s) were skipped`);
if (invalidTests.length !== 0) fail(`non-passing tests: ${invalidTests.join('; ')}`);
if (tests.length !== cleanPasses || expected !== cleanPasses) {
  fail(`discovered ${tests.length} tests, but only ${cleanPasses} were clean passes`);
}
if (cleanPasses < EXPECTED_MIN) {
  fail(`only ${cleanPasses} test(s) passed; expected at least ${EXPECTED_MIN} to run`);
}

process.stdout.write(
  `[assert-e2e-ran] OK: ${cleanPasses} passed, ${skipped} skipped, ${unexpected} failed, ${flaky} flaky (min expected ${EXPECTED_MIN}).\n`,
);
