import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { validateManifest } from '../scripts/check-csp.mjs';

const execFileAsync = promisify(execFile);
const tempDirsToCleanup: string[] = [];
const validManifest = {
  manifest_version: 3,
  content_security_policy: {
    extension_pages: [
      "default-src 'none'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "worker-src 'self'",
      "connect-src 'none'",
      "form-action 'none'",
      "frame-src 'none'",
      "object-src 'self'",
      "base-uri 'none'",
    ].join('; '),
  },
};

function cloneManifest() {
  return JSON.parse(JSON.stringify(validManifest)) as typeof validManifest;
}

afterEach(async () => {
  const dirs = tempDirsToCleanup.splice(0, tempDirsToCleanup.length);
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('check-csp script', () => {
  it('rejects missing or broadened CSP directives', () => {
    const missingDirective = cloneManifest();
    missingDirective.content_security_policy.extension_pages = missingDirective.content_security_policy.extension_pages
      .split('; ')
      .filter((directive) => !directive.startsWith('connect-src '))
      .join('; ');

    const broadenedDirective = cloneManifest();
    broadenedDirective.content_security_policy.extension_pages = broadenedDirective.content_security_policy.extension_pages.replace(
      "connect-src 'none'",
      "connect-src *",
    );

    expect(() => validateManifest(missingDirective, 'missing')).toThrow(
      /missing: missing CSP directive connect-src/,
    );
    expect(() => validateManifest(broadenedDirective, 'broadened')).toThrow(
      /broadened: connect-src must be 'none', found \*/,
    );
    expect(() => validateManifest({ manifest_version: 3 }, 'no-csp')).toThrow(
      /no-csp: content_security_policy\.extension_pages must be a string/,
    );
  });

  it('rejects sibling content_security_policy keys', () => {
    const siblingKeyManifest = cloneManifest() as typeof validManifest & {
      content_security_policy: typeof validManifest.content_security_policy & { sandbox: string };
    };
    siblingKeyManifest.content_security_policy.sandbox = "sandbox allow-scripts; connect-src *";

    expect(() => validateManifest(siblingKeyManifest, 'sibling-key')).toThrow(
      /sibling-key: content_security_policy keys must be extension_pages, found extension_pages, sandbox/,
    );
  });

  it('validates manifests when the CLI script path in argv[1] is relative', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'check-csp-'));
    tempDirsToCleanup.push(tempDir);

    const manifestPath = join(tempDir, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify(validManifest));

    const scriptPath = 'scripts/check-csp.mjs';
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `process.argv = ['node', ${JSON.stringify(scriptPath)}, ${JSON.stringify(
          manifestPath,
        )}]; await import('./scripts/check-csp.mjs');`,
      ],
      { cwd: process.cwd() },
    );

    expect(stderr).toBe('');
    expect(stdout).toContain(`${manifestPath}: CSP verified`);
  });

  it('reports invalid manifests when executed through the CLI path', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'check-csp-invalid-'));
    tempDirsToCleanup.push(tempDir);

    const manifestPath = join(tempDir, 'manifest.json');
    const invalidManifest = cloneManifest();
    invalidManifest.content_security_policy.extension_pages = invalidManifest.content_security_policy.extension_pages.replace(
      "connect-src 'none'",
      "connect-src *",
    );
    await writeFile(manifestPath, JSON.stringify(invalidManifest));

    const invalidCliRunPromise = execFileAsync(process.execPath, ['scripts/check-csp.mjs', manifestPath], {
      cwd: process.cwd(),
    });
    await expect(
      invalidCliRunPromise,
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("connect-src must be 'none', found *"),
    });
  });
});
