import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { localDataArchive } from '../local-data-env.mjs';

test('uses environment, checkout dotenv, then primary dotenv for a worktree', async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'data-env-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init');
  git(
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '--allow-empty',
    '-m',
    'fixture',
  );
  const worktree = join(root, 'worktree');
  git('worktree', 'add', '--detach', worktree);
  assert.equal(localDataArchive(worktree, {}), undefined);
  await writeFile(join(root, '.env'), 'ON_DATA_ZIP="pack with spaces.zip"\nUNRELATED_SECRET=hidden\n');
  assert.equal(localDataArchive(worktree, {}), join(root, 'pack with spaces.zip'));
  await writeFile(join(worktree, '.env'), 'ON_DATA_ZIP=local.zip\n');
  assert.equal(localDataArchive(worktree, {}), join(worktree, 'local.zip'));
  assert.equal(localDataArchive(worktree, { ON_DATA_ZIP: 'explicit.zip' }), join(worktree, 'explicit.zip'));
  assert.equal(localDataArchive(worktree, { ON_DATA_ZIP: '' }), undefined);
});
