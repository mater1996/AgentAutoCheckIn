# Offline host verification

Tested local/private packages on macOS 27 arm64 with Codex CLI 0.166.0 and Claude Code 2.1.317. CLI binaries were downloaded from official npm tarballs under `verification/tools`; HOME, CODEX_HOME and CLAUDE_CONFIG_DIR were isolated under this directory. No user credential files, normal host config, other Hermes profiles, cron, model calls or device calls were used. The offline workspace has a separate empty SQLite database and both device enable flags set to `0`.

Rebuild with `node --import tsx scripts/build-plugins.ts`. Run packaging/client contracts with `node --import tsx --test tests/plugin-packaging*.test.ts` (7 packaging/Skill/client tests pass; with `tests/plugin-service.test.ts`, 10 tests pass; output saved in `tests.log`). Build tests use a temporary `--output-root`, preventing concurrent tests from deleting installed artifacts. Re-run host installation/discovery with `python3 plugin-source/verification/verify-hosts.py` once the two downloaded binaries exist. This intentionally changes only the isolated host configuration, not normal user settings. Full results are saved to `host-validation.json`.

| Host/path | Actual verification | Limit |
| --- | --- | --- |
| Claude Code 2.1.317 | `plugin validate --strict --json`, local marketplace add/install, installed/enabled readback, `plugin details` (two skills/one MCP), `mcp list` reports Connected | No prompt/model turn, phone actions, provider or GUI validation |
| Codex CLI 0.166.0 | Local marketplace add/install, installed/enabled readback; app-server initialize, `skills/list` returns `checkin:explore-and-review` and `checkin:run-activity`; `plugin/read` lists one MCP; `mcpServerStatus/list` connects and returns 12 tools with toolsError=null | No `turn/start`, exec model run, real-device resume or desktop validation |
| MCP SDK stdio client | Both generated launchers connect to real server; schemas match 12 tools; list_recipes and stored review work; task review requires exact attempt; begin/observe without device authorization are rejected | Screenshot/model visual comprehension not exercised by packaging client |

Claude strict manifest validation succeeds with no manifest errors/warnings. The validator also returns separate public-directory findings for missing license and icon. A license decision and public directory submission are outside this local/private install task; strict validation is not a claim of public-directory acceptance.

The launcher requires an absolute real checkin-platform workspace, validates package identity and required files, canonicalizes the workspace (macOS `/var` aliases otherwise break direct-entry URL comparison), and executes the workspace tsx/server without `cd` or stdout diagnostics. Missing, relative, nonexistent, cache and unrelated project paths are rejected. Packaged artifacts contain no database or verification tools. Code/skills/references remain shared; only the two host manifest/MCP declarations differ.

Codex compatibility detail: fixed 0.166.0 legacy `.mcp.json` normalizer does not expand `${CODEX_PLUGIN_ROOT}` or arbitrary `${CHECKIN_WORKSPACE}` strings. The generated config uses `command: ./bin/start-mcp`, `cwd: .` (resolved to installed plugin root), and `env_vars` to pass CHECKIN_WORKSPACE plus explicit opt-in flags. This exact launch was verified by actual MCP inventory. Claude uses its native `${CLAUDE_PLUGIN_ROOT}` command and `${CHECKIN_WORKSPACE}` env interpolation; `mcp list` verified expansion and connection.

Backend contract differences are documented in `../references/mcp-contract.md`: initial recipes do not accept client revision fields; task selection/execution is through find-next-task/execute-task; needs_decision supplies its own original image and resumes through submit_decision. A pending recipe owns the device. Navigation-only return-list recovery retains the original failed task runtime; completed tasks have no recovery runtime. A reconnect does not automatically resume an in-flight operation. Skill instructions stop/report when the supported backend cannot safely proceed.

Unverified: model adherence to skills, visual understanding, third-party Responses/image compatibility, task completion/rewards, real phone/session crash recovery, GUI hosts, Windows/Linux (POSIX launcher), portable Agent Plugins v1, other CLI versions, public marketplace publication. Actual phone capture is intentionally excluded; server output contract remains text + original image, with no nonempty structuredContent.

Sources directly inspected:

- OpenAI fixed tag `rust-v0.166.0`: `codex-rs/core-plugins/src/manifest.rs` (name/version/description/skills/mcpServers), `marketplace.rs` (local source/policies), `codex-rs/codex-mcp/src/plugin_config.rs` (legacy transport/cwd/env normalization), and fixed app-server TypeScript schema for SkillsListParams, PluginReadParams, ListMcpServerStatusParams. Copies under `upstream/`.
- https://raw.githubusercontent.com/openai/codex/rust-v0.166.0/codex-rs/core-plugins/src/manifest.rs
- https://raw.githubusercontent.com/openai/codex/rust-v0.166.0/codex-rs/core-plugins/src/marketplace.rs
- https://raw.githubusercontent.com/openai/codex/rust-v0.166.0/codex-rs/codex-mcp/src/plugin_config.rs
- https://registry.npmjs.org/@openai/codex/0.166.0 and platform alias `0.166.0-darwin-arm64`; metadata under upstream.
- https://registry.npmjs.org/@anthropic-ai/claude-code/2.1.317 and matching darwin-arm64 binary; its actual strict validator, plugin inventory and MCP health command verify Claude's package fields. Claude docs URL https://code.claude.com/docs/en/plugins-reference returned HTTP 403; no claim that its page text was read. The downloaded README is not a substitute for those docs.

Only the two application skills ship; Codex's own built-in system skills observed during discovery are unrelated host content.
