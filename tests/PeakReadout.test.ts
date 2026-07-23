import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PeakReadout } from '../lib/tools/volume-fades/PeakReadout';

describe('volume peak readout accessibility', () => {
  it('announces the projected peak and clipping state from a stable live region', () => {
    const markup = renderToStaticMarkup(createElement(PeakReadout, { amplitude: 1.25 }));

    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('aria-atomic="true"');
    expect(markup).toContain('1.9 dBFS');
    expect(markup).toContain('Peak state: potential clipping.');
  });
});
