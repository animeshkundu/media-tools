import { describe, expect, it } from 'vitest';

const VALID_MANIFEST = {
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

async function loadCheckCsp() {
  return (await import(new URL('../scripts/check-csp.mjs', import.meta.url).href)) as {
    isDirectExecution: (entryPath: string | undefined, metaUrl?: string) => boolean;
    validateManifest: (manifest: unknown, source: string) => void;
  };
}

describe('check-csp', () => {
  it('accepts the expected production CSP policy', async () => {
    const { validateManifest } = await loadCheckCsp();
    expect(() => validateManifest(VALID_MANIFEST, 'fixture')).not.toThrow();
  });

  it('matches the CLI entrypoint for relative and absolute script paths', async () => {
    const { isDirectExecution } = await loadCheckCsp();
    expect(
      isDirectExecution(
        'scripts/check-csp.mjs',
        'file:///home/runner/work/media-tools/media-tools/scripts/check-csp.mjs',
      ),
    ).toBe(true);
    expect(
      isDirectExecution(
        '/home/runner/work/media-tools/media-tools/scripts/check-csp.mjs',
        'file:///home/runner/work/media-tools/media-tools/scripts/check-csp.mjs',
      ),
    ).toBe(true);
    expect(isDirectExecution(undefined)).toBe(false);
  });
});
