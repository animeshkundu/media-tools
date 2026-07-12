import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const EXPECTED_DIRECTIVES = new Map([
  ['default-src', ["'none'"]],
  ['script-src', ["'self'"]],
  ['style-src', ["'self'", "'unsafe-inline'"]],
  ['img-src', ["'self'", 'data:', 'blob:']],
  ['media-src', ["'self'", 'blob:']],
  ['worker-src', ["'self'"]],
  ['connect-src', ["'none'"]],
  ['form-action', ["'none'"]],
  ['frame-src', ["'none'"]],
  ['object-src', ["'self'"]],
  ['base-uri', ["'none'"]],
]);

function parsePolicy(policy, source) {
  if (typeof policy !== 'string') {
    throw new Error(`${source}: content_security_policy.extension_pages must be a string`);
  }

  const directives = new Map();
  for (const entry of policy.split(';')) {
    const tokens = entry.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;

    const [name, ...values] = tokens;
    if (directives.has(name)) {
      throw new Error(`${source}: duplicate CSP directive ${name}`);
    }
    directives.set(name, values);
  }
  return directives;
}

export function validateManifest(manifest, source) {
  const policy = manifest?.content_security_policy?.extension_pages;
  const directives = parsePolicy(policy, source);

  for (const name of directives.keys()) {
    if (!EXPECTED_DIRECTIVES.has(name)) {
      throw new Error(`${source}: unapproved CSP directive ${name}`);
    }
  }

  for (const [name, expectedValues] of EXPECTED_DIRECTIVES) {
    const actualValues = directives.get(name);
    if (!actualValues) {
      throw new Error(`${source}: missing CSP directive ${name}`);
    }
    const unexpectedValues = actualValues.filter((value) => !expectedValues.includes(value));
    if (
      actualValues.length !== expectedValues.length ||
      expectedValues.some((value) => !actualValues.includes(value)) ||
      unexpectedValues.length > 0
    ) {
      throw new Error(
        `${source}: ${name} must be ${expectedValues.join(' ')}, found ${actualValues.join(' ')}`,
      );
    }
  }
}

export function isDirectExecution(entryPath, metaUrl = import.meta.url) {
  return Boolean(entryPath) && metaUrl === pathToFileURL(resolve(entryPath)).href;
}

async function main(paths) {
  if (paths.length === 0) {
    throw new Error('Usage: node scripts/check-csp.mjs <manifest.json> [...]');
  }

  for (const path of paths) {
    let manifest;
    try {
      manifest = JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      throw new Error(`${path}: unable to read manifest: ${error.message}`, { cause: error });
    }
    validateManifest(manifest, path);
    process.stdout.write(`${path}: CSP verified\n`);
  }
}

if (isDirectExecution(process.argv[1])) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
