# 0001. Hexagonal core with Obsidian adapters

- Status: Accepted
- Date: 2026-10-05

## Context

The plugin's value lies in logic that must be trustworthy and measurable: snapshotting a vault, analysis,
classification, planning, validation and the apply/undo transaction. That logic must be:

- **unit-testable in Node** without launching Obsidian,
- **runnable by the eval CLI** over synthetic fixture vaults on disk, so AI quality can be measured in CI,
- **safe**: the code that writes to the vault must be small, central and auditable.

Obsidian's API (`App`, `Vault`, `MetadataCache`, `FileManager`, `requestUrl`) is only available inside the app,
and the `obsidian` npm package ships types only, so importing it from shared code makes that code untestable.

## Decision

Use a hexagonal (ports and adapters) architecture:

- `src/core/**` is pure TypeScript. It defines **ports** in `src/core/ports.ts` (`VaultReader`, `VaultWriter`,
  `HttpPort`, `SecretsPort`, `StoragePort`, `Clock`, `Hasher`, `Logger`) and depends only on them.
- `src/obsidian/**` contains the plugin entry point, settings, commands, views and the **adapters** that
  implement the ports with Obsidian APIs (`metadataCache`, `fileManager.renameFile`, `vault.process`,
  `requestUrl`, `SecretStorage`).
- `eval/**` contains Node adapters (filesystem vault, `fetch`-based HTTP, cassette replay) used by the eval CLI.
- Core classes receive ports through constructor injection. No singletons, no globals.
- An ESLint rule forbids `obsidian`, Node built-ins, adapters and UI imports under `src/core`.

## Consequences

- The same planner, classifier and executor run inside Obsidian, in unit tests and in the eval harness.
- Snapshot differences between the Obsidian adapter (metadata cache) and the Node adapter (own Markdown
  parser) are a real risk; a contract test runs both over the same fixtures and documents allowed differences.
- Slightly more boilerplate: every new capability needs a port and two adapters.
- The single write path (invariant 2) is easy to audit: only `src/core/apply` calls `VaultWriter`, and only the
  Obsidian apply adapter implements it against the real vault.

## Alternatives considered

- **Call the Obsidian API directly everywhere.** Fastest to start, but untestable outside the app and no evals.
- **Mock the `obsidian` module in tests.** Works for unit tests, but the eval CLI would still need a fake Obsidian,
  and the mocks would drift from real behavior. Ports make the boundary explicit instead.
