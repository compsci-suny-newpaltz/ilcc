import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { get, post, put, ADMIN, STUDENT, as } from './helpers.js';

describe('lab configuration API', () => {
  let id;
  const draft = { title: 'Lab 6', instructions: 'Translate both programs.\nKeep their comments.', files: ['c0607.c', 'c0605.c'], isPublished: false };

  it('keeps the server file allowlist in sync with the actual textbook sources', () => {
    const files = fs.readdirSync(path.join(__dirname, '../../client/src/data/textbook')).filter(name => name.endsWith('.c')).sort();
    expect(require('../src/textbookSources.json')).toEqual(files);
  });

  it('requires sign-in for labs and admin role for management', async () => {
    expect((await get('/api/labs')).status).toBe(401);
    expect((await get('/api/labs/admin', STUDENT)).status).toBe(403);
    expect((await post('/api/labs/admin', draft, STUDENT)).status).toBe(403);
    // A TA has access to grading but cannot manage labs.
    await post('/api/staff', { email: 'labta@newpaltz.edu', role: 'ta' }, ADMIN);
    expect((await post('/api/labs/admin', draft, as('labta@newpaltz.edu'))).status).toBe(403);
  });

  it('saves a draft and its order without exposing it in student reads', async () => {
    const created = await post('/api/labs/admin', draft, ADMIN);
    expect(created.status).toBe(201);
    id = created.body.id;
    expect(created.body).toMatchObject(draft);
    expect((await get('/api/labs/admin', ADMIN)).body).toContainEqual(created.body);
    expect((await get('/api/labs', STUDENT)).body).toEqual([]);
    expect((await get(`/api/labs/${id}`, STUDENT)).status).toBe(404);
    expect((await put(`/api/labs/admin/${id}`, draft, STUDENT)).status).toBe(403);
  });

  it('validates filenames, unique selections, names, instructions and publishing status', async () => {
    for (const body of [
      { ...draft, title: ' ' }, { ...draft, files: [] },
      { ...draft, files: ['../../secret.c'] }, { ...draft, files: ['c9999.c'] },
      { ...draft, files: ['c0605.c', 'c0605.c'] },
      { ...draft, isPublished: 'false' }, { ...draft, instructions: {} },
    ]) expect((await post('/api/labs/admin', body, ADMIN)).status).toBe(400);
    expect((await put(`/api/labs/admin/${id}`, { ...draft, files: ['missing.c'] }, ADMIN)).status).toBe(400);
    expect((await put('/api/labs/admin/999999', draft, ADMIN)).status).toBe(404);
  });

  it('publishes, updates and unpublishes a lab with ordered sources', async () => {
    const published = { ...draft, isPublished: true };
    expect((await put(`/api/labs/admin/${id}`, published, ADMIN)).body).toMatchObject(published);
    expect((await get(`/api/labs/${id}`, STUDENT)).body).toMatchObject(published);
    expect((await get('/api/labs', STUDENT)).body).toHaveLength(1);
    const changed = { ...published, files: ['c0501.c', 'c0605.c'], instructions: 'Updated instructions' };
    await put(`/api/labs/admin/${id}`, changed, ADMIN);
    expect((await get(`/api/labs/${id}`, STUDENT)).body).toMatchObject(changed);
    await put(`/api/labs/admin/${id}`, { ...changed, isPublished: false }, ADMIN);
    expect((await get(`/api/labs/${id}`, STUDENT)).status).toBe(404);
    expect((await get('/api/labs', STUDENT)).body).toEqual([]);
  });
});
