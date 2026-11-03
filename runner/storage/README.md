# SQLite storage contract

Business authority is `data/checkin.db`. `db/client.ts` and `db/schema.ts` are source compatibility exports only. Importing `runner/storage/index.ts` does not open a database; importing `client.ts` does.

- `resolveDatabasePath(root = process.cwd())`: canonical path. Refuses a legacy-only project, or an unmarked canonical target beside a legacy database. Existing explicit `CHECKIN_DB_PATH`/`CHECKIN_DB` test overrides remain supported for the current working directory; the retired legacy path is rejected.
- `openStorage(root, {databasePath?})`: `Storage` with `sqlite`, `transaction(fn)`, `close()`. `transaction` is synchronous and uses an immediate SQLite transaction. Do not return a Promise from its callback.
- `getDocument(root,key)` / `putDocument(root,key,value,provenance?)`, and equivalent instance methods. Keys are root-relative paths, such as `data/stage-records/index.json`. JSONL records use `#line=N` appended to the source path. `getDocumentRecord` exposes original source path/hash, current content hash and revision. `expectedRevision` supports compare-and-swap. `listDocuments(prefix)` returns keys.
- `isStorageMigrated(root)`: checks `storage_meta.key = legacy_storage_v1` in the canonical database. Only a fully validated migration publishes that marker. Runtime adapters may retain legacy fixture behavior before this marker; after the marker, missing SQLite documents must not fall back to JSON.
- `putRoundState(root,key,value)` / `getRoundState(root,key,batchId?,scope?)`: root-relative state file keys. Require batch/scope; do not discard existing reservations, change reservation identity, or reopen consumed attempts. Scope comparison ignores object property order.

`putDocument` and state APIs never write legacy JSON. Source files remain archival inputs. `legacy_document`, `document_source`, `round_state`, `legacy_reservation`, `document_evidence`, `storage_meta` are storage-owned tables. The service owns the separate `plugin_execution`, `plugin_attempt`, `plugin_action` tables.

Run offline validation from the project with:

```
node --import tsx --test tests/plugin-storage*.test.ts
node --import tsx scripts/migrate-storage.ts --root PROJECT --target .backups/storage-validation/checkin.db --manifest REPORT.json
```

For canonical publication, omit `--target`. Stop scheduler/legacy SQLite writers before cutover. The CLI obtains the shared device lock, then an exclusive migration lock; the lower-level `migrateStorage` API is intended for isolated fixtures or callers that already hold the shared device lock. A live, malformed, or foreign-host migration lock fails closed. A terminated local lock owner can be recovered on retry.

Migration uses SQLite's consistent backup API, preserves primary keys and autoincrement sequences, scans structured JSON/JSONL/reservation sources under `data` and `evidence`, and excludes `data/backups`, `data/exports`, `data/device-locks`. Source scanning retains metadata, parsing each file again during import. Historical absolute references outside the project are preserved as inert JSON strings and recorded in `externalEvidence`; relative traversal and symlinks are rejected. No outside evidence is read. Raw evidence remains on disk.

The temporary database is checked against every original table's row count, numeric sums and ordered row hash, plus `quick_check` and `foreign_key_check`. Sources are checked again before publication. The closed database is published with an exclusive hard link so an existing destination cannot be replaced. Reentry verifies source hashes and original SQLite contents, preserves runtime SQLite document updates, and returns `alreadyMigrated: true`. The complete manifest is stored in SQLite; optional `--manifest` exports it with exclusive creation.
