import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ImportFiles from './ImportFiles';
import { commentSource } from '../../lib/commentSource';
import { textbookSources } from '../../data/textbookSources';
import { api } from '../../lib/api';

vi.mock('../../lib/api', () => ({ api: vi.fn() }));

afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('imports selected textbook files through the converter with the current settings', async () => {
  const user = userEvent.setup();
  const imported = [];
  const onClose = vi.fn();
  const onImportFiles = vi.fn(async (files, options) => {
    for (const file of files) imported.push(commentSource(file.name, await file.text(), options));
  });
  render(<ImportFiles tabSize={6} onImportFiles={onImportFiles} onClose={onClose} />);
  await user.selectOptions(screen.getByLabelText('Import'), 'textbook');
  await user.selectOptions(screen.getByLabelText('Chapter'), '6');
  expect(screen.getByRole('button', { name: 'Open in editor' })).toBeDisabled();
  await user.click(screen.getByLabelText('c0605.c'));
  await user.click(screen.getByLabelText('c0607.c'));
  await user.click(screen.getByRole('button', { name: 'Open in editor' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(onImportFiles.mock.calls[0][1]).toEqual({ indent: 32, tabSize: 6 });
  expect(imported.map(file => file.name)).toEqual(['c0605.a', 'c0607.a']);
  expect(imported[1].content).toBe(commentSource('c0607.c', textbookSources.find(file => file.name === 'c0607.c').content, { indent: 32, tabSize: 6 }).content);
});

it('clears textbook selection when switching chapters and keeps uploaded import available', async () => {
  const user = userEvent.setup();
  render(<ImportFiles tabSize={4} onImportFiles={vi.fn()} onClose={vi.fn()} />);
  expect(screen.getByLabelText('Files')).toHaveAttribute('type', 'file');
  await user.selectOptions(screen.getByLabelText('Import'), 'textbook');
  await user.click(screen.getByLabelText('c0401.c'));
  await user.selectOptions(screen.getByLabelText('Chapter'), '5');
  expect(screen.getByRole('button', { name: 'Open in editor' })).toBeDisabled();
  expect(screen.queryByLabelText('c0401.c')).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText('Import'), 'source');
  expect(screen.getByLabelText('Files')).toHaveAttribute('type', 'file');
});

it('shows published lab instructions and imports the latest files in the configured order', async () => {
  const user = userEvent.setup();
  const lab = { id: 3, title: 'Lab 6', instructions: 'Translate both programs.', files: ['c0605.c', 'c0607.c'] };
  vi.mocked(api).mockResolvedValueOnce([lab]).mockResolvedValueOnce({ ...lab, files: ['c0607.c', 'c0605.c'] });
  const onImportFiles = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  render(<ImportFiles tabSize={4} onImportFiles={onImportFiles} onClose={onClose} />);
  await user.selectOptions(screen.getByLabelText('Import'), 'lab');
  await screen.findByLabelText('Lab');
  await user.selectOptions(screen.getByLabelText('Lab'), '3');
  expect(screen.getByText(lab.instructions)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Open lab files' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(api).toHaveBeenLastCalledWith('/grader/labs/3');
  const [files, options] = onImportFiles.mock.calls[0];
  expect(files.map(file => file.name)).toEqual(['c0607.c', 'c0605.c']);
  expect(await files[0].text()).toBe(textbookSources.find(file => file.name === 'c0607.c').content);
  expect(options).toEqual({ indent: 32, tabSize: 4 });
});

it('keeps the import panel open if a lab has been unpublished', async () => {
  const user = userEvent.setup();
  vi.mocked(api).mockResolvedValueOnce([{ id: 3, title: 'Lab 6', files: ['c0605.c'] }])
    .mockRejectedValueOnce(new Error('Lab not found.'));
  const onImportFiles = vi.fn();
  const onClose = vi.fn();
  render(<ImportFiles tabSize={4} onImportFiles={onImportFiles} onClose={onClose} />);
  await user.selectOptions(screen.getByLabelText('Import'), 'lab');
  await screen.findByLabelText('Lab');
  await user.selectOptions(screen.getByLabelText('Lab'), '3');
  await user.click(screen.getByRole('button', { name: 'Open lab files' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Lab not found.');
  expect(onImportFiles).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});
