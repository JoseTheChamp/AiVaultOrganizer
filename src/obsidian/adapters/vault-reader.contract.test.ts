/**
 * Contract test: our Node adapter (own Markdown parser) must see a fixture vault exactly the way
 * the plugin's Obsidian adapter saw it inside real Obsidian. This is what lets evals run in Node
 * and still say something about behavior inside Obsidian.
 *
 * Each recording in fixtures/contract/<fixture>.obsidian-cache.json holds Obsidian's metadata cache
 * and the snapshot the plugin produced in Obsidian (see scripts/record-obsidian-cache.js). Two checks:
 *  1. Node adapter vs. the observed snapshot: the actual contract.
 *  2. Replaying the recorded cache through the adapter with the test shim vs. the observed snapshot:
 *     keeps the shim (used by other adapter tests) honest.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NodeFsVault } from '../../../eval/adapters/node-vault';
import { webCryptoHasher } from '../../core/hash';
import type { NoteRecord, VaultSnapshot } from '../../core/model/note';
import { createFakeApp, type RecordedVault } from '../testing/fake-app';
import { ObsidianVaultReader } from './obsidian-vault-reader';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const contractDir = path.join(repoRoot, 'fixtures', 'contract');
const recordings = readdirSync(contractDir).filter((name) => name.endsWith('.obsidian-cache.json'));

/** Files the recording process itself adds to the vault; never part of the fixture. */
const RECORDING_ARTIFACTS = new Set(['obsidian-cache.json', 'probe-result.json']);

/**
 * Documented, allowed differences: timestamps come from whichever machine recorded or checked out
 * the fixture, so they are excluded.
 */
function comparable(snapshot: VaultSnapshot) {
  const note = ({ mtime: _mtime, ctime: _ctime, ...rest }: NoteRecord) => rest;
  return {
    notes: snapshot.notes.map(note),
    folders: snapshot.folders,
    otherFiles: snapshot.otherFiles.filter((file) => !RECORDING_ARTIFACTS.has(file.path)),
  };
}

describe.each(recordings)('adapter contract: %s', (recordingName) => {
  const fixture = recordingName.replace('.obsidian-cache.json', '');
  const vaultRoot = path.join(repoRoot, 'fixtures', 'vaults', fixture);
  const recorded = JSON.parse(readFileSync(path.join(contractDir, recordingName), 'utf8')) as RecordedVault;
  const observed = recorded.observedSnapshot;
  const clock = { now: () => 0 };

  it.runIf(observed)(`Node adapter matches Obsidian ${recorded.obsidianVersion ?? ''}`, async () => {
    const node = await new NodeFsVault(vaultRoot, { clock }).snapshot();
    expect(comparable(node)).toEqual(comparable(observed as VaultSnapshot));
  });

  it.runIf(observed)('replaying the recorded cache through the shim matches Obsidian', async () => {
    const files = recorded.files.filter((file) => !RECORDING_ARTIFACTS.has(file.path));
    const contents = Object.fromEntries(
      files
        .filter((file) => file.path.endsWith('.md'))
        .map((file) => [file.path, readFileSync(path.join(vaultRoot, file.path), 'utf8')]),
    );
    const app = createFakeApp({ ...recorded, files }, contents);
    const replayed = await new ObsidianVaultReader(app, webCryptoHasher, clock).snapshot();
    expect(comparable(replayed)).toEqual(comparable(observed as VaultSnapshot));
  });
});
