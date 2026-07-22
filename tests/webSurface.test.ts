import { readdirSync, readFileSync } from 'node:fs';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/Button', () => ({
  Button: ({ children }: { children?: ReactNode }) => createElement('button', null, children),
}));
vi.mock('@/components/Progress', () => ({
  Progress: () => createElement('div', { role: 'progressbar' }),
}));
vi.mock('@/lib/core/download', () => ({ downloadBlob: () => undefined }));
vi.mock('@/lib/core/dropzone', () => ({
  Dropzone: ({ children }: { children?: ReactNode }) =>
    createElement('div', { role: 'button' }, children),
}));
vi.mock('@/lib/core/format', () => ({
  formatBytes: () => '1 MB',
  formatDuration: () => '0:01.0',
  outputName: () => 'output.wav',
}));
vi.mock('@/lib/core/worker', () => ({
  startAnalyze: () => ({ cancel: () => undefined, result: Promise.resolve() }),
  startFileEncode: () => ({ cancel: () => undefined, result: Promise.resolve(new Blob()) }),
}));
vi.mock('@/lib/tools/audio-cutter/Waveform', () => ({
  Waveform: () => createElement('div'),
}));
vi.mock('../entrypoints/app/ChangeSpeedTool', () => ({
  ChangeSpeedTool: () => createElement('section'),
}));
vi.mock('../entrypoints/app/ConvertTool', () => ({
  ConvertTool: () => createElement('section'),
}));
vi.mock('../entrypoints/app/JoinMergeTool', () => ({
  JoinMergeTool: () => createElement('section'),
}));
vi.mock('../entrypoints/app/TrimTimeFields', () => ({
  TrimTimeFields: () => createElement('div'),
}));

const { default: App } = await import('../entrypoints/app/App');

describe('shared web and extension editor surfaces', () => {
  it('renders all four tools from one app shell with surface-specific trust copy', () => {
    const webMarkup = renderToStaticMarkup(createElement(App, { surface: 'web' }));
    const extensionMarkup = renderToStaticMarkup(createElement(App, { surface: 'extension' }));

    expect(webMarkup.match(/role="tab"/g)).toHaveLength(4);
    expect(webMarkup.match(/tabindex="0"/g)).toHaveLength(1);
    expect(webMarkup.match(/tabindex="-1"/g)).toHaveLength(3);
    expect(webMarkup).toContain('Cut audio');
    expect(webMarkup).toContain('Join / merge');
    expect(webMarkup).toContain('Change speed');
    expect(webMarkup).toContain('Convert WAV / MP3');
    expect(webMarkup).toContain('Local in this tab');
    expect(webMarkup).toContain('Files are not uploaded and there is no telemetry.');
    expect(webMarkup).not.toContain('Zero permissions and a no-egress extension policy');

    expect(extensionMarkup).toContain('Locked down locally');
    expect(extensionMarkup).toContain('Zero permissions and a no-egress extension policy');
    expect(extensionMarkup).toContain('Works offline');
  });

  it('mounts the hosted target from the shared App and presents both product choices honestly', () => {
    const webEntry = readFileSync(new URL('../web/main.tsx', import.meta.url), 'utf8');
    const landingPage = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
    const webDocument = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');

    expect(webEntry).toContain("import App from '@/entrypoints/app/App'");
    expect(webEntry).toContain('<App surface="web" />');
    expect(webDocument).toContain('href="/media-tools/styles.css"');
    expect(webDocument).toContain('class="skip-link"');
    expect(landingPage).toContain('href="/media-tools/app/"');
    expect(landingPage).toContain('Like any hosted page, its code is delivered by the website');
    expect(landingPage).toContain("connect-src 'none'");
    expect(landingPage).toContain(
      'Private, offline audio cutting for Firefox and Chrome, entirely in your browser.',
    );
  });

  it('ships the static hosted artifact with local worker and encoder assets', () => {
    const appDirectory = new URL('../site/app/', import.meta.url);
    const appDocument = readFileSync(new URL('index.html', appDirectory), 'utf8');
    const assetFiles = readdirSync(new URL('assets/', appDirectory));
    const executableFiles = assetFiles.filter((file) => file.endsWith('.js'));
    const executableSource = executableFiles
      .map((file) => readFileSync(new URL(`assets/${file}`, appDirectory), 'utf8'))
      .join('\n');

    expect(appDocument).toContain('src="/media-tools/app/assets/');
    expect(appDocument).toContain('href="/media-tools/app/assets/');
    expect(assetFiles.some((file) => file.startsWith('encode.worker-'))).toBe(true);
    expect(readFileSync(new URL('vendor/lame.min.js', appDirectory))).not.toHaveLength(0);
    expect(executableSource).not.toMatch(
      /fetch\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource/,
    );
  });
});
