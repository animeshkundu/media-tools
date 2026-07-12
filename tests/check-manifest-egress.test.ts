import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { validateManifestEgress } from '../scripts/check-manifest-egress.mjs';

const execFileAsync = promisify(execFile);
const tempDirsToCleanup: string[] = [];

afterEach(async () => {
  const dirs = tempDirsToCleanup.splice(0, tempDirsToCleanup.length);
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('check-manifest-egress script', () => {
  it('accepts absent or empty permissions', () => {
    expect(() => validateManifestEgress({ manifest_version: 3 }, 'absent')).not.toThrow();
    expect(() =>
      validateManifestEgress(
        {
          manifest_version: 3,
          permissions: [],
          optional_permissions: [],
          host_permissions: [],
          optional_host_permissions: [],
        },
        'empty',
      ),
    ).not.toThrow();
  });

  it.each([
    ['permissions', 'nativeMessaging'],
    ['permissions', 'proxy'],
    ['optional_permissions', 'webRequest'],
    ['host_permissions', 'https://example.com/*'],
    ['optional_host_permissions', 'https://example.com/*'],
  ])('rejects non-empty %s', (key, permission) => {
    expect(() =>
      validateManifestEgress({ manifest_version: 3, [key]: [permission] }, key),
    ).toThrow(new RegExp(`${key}: ${key} must be absent or empty`));
  });

  it('rejects content scripts even when narrowly matched', () => {
    expect(() =>
      validateManifestEgress(
        {
          manifest_version: 3,
          content_scripts: [{ matches: ['https://example.com/*'], js: ['content.js'] }],
        },
        'content',
      ),
    ).toThrow(/content: content_scripts must be absent/);
  });

  it('rejects externally_connectable even when empty', () => {
    expect(() =>
      validateManifestEgress(
        { manifest_version: 3, externally_connectable: {} },
        'external',
      ),
    ).toThrow(/external: externally_connectable must be absent/);
  });

  it('accepts narrowly scoped web-accessible resources', () => {
    expect(() =>
      validateManifestEgress(
        {
          manifest_version: 3,
          web_accessible_resources: [
            {
              resources: ['assets/player.js', 'assets/icons/*.svg'],
              matches: ['https://media.example.com/tools/*'],
              use_dynamic_url: true,
            },
            {
              resources: ['bridge.js'],
              extension_ids: ['abcdefghijklmnopabcdefghijklmnop'],
            },
          ],
        },
        'narrow',
      ),
    ).not.toThrow();
  });

  it.each([
    {
      name: 'all URLs',
      entry: { resources: ['player.js'], matches: ['<all_urls>'] },
      message: '<all_urls>',
    },
    {
      name: 'wildcard origins',
      entry: { resources: ['player.js'], matches: ['*://*.example.com/*'] },
      message: 'must use an exact http\\(s\\) origin',
    },
    {
      name: 'global resource wildcards',
      entry: { resources: ['**/*'], matches: ['https://example.com/*'] },
      message: 'is not narrowly scoped',
    },
    {
      name: 'wildcard extension IDs',
      entry: { resources: ['player.js'], extension_ids: ['*'] },
      message: 'extension_ids must not contain wildcards',
    },
    {
      name: 'missing consumer scope',
      entry: { resources: ['player.js'] },
      message: 'must be scoped by matches or extension_ids',
    },
  ])('rejects $name in web-accessible resources', ({ entry, message }) => {
    expect(() =>
      validateManifestEgress(
        { manifest_version: 3, web_accessible_resources: [entry] },
        'broad',
      ),
    ).toThrow(new RegExp(message));
  });

  it('fails closed on malformed manifest keys and resource entries', () => {
    expect(() =>
      validateManifestEgress({ manifest_version: 3, host_permissions: null }, 'null-hosts'),
    ).toThrow(/null-hosts: host_permissions must be absent or empty/);
    expect(() =>
      validateManifestEgress({ manifest_version: 3, web_accessible_resources: [] }, 'empty-war'),
    ).toThrow(/empty-war: web_accessible_resources must be absent or a non-empty array/);
    expect(() =>
      validateManifestEgress(
        {
          manifest_version: 3,
          web_accessible_resources: [
            {
              resources: ['player.js'],
              matches: ['https://example.com/*'],
              unexpected: true,
            },
          ],
        },
        'unknown',
      ),
    ).toThrow(/unknown: web_accessible_resources\[0\] contains unapproved key unexpected/);
  });

  it('checks both built browser manifests from the CLI', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'check-manifest-egress-'));
    tempDirsToCleanup.push(tempDir);
    const chromeDir = join(tempDir, '.output/chrome-mv3');
    const firefoxDir = join(tempDir, '.output/firefox-mv3');
    await Promise.all([
      mkdir(chromeDir, { recursive: true }),
      mkdir(firefoxDir, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(chromeDir, 'manifest.json'), JSON.stringify({ manifest_version: 3 })),
      writeFile(join(firefoxDir, 'manifest.json'), JSON.stringify({ manifest_version: 3 })),
    ]);

    const scriptPath = resolve('scripts/check-manifest-egress.mjs');
    const { stdout, stderr } = await execFileAsync(process.execPath, [scriptPath], { cwd: tempDir });

    expect(stderr).toBe('');
    expect(stdout).toContain('.output/chrome-mv3/manifest.json: manifest egress guard verified');
    expect(stdout).toContain('.output/firefox-mv3/manifest.json: manifest egress guard verified');
  });

  it('fails when either built browser manifest broadens egress', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'check-manifest-egress-invalid-'));
    tempDirsToCleanup.push(tempDir);
    const chromeDir = join(tempDir, '.output/chrome-mv3');
    const firefoxDir = join(tempDir, '.output/firefox-mv3');
    await Promise.all([
      mkdir(chromeDir, { recursive: true }),
      mkdir(firefoxDir, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(chromeDir, 'manifest.json'), JSON.stringify({ manifest_version: 3 })),
      writeFile(
        join(firefoxDir, 'manifest.json'),
        JSON.stringify({ manifest_version: 3, host_permissions: ['<all_urls>'] }),
      ),
    ]);

    const scriptPath = resolve('scripts/check-manifest-egress.mjs');
    await expect(execFileAsync(process.execPath, [scriptPath], { cwd: tempDir })).rejects.toMatchObject(
      {
        code: 1,
        stderr: expect.stringContaining('host_permissions must be absent or empty'),
      },
    );
  });
});
