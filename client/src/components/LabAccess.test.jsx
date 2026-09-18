import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import RequireRole from './RequireRole';
import UserMenu from './UserMenu';
import useMe from '../hooks/useMe';

vi.mock('../hooks/useMe', async () => ({ ...await vi.importActual('../hooks/useMe'), default: vi.fn() }));
vi.mock('./Page', () => ({ default: ({ children }) => <main>{children}</main> }));
vi.mock('./StaffModal', () => ({ default: () => null }));

const identity = role => ({
  loading: false, isSignedIn: true, isTA: ['ta', 'admin'].includes(role), isAdmin: role === 'admin',
  me: { email: `${role}@newpaltz.edu`, netid: role, role },
});
beforeEach(() => { sessionStorage.setItem('ilcc.staffNudged', '1'); });
afterEach(() => { cleanup(); vi.resetAllMocks(); window.history.replaceState({}, '', '/'); });

it('uses the existing SSO login with the lab page as the return destination', () => {
  window.history.replaceState({}, '', '/labs');
  vi.mocked(useMe).mockReturnValue({ loading: false, isSignedIn: false });
  render(<RequireRole role="ta"><div>Lab editor</div></RequireRole>);
  expect(screen.getByRole('link', { name: 'Sign in with SUNY SSO' })).toHaveAttribute('href', '/login?returnTo=%2Flabs');
  expect(screen.queryByText('Lab editor')).not.toBeInTheDocument();
});

it.each(['ta', 'admin'])('shows the lab editor and account link for %s accounts', async role => {
  vi.mocked(useMe).mockReturnValue(identity(role));
  render(<MemoryRouter><RequireRole role="ta"><div>Lab editor</div></RequireRole><UserMenu /></MemoryRouter>);
  expect(screen.getByText('Lab editor')).toBeInTheDocument();
  await userEvent.click(screen.getByTitle(`${role}@newpaltz.edu`));
  expect(screen.getByRole('menuitem', { name: 'Lab Configuration' })).toHaveAttribute('href', '/labs');
});

it('keeps the configuration editor and account link hidden for students', async () => {
  vi.mocked(useMe).mockReturnValue(identity('student'));
  render(<MemoryRouter><RequireRole role="ta"><div>Lab editor</div></RequireRole><UserMenu /></MemoryRouter>);
  expect(screen.queryByText('Lab editor')).not.toBeInTheDocument();
  await userEvent.click(screen.getByTitle('student@newpaltz.edu'));
  expect(screen.queryByRole('menuitem', { name: 'Lab Configuration' })).not.toBeInTheDocument();
});
