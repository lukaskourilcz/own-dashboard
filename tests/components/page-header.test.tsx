// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { PageHeader, ShellTitleProvider } from '@/components/ui/page-header';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Explicit page title ownership', () => {
  it('keeps a standalone title and retains descriptions/actions beneath a shell-owned title', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    try {
      act(() => root.render(<PageHeader title="Tasks" description="Your active work" />));
      expect(host.querySelectorAll('h1')).toHaveLength(1);
      act(() => root.render(<ShellTitleProvider><PageHeader title="Tasks" description="Your active work" action={<button>Add</button>} /></ShellTitleProvider>));
      expect(host.querySelectorAll('h1')).toHaveLength(0);
      expect(host.textContent).toBe('Your active workAdd');
      act(() => root.render(<ShellTitleProvider><PageHeader title="Tasks" /></ShellTitleProvider>));
      expect(host.innerHTML).toBe('');
    } finally { act(() => root.unmount()); }
  });
});
