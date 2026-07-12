import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL, URL } from 'node:url';

const BUILT_MANIFEST_PATHS = [
  '.output/chrome-mv3/manifest.json',
  '.output/firefox-mv3/manifest.json',
];
const WEB_ACCESSIBLE_RESOURCE_KEYS = new Set([
  'resources',
  'matches',
  'extension_ids',
  'use_dynamic_url',
]);

function requireStringArray(value, source, field) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((entry) => typeof entry !== 'string' || entry.length === 0)
  ) {
    throw new Error(`${source}: ${field} must be a non-empty array of non-empty strings`);
  }
  return value;
}

function validateMatchPattern(pattern, source) {
  if (pattern === '<all_urls>') {
    throw new Error(`${source}: web_accessible_resources matches must not contain <all_urls>`);
  }

  const match = /^(https?):\/\/([^/]+)(\/.*)$/.exec(pattern);
  if (!match || match[2].includes('*')) {
    throw new Error(
      `${source}: web_accessible_resources match ${JSON.stringify(pattern)} must use an exact http(s) origin`,
    );
  }

  try {
    const parsed = new URL(`${match[1]}://${match[2]}/`);
    if (parsed.username || parsed.password || parsed.origin === 'null') throw new Error();
  } catch {
    throw new Error(
      `${source}: web_accessible_resources match ${JSON.stringify(pattern)} has an invalid origin`,
    );
  }
}

function validateResource(resource, source) {
  if (
    resource.includes('*') ||
    resource.includes('\\') ||
    resource.split('/').includes('..') ||
    /^[a-z][a-z\d+.-]*:/i.test(resource)
  ) {
    throw new Error(
      `${source}: web_accessible_resources resource ${JSON.stringify(resource)} is not narrowly scoped`,
    );
  }
}

function validateWebAccessibleResources(value, source) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${source}: web_accessible_resources must be absent or a non-empty array`);
  }

  value.forEach((entry, index) => {
    const entrySource = `${source}: web_accessible_resources[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`${entrySource} must be an object`);
    }

    for (const key of Object.keys(entry)) {
      if (!WEB_ACCESSIBLE_RESOURCE_KEYS.has(key)) {
        throw new Error(`${entrySource} contains unapproved key ${key}`);
      }
    }

    requireStringArray(entry.resources, entrySource, 'resources').forEach((resource) =>
      validateResource(resource, entrySource),
    );

    const hasMatches = Object.hasOwn(entry, 'matches');
    const hasExtensionIds = Object.hasOwn(entry, 'extension_ids');
    if (!hasMatches && !hasExtensionIds) {
      throw new Error(`${entrySource} must be scoped by matches or extension_ids`);
    }
    if (hasMatches) {
      requireStringArray(entry.matches, entrySource, 'matches').forEach((pattern) =>
        validateMatchPattern(pattern, entrySource),
      );
    }
    if (hasExtensionIds) {
      requireStringArray(entry.extension_ids, entrySource, 'extension_ids').forEach((id) => {
        if (id.includes('*')) {
          throw new Error(`${entrySource}: extension_ids must not contain wildcards`);
        }
      });
    }
    if (Object.hasOwn(entry, 'use_dynamic_url') && typeof entry.use_dynamic_url !== 'boolean') {
      throw new Error(`${entrySource}: use_dynamic_url must be a boolean`);
    }
  });
}

export function validateManifestEgress(manifest, source) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`${source}: manifest must be an object`);
  }
  if (manifest.manifest_version !== 3) {
    throw new Error(`${source}: manifest_version must be 3`);
  }

  for (const key of [
    'permissions',
    'optional_permissions',
    'host_permissions',
    'optional_host_permissions',
  ]) {
    if (Object.hasOwn(manifest, key) && (!Array.isArray(manifest[key]) || manifest[key].length > 0)) {
      throw new Error(`${source}: ${key} must be absent or empty`);
    }
  }

  if (Object.hasOwn(manifest, 'content_scripts')) {
    throw new Error(`${source}: content_scripts must be absent`);
  }

  if (Object.hasOwn(manifest, 'externally_connectable')) {
    throw new Error(`${source}: externally_connectable must be absent`);
  }

  if (Object.hasOwn(manifest, 'web_accessible_resources')) {
    validateWebAccessibleResources(manifest.web_accessible_resources, source);
  }
}

async function main() {
  for (const path of BUILT_MANIFEST_PATHS) {
    let manifest;
    try {
      manifest = JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      throw new Error(`${path}: unable to read manifest: ${error.message}`, { cause: error });
    }
    validateManifestEgress(manifest, path);
    process.stdout.write(`${path}: manifest egress guard verified\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.cwd(), process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
