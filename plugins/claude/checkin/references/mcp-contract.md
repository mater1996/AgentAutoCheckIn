# Checkin MCP client contract

This reference describes the initial TypeScript server API. The host's `tools/list` schema is authoritative if a later version differs. Do not invent revision, runId or checkpoint parameters that are absent from the schema. Metadata is JSON in text `content`; original screenshots are adjacent image blocks. Never require or emit non-empty `structuredContent` with an image on Codex 0.166.

## Starting and reading

- `get_activity_context({configFile})` accepts a workspace-relative existing configuration path. Scope, knowledge, batch and policy come from that config, not invented IDs.
- `list_recipes({})` lists published workflows. The initial implementation exposes `find-next-task` and `execute-task`, with source `runner/staged` immutable during execution; it does not accept a client revision field. Preserve returned source/revision evidence when present.
- `begin_execution({configFile, live: true, hostSessionId?, mode: "run" | "explore"})` starts one execution per MCP service. Device access also requires host opt-in. `hostSessionId` is the current host session/thread identity when available. Reusing a batch preserves consumed attempts. A new begin is not an in-flight operation resume; after a reconnect review retained state and stop on unsafe unknown attempts.
- `get_run_state({})` reads the current execution and any pending operation. Before begin it returns no-active-execution. Historical evidence is read with `review_execution`.

## Continuing one activity

Call `execute_recipe({recipeId: "find-next-task"})` for initial activity/list navigation and task selection. Then use `execute_recipe({recipeId: "execute-task"})` for the selected permitted task. Each returns completion, running state or a `needs_decision` request. Continue within the same logical agent session.

When `status` is `needs_decision`, inspect the returned original screenshot, `prompt`, `context` and `decisionId`. Reply using `submit_decision({decisionId, value})`, where `value` answers exactly that prompt and its required object shape. This resumes the pending recipe; it is not followed by a redundant `act`. A recipe waiting for a decision owns the device: do not call `observe`, `act`, another recipe or restart recovery until it settles. Use its supplied image. A stale decisionId must not be reused for a new request. For `running`, use `get_run_state` to inspect completion/pending state; do not replay the recipe.

Outside a recipe or selection, `observe({})` returns a current `frame.id` and original image. Ordinary navigation uses `act({frameId, action})`; supported action fields/types come from the schema. The current backend rejects free taps: a declared purpose alone cannot prove that the target is ordinary navigation rather than task entry or a sensitive control. Use existing published recipes for their verified clicks; free `act` supports back/swipe/wait with current owner and action validation. Unsupported navigation or new task-entry exploration must be reported as a missing capability, not bypassed through shell or adb. The act result may say `next: observe`; obtain a new frame before another action. Task entry always goes through `execute-task` so the attempt is reserved in the ledger.

`recover({strategy, reason})` permits only an existing backend recovery. `restart-app` requires the separate host flag and does not reset attempts. A failed return retains the original task runtime for navigation-only `return-list` recovery. A confirmed return updates that same attempt; it does not retry task entry or award a new gain. Persistence failure blocks further input. Honor any rejection, stop/report and do not simulate recovery by blindly tapping. An unknown input/authentication barrier can block all input. Use state/evidence and report unresolved operations; do not force a retry.

`finish_activity({reason, noRemaining?})` persists stop/completion and returns the report/state. Set `noRemaining: true` only when the server has verified full task search coverage. A pending recipe can be stopped using `cancel_execution({reason})`; wait for it to settle, then call finish. Cancellation preserves attempted/unknown actions and prevents new inputs. Preserve any unresolved identity and report unfinished state to the caller. A rejected finish is not completion.

## Evidence-only review

`review_execution({executionId, scope: "activity" | "task", attemptId?})` reads stored evidence without a device; task review requires the exact attemptId within that execution. `get_activity_context`/`list_recipes` can supplement the review. Do not begin an execution or capture a new screenshot in review mode. Findings and improvements remain a draft returned to the caller.
