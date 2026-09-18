import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Labs from './index';
import { api } from '../../lib/api';

vi.mock('../../lib/api', () => ({ api: vi.fn() }));
vi.mock('../../components/Page', () => ({ default: ({ children }) => <main>{children}</main> }));
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
  expect(api).toHaveBeenLastCalledWith('/labs/admin', {
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
  expect(api).toHaveBeenLastCalledWith('/labs/admin/2', { method: 'PUT', body: { title: 'Lab 6', instructions: '', files: ['c0605.c'], isPublished: false } });
});
