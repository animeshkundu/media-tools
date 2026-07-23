import {
  Children,
  createElement,
  isValidElement,
  type ChangeEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { parseHTML } from 'linkedom';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TrimTimeFields, type TrimValidation } from '../entrypoints/app/TrimTimeFields';

type HostElementProps = {
  children?: ReactNode;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
};

function findElements(node: ReactNode, tagName: string): ReactElement<HostElementProps>[] {
  const matches: ReactElement<HostElementProps>[] = [];

  function visit(child: ReactNode) {
    if (!isValidElement(child)) {
      return;
    }

    const element = child as ReactElement<HostElementProps>;

    if (element.type === tagName) {
      matches.push(element);
    }

    Children.forEach(element.props.children, visit);
  }

  visit(node);
  return matches;
}

describe('TrimTimeFields', () => {
  it('renders controlled In/Out fields, disabled state, and alert copy', () => {
    const validation: TrimValidation = {
      field: 'start',
      message: 'In must be earlier than Out.',
    };

    const markup = renderToStaticMarkup(
      createElement(TrimTimeFields, {
        disabled: true,
        duration: 10,
        end: 8.75,
        start: 1.25,
        validation,
        onChange: () => undefined,
        onValidationChange: () => undefined,
      }),
    );

    expect(markup).toContain('Enter exact trim points in seconds.');
    expect(markup).toContain('value="1.25"');
    expect(markup).toContain('value="8.75"');
    expect(markup.match(/disabled=""/g)).toHaveLength(2);
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('In must be earlier than Out.');
  });

  it('updates valid values and rejects invalid ranges with an alert message', () => {
    const onChange = vi.fn();
    const onValidationChange = vi.fn();

    const element = TrimTimeFields({
      disabled: false,
      duration: 10,
      end: 8.75,
      start: 1.25,
      onChange,
      onValidationChange,
    });

    const inputs = findElements(element, 'input');
    expect(inputs).toHaveLength(2);

    inputs[0].props.onChange?.({ target: { value: '2.50' } } as ChangeEvent<HTMLInputElement>);
    expect(onValidationChange).toHaveBeenCalledWith(undefined);
    expect(onChange).toHaveBeenCalledWith(2.5, 8.75);

    onChange.mockClear();
    onValidationChange.mockClear();

    inputs[1].props.onChange?.({ target: { value: '1.00' } } as ChangeEvent<HTMLInputElement>);
    expect(onChange).not.toHaveBeenCalled();
    expect(onValidationChange).toHaveBeenCalledWith({
      field: 'end',
      message: 'Out must be later than In.',
    });
  });

  it('rejects invalid numbers, out-of-range values, and equal boundaries', () => {
    const onChange = vi.fn();
    const onValidationChange = vi.fn();

    const element = TrimTimeFields({
      disabled: false,
      duration: 10,
      end: 8.75,
      start: 1.25,
      onChange,
      onValidationChange,
    });

    const inputs = findElements(element, 'input');

    inputs[0].props.onChange?.({ target: { value: 'abc' } } as ChangeEvent<HTMLInputElement>);
    expect(onChange).not.toHaveBeenCalled();
    expect(onValidationChange).toHaveBeenCalledWith({
      field: 'start',
      message: 'In must be a valid number of seconds (for example 2.50).',
    });

    onValidationChange.mockClear();
    inputs[0].props.onChange?.({ target: { value: '-0.01' } } as ChangeEvent<HTMLInputElement>);
    expect(onValidationChange).toHaveBeenCalledWith({
      field: 'start',
      message: 'In must stay between 0.00 and 10.00 seconds.',
    });

    onValidationChange.mockClear();
    inputs[1].props.onChange?.({ target: { value: '10.50' } } as ChangeEvent<HTMLInputElement>);
    expect(onValidationChange).toHaveBeenCalledWith({
      field: 'end',
      message: 'Out must stay between 0.00 and 10.00 seconds.',
    });

    onValidationChange.mockClear();
    inputs[0].props.onChange?.({ target: { value: '8.75' } } as ChangeEvent<HTMLInputElement>);
    expect(onValidationChange).toHaveBeenCalledWith({
      field: 'start',
      message: 'In must be earlier than Out.',
    });
  });

  it('rejects prefix-tolerant and blank strings, and NaN props, before emitting a change', () => {
    const onChange = vi.fn();
    const onValidationChange = vi.fn();

    const element = TrimTimeFields({
      disabled: false,
      duration: 10,
      end: 8.75,
      start: 1.25,
      onChange,
      onValidationChange,
    });

    const inputs = findElements(element, 'input');

    // Number.parseFloat would accept "1abc" as 1; strict Number() must reject it.
    inputs[0].props.onChange?.({ target: { value: '1abc' } } as ChangeEvent<HTMLInputElement>);
    // A blank or whitespace-only value must not silently coerce to 0.
    inputs[0].props.onChange?.({ target: { value: '' } } as ChangeEvent<HTMLInputElement>);
    inputs[1].props.onChange?.({ target: { value: '   ' } } as ChangeEvent<HTMLInputElement>);

    expect(onChange).not.toHaveBeenCalled();
    expect(onValidationChange).toHaveBeenCalledTimes(3);
    expect(onValidationChange).toHaveBeenNthCalledWith(1, {
      field: 'start',
      message: 'In must be a valid number of seconds (for example 2.50).',
    });

    // NaN props must be treated as unreadable, never bypass range/order checks.
    const brokenElement = TrimTimeFields({
      disabled: false,
      duration: Number.NaN,
      end: 8.75,
      start: 1.25,
      onChange,
      onValidationChange,
    });
    const brokenInputs = findElements(brokenElement, 'input');
    onValidationChange.mockClear();
    brokenInputs[0].props.onChange?.({ target: { value: '2.50' } } as ChangeEvent<HTMLInputElement>);
    expect(onChange).not.toHaveBeenCalled();
    expect(onValidationChange).toHaveBeenCalledWith({
      field: 'start',
      message: 'In could not be read. Reload the audio and try again.',
    });
  });
});

