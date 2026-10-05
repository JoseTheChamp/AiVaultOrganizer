/*
 * Records what Obsidian's metadata cache knows about the open vault, for the adapter contract test.
 *
 * 1. `npm run dev:vault -- <fixture>` copies fixtures/vaults/<fixture> into dev-vault/ with the plugin
 *    installed; open dev-vault/ in Obsidian and keep the plugin enabled.
 * 2. Wait for indexing to finish, open the developer console (Ctrl+Shift+I / Cmd+Opt+I).
 * 3. Set OBSIDIAN_VERSION below (Settings → General), paste the whole file into the console and
 *    press Enter. It writes `obsidian-cache.json` into the vault root.
 * 4. Move that file to fixtures/contract/<fixture>.obsidian-cache.json and run `npm test`.
 *
 * Runs in Obsidian's console only; it is not part of the plugin bundle.
 */
/* global app -- Obsidian exposes its App instance as a global in the developer console. */
const OBSIDIAN_VERSION = '1.13.7';

(async () => {
  const { vault, metadataCache } = app;
  const files = vault
    .getFiles()
    .filter((file) => file.path !== 'obsidian-cache.json')
    .map((file) => ({
      path: file.path,
      stat: { ctime: file.stat.ctime, mtime: file.stat.mtime, size: file.stat.size },
      cache: metadataCache.getFileCache(file) ?? null,
    }))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
  const folders = vault
    .getAllLoadedFiles()
    .filter((item) => Array.isArray(item.children) && item.path !== '/')
    .map((folder) => folder.path)
    .sort();
  // What the plugin's Obsidian adapter produced with the real APIs (e.g. getAllTags). The contract
  // test compares the Node adapter against this, so it does not rely on our test shim's guesses.
  const reader = app.plugins.plugins['ai-vault-organizer']?.services?.reader;
  const observedSnapshot = reader ? await reader.snapshot() : null;
  const recording = {
    obsidianVersion: OBSIDIAN_VERSION,
    recordedAt: new Date().toISOString(),
    files,
    folders,
    resolvedLinks: metadataCache.resolvedLinks,
    unresolvedLinks: metadataCache.unresolvedLinks,
    observedSnapshot,
  };
  await vault.adapter.write('obsidian-cache.json', `${JSON.stringify(recording, null, 2)}\n`);
  console.debug(`Recorded ${files.length} files from Obsidian ${OBSIDIAN_VERSION} into obsidian-cache.json`);
})();
