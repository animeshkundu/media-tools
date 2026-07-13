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
});