describe('App trim validation', () => {
  const originalGlobals = {
    IS_REACT_ACT_ENVIRONMENT: (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT,
    Event: globalThis.Event,
    HTMLElement: globalThis.HTMLElement,
    HTMLInputElement: globalThis.HTMLInputElement,
    MouseEvent: globalThis.MouseEvent,
    SVGElement: globalThis.SVGElement,
    document: globalThis.document,
    navigator: globalThis.navigator,
    window: globalThis.window,
  };

  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('../entrypoints/app/App');
    vi.doUnmock('@/components/Button');
    vi.doUnmock('@/components/Progress');
    vi.doUnmock('@/lib/core/download');
    vi.doUnmock('@/lib/core/dropzone');
    vi.doUnmock('@/lib/core/format');
    vi.doUnmock('@/lib/core/worker');
    vi.doUnmock('@/lib/tools/audio-cutter/Waveform');
    vi.doUnmock('../entrypoints/app/TrimTimeFields');
    vi.doUnmock('../entrypoints/app/ChangeSpeedTool');
    vi.doUnmock('../entrypoints/app/ConvertTool');
    vi.doUnmock('../entrypoints/app/JoinMergeTool');
    vi.doUnmock('../entrypoints/app/VolumeFadesTool');

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

  it('clears an existing trim validation when the waveform changes the selection', async () => {
    vi.doMock('@/components/Button', () => ({
      Button: ({
        children,
        disabled,
        onClick,
      }: {
        children: ReactNode;
        disabled?: boolean;
        onClick?: () => void;
      }) => createElement('button', { type: 'button', disabled, onClick }, children),
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
      formatBytes: () => '4.2 MB',
      formatDuration: (seconds: number) => `${seconds.toFixed(1)}s`,
      outputName: () => 'trim-fixture-trimmed.wav',
    }));
    vi.doMock('@/lib/core/worker', () => ({
      startAnalyze: vi.fn(() => ({
        cancel: () => undefined,
        result: Promise.resolve({
          duration: 2,
          sampleRate: 44_100,
          waveform: new Float32Array([0.2, 0.4, 0.1, 0.3]),
        }),
      })),
      startFileEncode: vi.fn(),
    }));
    vi.doMock('@/lib/tools/audio-cutter/Waveform', () => ({
      Waveform: ({
        onChange,
      }: {
        onChange: (nextStart: number, nextEnd: number) => void;
      }) =>
        createElement(
          'button',
          { type: 'button', onClick: () => onChange(0.5, 1.5) },
          'Mock waveform',
        ),
    }));
    vi.doMock('../entrypoints/app/TrimTimeFields', () => ({
      TrimTimeFields: ({
        onValidationChange,
        validation,
      }: {
        onValidationChange: (validation?: TrimValidation) => void;
        validation?: TrimValidation;
      }) =>
        createElement(
          'div',
          null,
          createElement(
            'button',
            {
              type: 'button',
              onClick: () =>
                onValidationChange({
                  field: 'start',
                  message: 'In must be earlier than Out.',
                }),
            },
            'Set trim error',
          ),
          validation ? createElement('p', { role: 'alert' }, validation.message) : null,
        ),
    }));
    vi.doMock('../entrypoints/app/ChangeSpeedTool', () => ({ ChangeSpeedTool: () => null }));
    vi.doMock('../entrypoints/app/ConvertTool', () => ({ ConvertTool: () => null }));
    vi.doMock('../entrypoints/app/JoinMergeTool', () => ({ JoinMergeTool: () => null }));
    vi.doMock('../entrypoints/app/VolumeFadesTool', () => ({ VolumeFadesTool: () => null }));

    const { document, window } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>');
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

    const { act } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { default: App } = await import('../entrypoints/app/App');

    const container = document.getElementById('root');
    if (!container) {
      throw new Error('Missing root container');
    }

    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(App));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const fileInput = container.querySelector('input[type="file"]');
    if (!(fileInput instanceof window.HTMLInputElement)) {
      throw new Error('Missing file input');
    }

    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: [new File([new Uint8Array([1, 2, 3])], 'trim-fixture.wav', { type: 'audio/wav' })],
    });
    await act(async () => {
      fileInput.dispatchEvent(new window.Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      const setTrimErrorButton = Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent === 'Set trim error',
      );
      if (!(setTrimErrorButton instanceof window.HTMLButtonElement)) {
        throw new Error('Missing trim error trigger');
      }

      setTrimErrorButton.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('In must be earlier than Out.');

    const waveformButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Mock waveform',
    );
    if (!(waveformButton instanceof window.HTMLButtonElement)) {
      throw new Error('Missing waveform trigger');
    }

    await act(async () => {
      waveformButton.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector('[role="alert"]')).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });
});
