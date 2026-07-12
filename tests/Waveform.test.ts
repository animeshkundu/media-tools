import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Waveform, moveTrimHandle } from '../lib/tools/audio-cutter/Waveform';

describe('audio cutter waveform keyboard controls', () => {
  it('renders independently focusable trim handles with accessible values and instructions', () => {
    const markup = renderToStaticMarkup(
      createElement(Waveform, {
        channel: new Float32Array(),
        duration: 10,
        start: 1.25,
        end: 8.75,
        onChange: () => undefined,
      }),
    );

    expect(markup.match(/role="slider"/g)).toHaveLength(2);
    expect(markup.match(/tabindex="0"/g)).toHaveLength(2);
    expect(markup).toContain('aria-label="In point"');
    expect(markup).toContain('aria-valuetext="1.25 seconds"');
    expect(markup).toContain('aria-label="Out point"');
    expect(markup).toContain('aria-valuetext="8.75 seconds"');
    expect(markup).toContain('Left and Right Arrow keys for 0.01 second steps');
    expect(markup).toContain('Shift for 0.1 second steps');
    expect(markup).toContain('aria-live="polite"');
  });

  it('applies fine and coarse arrow increments while preserving the minimum selection', () => {
    expect(moveTrimHandle('start', 1, false, 1, 9, 10)).toEqual([1.01, 9]);
    expect(moveTrimHandle('end', -1, true, 1, 9, 10)).toEqual([1, 8.9]);
    expect(moveTrimHandle('start', 1, true, 1, 1.05, 10)).toEqual([1, 1.05]);
    expect(moveTrimHandle('end', -1, false, 1, 1.05, 10)).toEqual([1, 1.05]);
    expect(moveTrimHandle('start', -1, true, 0, 9, 10)).toEqual([0, 9]);
    expect(moveTrimHandle('end', 1, true, 1, 10, 10)).toEqual([1, 10]);
  });
});
