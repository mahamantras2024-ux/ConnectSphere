// Sticky header AC1/AC2: observe the browser layout boundary without mocking routing or preference logic.
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import useStickyHeader from '../../frontend/src/hooks/useStickyHeader';
import App from '../../frontend/src/App';
import { AuthProvider } from '../../frontend/src/context/AuthContext';
import { api } from '../../frontend/src/api/client';

vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn() } }));
let headerHeight;
const clearance = () => document.documentElement.style.getPropertyValue('--app-header-height');
/** Model the header mounting and active role changes; jsdom's absent layout engine is the replaced boundary. */
function Header({ role }) {
  const ref = useStickyHeader(role);
  return <nav ref={ref} aria-label="Test header">Header</nav>;
}
beforeEach(() => {
  headerHeight = 96;
  vi.stubGlobal('ResizeObserver', undefined);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ height: headerHeight }));
});
afterEach(() => {
  cleanup();
  document.documentElement.style.removeProperty('--app-header-height');
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// AC1: signed-out navigation must not reserve sticky space or install a live resize listener.
it('Sticky header AC1 - signed-out headers leave public page scrolling alone', () => {
  render(<Header />);
  fireEvent(window, new Event('resize'));
  expect(clearance()).toBe('');
});

// AC2: legacy browsers use resize events, and changing roles recalculates the wrapped header immediately.
it('Sticky header AC2 - fallback resizing and role changes update clearance and sign-out removes it', () => {
  const view = render(<Header role="event_coordinator" />);
  expect(clearance()).toBe('96px');
  headerHeight = 164;
  fireEvent(window, new Event('resize'));
  expect(clearance()).toBe('164px');
  headerHeight = 212;
  view.rerender(<Header role="technical_support" />);
  expect(clearance()).toBe('212px');
  view.rerender(<Header />);
  expect(clearance()).toBe('');
  headerHeight = 300;
  fireEvent(window, new Event('resize'));
  expect(clearance()).toBe('');
});

// AC2: ResizeObserver catches portal insertion, text wrapping and other content changes without a window resize.
it('Sticky header AC2 - observed size changes update clearance and late callbacks cannot overwrite cleanup', () => {
  document.documentElement.style.setProperty('--app-header-height', '40px');
  let changed;
  const observe = vi.fn(), disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback) { changed = callback; }
    observe = observe;
    disconnect = disconnect;
  });
  const view = render(<Header role="technical_support" />);
  expect(observe).toHaveBeenCalledWith(screen.getByRole('navigation'));
  expect(clearance()).toBe('96px');
  // Just below, at and above a whole pixel: never reserve less space than the rendered header.
  for (const [measured, expected] of [[229.75, '230px'], [230, '230px'], [230.25, '231px']]) {
    headerHeight = measured;
    act(() => changed());
    expect(clearance()).toBe(expected);
  }
  view.unmount();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(clearance()).toBe('40px');
  act(() => changed());
  expect(clearance()).toBe('40px');
});

// AC2: starting a new route scrolls the document, avoiding initial headers hidden beneath a later-wrapping navbar.
it('Sticky header AC2 - navigation resets the document scroll position before showing the new page', async () => {
  const scrollTo = vi.fn();
  Object.defineProperty(document.documentElement, 'scrollTo', { configurable: true, value: scrollTo });
  localStorage.setItem('cs_token', 'header-session');
  api.get.mockImplementation(async path => {
    if (path === '/auth/me') return { user: { id: 8, role: 'event_coordinator', full_name: 'Casey Staff' } };
    if (path === '/notifications') return { notifications: [], unreadCount: 0 };
    if (path === '/venues') return [];
    return { events: [], changeRequests: [], staff: [], venues: [] };
  });
  try {
    render(<MemoryRouter initialEntries={['/coordinator/dashboard']}><AuthProvider><App /></AuthProvider></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Event Coordinator Dashboard' });
    const reads = scrollTo.mock.calls.length;
    fireEvent.click(screen.getByRole('link', { name: 'Find venues' }));
    await waitFor(() => expect(scrollTo.mock.calls.length).toBeGreaterThan(reads));
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, left: 0 });
  } finally {
    delete document.documentElement.scrollTo;
  }
});
