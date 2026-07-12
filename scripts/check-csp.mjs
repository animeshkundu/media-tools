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

const ASCII_CSP_WHITESPACE = '[ \\t\\r\\n\\f]';
const ASCII_CSP_WHITESPACE_PATTERN = new RegExp(`${ASCII_CSP_WHITESPACE}+`, 'g');
const ASCII_CSP_TRIM_PATTERN = new RegExp(`^${ASCII_CSP_WHITESPACE}+|${ASCII_CSP_WHITESPACE}+$`, 'g');
const NON_ASCII_OR_INVALID_CSP_CHARACTER_PATTERN = /[^\x20-\x7E\t\r\n\f]/;

function trimAsciiWhitespace(value) {
  return value.replace(ASCII_CSP_TRIM_PATTERN, '');
}

function parsePolicy(policy, source) {
  if (typeof policy !== 'string') {
    throw new Error(`${source}: content_security_policy.extension_pages must be a string`);
  }
  if (NON_ASCII_OR_INVALID_CSP_CHARACTER_PATTERN.test(policy)) {
    throw new Error(
      `${source}: content_security_policy.extension_pages must use ASCII characters and ASCII whitespace only`,
    );
  }

  const directives = new Map();
  for (const entry of policy.split(';')) {
    const tokens = trimAsciiWhitespace(entry)
      .split(ASCII_CSP_WHITESPACE_PATTERN)
      .filter(Boolean);
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
  const contentSecurityPolicy = manifest?.content_security_policy;
  if (
    contentSecurityPolicy &&
    typeof contentSecurityPolicy === 'object' &&
    !Array.isArray(contentSecurityPolicy)
  ) {
    const contentSecurityPolicyKeys = Object.keys(contentSecurityPolicy);
    if (
      contentSecurityPolicyKeys.length !== 1 ||
      !contentSecurityPolicyKeys.includes('extension_pages')
    ) {
      throw new Error(
        `${source}: content_security_policy keys must be extension_pages, found ${contentSecurityPolicyKeys.join(', ') || '(none)'}`,
      );
    }
  }

  const policy = contentSecurityPolicy?.extension_pages;
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

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.cwd(), process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
