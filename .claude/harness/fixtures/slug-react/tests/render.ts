// Minimal rendering helpers on react-dom (no testing library needed for one component).
import { act } from 'react';
import type { Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export function freshContainer(id = 'host'): HTMLElement {
  document.body.innerHTML = '';
  const el = document.createElement('div');
  el.id = id;
  document.body.append(el);
  return el;
}

export async function rendered(make: () => Root): Promise<Root> {
  let root: Root | undefined;
  await act(async () => { root = make(); });
  return root as Root;
}

// React listens for the native "input" event; the value must be set through the prototype setter.
export async function type(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

export const text = (selector: string): string | null => document.querySelector(selector)?.textContent ?? null;
