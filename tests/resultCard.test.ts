import { createElement } from 'react';
import { parseHTML } from 'linkedom';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { copyTextMock } = vi.hoisted(() => ({
  copyTextMock: vi.fn<() => Promise<void>>(),
}));

vi.mock('@/lib/core/share', async () => {
  const actual = await vi.importActual<typeof import('../lib/core/share')>('../lib/core/share');
  return { ...actual, copyText: copyTextMock };
});

import { ResultCard } from '../components/ResultCard';
import { buildShareMarkdown, PRODUCT_URL } from '../lib/core/share';

const originalGlobals = {
  Event: globalThis.Event,
  HTMLElement: globalThis.HTMLElement,
  HTMLButtonElement: globalThis.HTMLButtonElement,
  IS_REACT_ACT_ENVIRONMENT: (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT,
  MouseEvent: globalThis.MouseEvent,
  SVGElement: globalThis.SVGElement,
  document: globalThis.document,
  location: globalThis.location,
  navigator: globalThis.navigator,
  window: globalThis.window,
};

afterEach(() => {
  copyTextMock.mockReset();
  const globals = globalThis as Record<string, unknown>;
  for (const [key, value] of Object.entries(originalGlobals)) {
    if (value === undefined) {
      delete globals[key];
    } else {
      Object.defineProperty(globalThis, key, {
        configurable: true,
        value,
        writable: true,
      });
    }
  }
});

describe('ResultCard', () => {
  const props = {
    summary: 'Cut 0:03.0 from the source and exported WAV (1.2 MB).',
    thumbnailUrl: 'data:image/png;base64,preview',
    title: 'Audio cut complete',
  };

  it('renders a preview, concise result summary, privacy copy, and both share actions', () => {
    const markup = renderToStaticMarkup(createElement(ResultCard, props));

    expect(markup).toContain('aria-label="Share latest export"');
    expect(markup).toContain('Waveform preview of the exported audio');
    expect(markup).toContain(props.thumbnailUrl);
    expect(markup).toContain(props.title);
    expect(markup).toContain(props.summary);
    expect(markup).toContain('The link shares Media Tools, not your audio.');
    expect(markup).toContain('Copy link');
    expect(markup).toContain('Copy as markdown');
    expect(markup).toContain('aria-live="polite"');
  });

  it('copies the product link and generated markdown from one-click actions', async () => {
    copyTextMock.mockResolvedValue(undefined);
    const { document, window } = parseHTML(
      '<!doctype html><html><body><div id="root"></div></body></html>',
    );
    const location = new URL('http://localhost/app.html');
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: location,
      writable: true,
    });
    for (const [key, value] of Object.entries({
      window,
      document,
      navigator: window.navigator,
      location,
      HTMLElement: window.HTMLElement,
      HTMLButtonElement: window.HTMLButtonElement,
      SVGElement: window.SVGElement,
      Event: window.Event,
      MouseEvent: window.MouseEvent,
      IS_REACT_ACT_ENVIRONMENT: true,
    })) {
      Object.defineProperty(globalThis, key, {
        configurable: true,
        value,
        writable: true,
      });
    }

    const { act } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const container = document.getElementById('root');
    if (!container) throw new Error('Missing result-card test container.');

    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(ResultCard, props));
    });

    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons.map((button) => button.textContent)).toEqual([
      'Copy link',
      'Copy as markdown',
    ]);

    await act(async () => {
      buttons[0]!.click();
      await Promise.resolve();
    });
    expect(copyTextMock).toHaveBeenNthCalledWith(1, PRODUCT_URL);
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe('Link copied.');

    await act(async () => {
      buttons[1]!.click();
      await Promise.resolve();
    });
    expect(copyTextMock).toHaveBeenNthCalledWith(
      2,
      buildShareMarkdown(props.title, props.summary),
    );
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe(
      'Markdown copied.',
    );

    await act(async () => {
      root.unmount();
    });
  });
});
