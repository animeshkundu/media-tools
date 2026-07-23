import { createElement, type ReactNode } from 'react';
import { parseHTML } from 'linkedom';
import { describe, expect, it, vi } from 'vitest';

describe('VolumeFadesTool analysis cancellation', () => {
  it('offers cancellation while the initial worker analysis is running', async () => {
    vi.resetModules();
    const globalKeys = [
      'window',
      'document',
      'navigator',
      'location',
      'HTMLElement',
      'HTMLInputElement',
      'SVGElement',
      'Event',
      'MouseEvent',
      'IS_REACT_ACT_ENVIRONMENT',
    ] as const;
    const originalGlobals = new Map(
      globalKeys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
    );
    let rejectAnalysis: (error: Error) => void = () => undefined;
    const cancel = vi.fn(() => rejectAnalysis(new Error('Audio processing cancelled.')));

    vi.doMock('@/components/Button', () => ({
      Button: ({
        children,
        disabled,
        onClick,
      }: {
        children: ReactNode;
        disabled?: boolean;
        onClick?: () => void;
      }) => createElement('button', { disabled, onClick, type: 'button' }, children),
    }));
    vi.doMock('@/components/Progress', () => ({
      Progress: () => createElement('div', { role: 'progressbar' }),
    }));
    vi.doMock('@/lib/core/download', () => ({ downloadBlob: () => undefined }));
    vi.doMock('@/lib/core/dropzone', () => ({
      Dropzone: ({
        children,
        disabled,
        onFile,
      }: {
        children: ReactNode;
        disabled?: boolean;
        onFile: (file: File) => void;
      }) =>
        createElement(
          'label',
          null,
          createElement('input', {
            disabled,
            type: 'file',
            onChange: (event: { target: { files?: File[] } }) => {
              const file = event.target.files?.[0];
              if (file) onFile(file);
            },
          }),
          children,
        ),
    }));
    vi.doMock('@/lib/core/format', () => ({
      formatBytes: () => '1 KB',
      formatDuration: () => '1s',
      outputName: () => 'volume-adjusted.wav',
    }));
    vi.doMock('@/lib/core/worker', () => ({
      startAnalyze: vi.fn(() => ({
        cancel,
        result: new Promise((_, reject) => {
          rejectAnalysis = reject;
        }),
      })),
    }));
    vi.doMock('@/lib/tools/volume-fades/startVolumeFades', () => ({
      startVolumeFadesEncode: vi.fn(),
    }));
    vi.doMock('@/lib/tools/volume-fades/PeakReadout', () => ({
      PeakReadout: () => createElement('span'),
    }));
    vi.doMock('@/lib/tools/volume-fades/volumeFades', () => ({
      amplitudeToDbfs: () => Number.NEGATIVE_INFINITY,
      peakState: () => 'safe',
      previewBinnedVolumeFades: vi.fn(),
    }));

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
      HTMLInputElement: window.HTMLInputElement,
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

    try {
      const { act } = await import('react');
      const { createRoot } = await import('react-dom/client');
      const { VolumeFadesTool } = await import('../entrypoints/app/VolumeFadesTool');
      const container = document.getElementById('root');
      if (!container) throw new Error('Missing root container.');
      const root = createRoot(container);

      await act(async () => {
        root.render(createElement(VolumeFadesTool));
      });
      const fileInput = container.querySelector('input[type="file"]');
      if (!(fileInput instanceof window.HTMLInputElement)) {
        throw new Error('Missing file input.');
      }
      Object.defineProperty(fileInput, 'files', {
        configurable: true,
        value: [new File([new Uint8Array([1])], 'volume.wav', { type: 'audio/wav' })],
      });
      await act(async () => {
        fileInput.dispatchEvent(new window.Event('change', { bubbles: true }));
      });

      const cancelButton = Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent === 'Cancel analysis',
      );
      if (!(cancelButton instanceof window.HTMLButtonElement)) {
        throw new Error('Missing analysis cancel button.');
      }
      await act(async () => {
        cancelButton.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(cancel).toHaveBeenCalledOnce();
      expect(container.textContent).toContain('Analysis cancelled. No file was loaded.');
      expect(container.querySelector('[role="alert"]')).toBeNull();

      await act(async () => {
        root.unmount();
      });
    } finally {
      for (const [key, descriptor] of originalGlobals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
      vi.doUnmock('@/components/Button');
      vi.doUnmock('@/components/Progress');
      vi.doUnmock('@/lib/core/download');
      vi.doUnmock('@/lib/core/dropzone');
      vi.doUnmock('@/lib/core/format');
      vi.doUnmock('@/lib/core/worker');
      vi.doUnmock('@/lib/tools/volume-fades/startVolumeFades');
      vi.doUnmock('@/lib/tools/volume-fades/PeakReadout');
      vi.doUnmock('@/lib/tools/volume-fades/volumeFades');
      vi.resetModules();
    }
  });
});
