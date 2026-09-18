import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Labs from './index';
import { api } from '../../lib/api';

vi.mock('../../lib/api', () => ({ api: vi.fn() }));
vi.mock('../../components/Page', () => ({ default: ({ children, actions }) => <main>{actions}{children}</main> }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('creates an ordered published lab from files in multiple chapters', async () => {
  const user = userEvent.setup();
  vi.mocked(api).mockResolvedValueOnce([]).mockImplementationOnce(async (_path, { body }) => ({ id: 1, ...body }));
  render(<Labs />);
  await user.click(await screen.findByRole('button', { name: 'New lab' }));
  await user.type(screen.getByLabelText('Lab name'), 'Pointers lab');
  await user.type(screen.getByLabelText('Instructions (optional)'), 'Translate these files.');
  await user.click(screen.getByLabelText('c0401.c'));
  await user.selectOptions(screen.getByLabelText('Choose textbook files by chapter'), '6');
  await user.click(screen.getByLabelText('c0605.c'));
  await user.click(screen.getByRole('button', { name: 'Move c0605.c up' }));
  await user.click(screen.getByLabelText('Published — available to students'));
  await user.click(screen.getByRole('button', { name: 'Save lab' }));
  await waitFor(() => expect(screen.queryByRole('form', { name: 'Lab configuration' })).not.toBeInTheDocument());
  expect(api).toHaveBeenLastCalledWith('/grader/labs/admin', {
    method: 'POST', body: { title: 'Pointers lab', instructions: 'Translate these files.', files: ['c0605.c', 'c0401.c'], isPublished: true },
  });
  expect(screen.getByText('Published')).toBeInTheDocument();
});

it('edits a published lab and saves it as a draft', async () => {
  const user = userEvent.setup();
  const lab = { id: 2, title: 'Lab 6', instructions: '', files: ['c0605.c'], isPublished: true };
  vi.mocked(api).mockResolvedValueOnce([lab]).mockImplementationOnce(async (_path, { body }) => ({ id: 2, ...body }));
  render(<Labs />);
  await user.click(await screen.findByRole('button', { name: 'Edit' }));
  await user.click(screen.getByLabelText('Published — available to students'));
  await user.click(screen.getByRole('button', { name: 'Save lab' }));
  await screen.findByText('Draft');
  expect(api).toHaveBeenLastCalledWith('/grader/labs/admin/2', { method: 'PUT', body: { title: 'Lab 6', instructions: '', files: ['c0605.c'], isPublished: false } });
});

it('offers the existing SSO login on a 401 and reloads labs when retried', async () => {
  const user = userEvent.setup();
  window.history.replaceState({}, '', '/labs');
  vi.mocked(api).mockRejectedValueOnce(Object.assign(new Error('sso_required'), { status: 401 }))
    .mockResolvedValueOnce([]);
  render(<Labs />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Sign in again');
  expect(screen.getByRole('link', { name: 'Sign in with SUNY SSO' })).toHaveAttribute('href', '/login?returnTo=%2Flabs');
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByText('No labs yet');
  expect(api).toHaveBeenNthCalledWith(1, '/grader/labs/admin');
  expect(api).toHaveBeenNthCalledWith(2, '/grader/labs/admin');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  window.history.replaceState({}, '', '/');
});
