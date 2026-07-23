import {
  Children,
  createElement,
  isValidElement,
  type ChangeEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TrimTimeFields, type TrimValidation } from '../entrypoints/app/TrimTimeFields';

type HostElementProps = {
  children?: ReactNode;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
};

function inputsFor(node: ReactNode): ReactElement<HostElementProps>[] {
  const inputs: ReactElement<HostElementProps>[] = [];
  function visit(child: ReactNode): void {
    if (!isValidElement(child)) return;
    const element = child as ReactElement<HostElementProps>;
    if (element.type === 'input') inputs.push(element);
    Children.forEach(element.props.children, visit);
  }
  visit(node);
  return inputs;
}

function change(input: ReactElement<HostElementProps>, value: string): void {
  input.props.onChange?.({ target: { value } } as ChangeEvent<HTMLInputElement>);
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
    expect(markup).toContain(validation.message);
  });

  it('updates valid values and rejects reversed ranges', () => {
    const onChange = vi.fn();
    const onValidationChange = vi.fn();
    const inputs = inputsFor(
      TrimTimeFields({
        disabled: false,
        duration: 10,
        end: 8.75,
        start: 1.25,
        onChange,
        onValidationChange,
      }),
    );

    change(inputs[0]!, '2.50');
    expect(onValidationChange).toHaveBeenCalledWith(undefined);
    expect(onChange).toHaveBeenCalledWith(2.5, 8.75);

    onChange.mockClear();
    onValidationChange.mockClear();
    change(inputs[1]!, '1.00');
    expect(onChange).not.toHaveBeenCalled();
    expect(onValidationChange).toHaveBeenCalledWith({
      field: 'end',
      message: 'Out must be later than In.',
    });
  });

  it('rejects invalid numbers, out-of-range values, and equal boundaries', () => {
    const onChange = vi.fn();
    const onValidationChange = vi.fn();
    const inputs = inputsFor(
      TrimTimeFields({
        disabled: false,
        duration: 10,
        end: 8.75,
        start: 1.25,
        onChange,
        onValidationChange,
      }),
    );

    change(inputs[0]!, 'abc');
    expect(onValidationChange).toHaveBeenLastCalledWith({
      field: 'start',
      message: 'In must be a valid number of seconds (for example 2.50).',
    });
    change(inputs[0]!, '-0.01');
    expect(onValidationChange).toHaveBeenLastCalledWith({
      field: 'start',
      message: 'In must stay between 0.00 and 10.00 seconds.',
    });
    change(inputs[1]!, '10.50');
    expect(onValidationChange).toHaveBeenLastCalledWith({
      field: 'end',
      message: 'Out must stay between 0.00 and 10.00 seconds.',
    });
    change(inputs[0]!, '8.75');
    expect(onValidationChange).toHaveBeenLastCalledWith({
      field: 'start',
      message: 'In must be earlier than Out.',
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('rejects prefix-tolerant and blank strings, and NaN props', () => {
    const onChange = vi.fn();
    const onValidationChange = vi.fn();
    const inputs = inputsFor(
      TrimTimeFields({
        disabled: false,
        duration: 10,
        end: 8.75,
        start: 1.25,
        onChange,
        onValidationChange,
      }),
    );

    change(inputs[0]!, '1abc');
    change(inputs[0]!, '');
    change(inputs[1]!, '   ');
    expect(onChange).not.toHaveBeenCalled();
    expect(onValidationChange).toHaveBeenCalledTimes(3);

    const brokenInputs = inputsFor(
      TrimTimeFields({
        disabled: false,
        duration: Number.NaN,
        end: 8.75,
        start: 1.25,
        onChange,
        onValidationChange,
      }),
    );
    onValidationChange.mockClear();
    change(brokenInputs[0]!, '2.50');
    expect(onValidationChange).toHaveBeenCalledWith({
      field: 'start',
      message: 'In could not be read. Reload the audio and try again.',
    });
  });
});

describe('App workspace routing', () => {
  it('mounts one unified studio instead of the retired transform tabs', async () => {
    vi.resetModules();
    vi.doMock('../lib/tools/multitrack/MultitrackTool', () => ({
      MultitrackTool: () =>
        createElement('section', { 'data-testid': 'unified-studio' }, 'Import once timeline'),
    }));

    try {
      const { default: App } = await import('../entrypoints/app/App');
      const markup = renderToStaticMarkup(createElement(App));
      expect(markup).toContain('Audio Studio');
      expect(markup).toContain('Import once timeline');
      expect(markup).not.toContain('role="tablist"');
      expect(markup).not.toContain('Cut audio');
    } finally {
      vi.doUnmock('../lib/tools/multitrack/MultitrackTool');
      vi.resetModules();
    }
  });
});
