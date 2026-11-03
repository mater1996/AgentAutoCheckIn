# Checkin activity plugin

This plugin supplies two shared skills: `run-activity` executes an authorized check-in using existing knowledge and published recipes; `explore-and-review` returns a draft review or explicitly scoped exploration report. Its local checkin MCP server runs the real project's TypeScript backend. No database, credentials or device configuration is bundled in this package.

Build both host packages from the project root with `node --import tsx scripts/build-plugins.ts`. Install the Claude package from `plugins/claude` as a local marketplace, or the Codex package from the project root's `.agents/plugins/marketplace.json`. The package directories can be moved without changing their manifests. They require an existing checkin-platform workspace with dependencies, migrated `data/checkin.db` and `runner/mcp/server.ts`.

Install locally from the project root:

```sh
claude plugin marketplace add ./plugins/claude
claude plugin install checkin@checkin-local
codex plugin marketplace add .
codex plugin add checkin@checkin-local
```

For a temporary Claude session, `claude --plugin-dir ./plugins/claude/checkin` also loads this package. These commands change that host's own settings; validation in this project uses isolated HOME/config directories instead of your normal configuration.

Before launching the host, explicitly export `CHECKIN_WORKSPACE` as the absolute path to that workspace. The installed plugin cache is never the workspace. `node` must be on PATH. The launcher executes the workspace's own `node_modules/.bin/tsx` without changing the process directory or printing startup text on stdout. Missing or unrelated workspaces fail on stderr.

Device execution is disabled by default. Only for a separately authorized device run, export `CHECKIN_ALLOW_DEVICE=1`; restarting the app additionally requires `CHECKIN_ALLOW_RESTART=1`. These flags enable backend capability; they do not replace the caller's explicit activity/task scope or the skill's business restrictions. Never enable them for an evidence-only review.

Invoke the installed run or review skill explicitly and provide a workspace-relative `configFile`, caller activity/task scope. Use the actual MCP tool schemas; no shell command should control the phone. Codex 0.166 discovers the skills as `checkin:run-activity` and `checkin:explore-and-review`; Claude uses the same plugin skill namespace. Review defaults to device-free draft output. Check-in runs cannot modify source, scripts, config or long-term knowledge.

The package has been installed/discovered without a model request on Claude Code 2.1.317 and Codex CLI 0.166.0 on macOS arm64. Model execution, vision/provider compatibility, phone actions, session resume against a real phone, desktop GUIs and other operating systems require separate verification. See `plugin-source/verification/REPORT.md` in the source workspace for evidence and exact limitations. These are local/private packages; public directory submission and license selection have not been requested.
