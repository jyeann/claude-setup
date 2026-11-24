import { createRoot, type Root } from 'react-dom/client';
import { Slug } from './Slug';

export function mount(container: HTMLElement | null): Root {
  if (container === null) throw new Error('missing #root element');
  const root = createRoot(container);
  root.render(<Slug />);
  return root;
}

const rootElement = document.getElementById('root');
if (rootElement !== null) mount(rootElement);
