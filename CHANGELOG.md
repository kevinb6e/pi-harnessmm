# Changelog

## [Unreleased]

OMP (oh-my-pi) support through its legacy-pi compat layer, feature-detected in `extensions/harnessmm.ts`:
the authoring instruction becomes a returned `systemPrompt` override (OMP has no prompt sections), admitted
substitutes run through the same `runTerminal` path directly (OMP exposes no nested dispatch for extension
tools), and the selector falls back to an `runEphemeralTurn` side turn with the same abstain-on-anything-else
contract (OMP's `modelRegistry` has no `complete()`; the side turn uses a 256-token budget with
`minimizeEffort`, since a reasoning model burns a one-token budget on thinking and returns no text).
`package.json` declares `omp.extensions` alongside `pi.extensions`, and the tool is registered with
`loadMode: "essential"` so OMP keeps it top-level instead of mounting it under `xd://`. `src/bank.ts`
`schemaMatches` now lowers TypeBox builders through `toJsonSchema()` (OMP's typebox shim returns an omptype
callable rather than plain JSON Schema; pi's plain schemas pass through untouched). Regenerated
`package-lock.json` (it referenced a stale path from another machine and `npm install` failed).

## [0.1.0] - 2026-11-02

Initial port of HarnessMM (arXiv 2610.32813) to pi.

- `terminal` tool returning native `{return_code, stdout, stderr}` receipts with separated streams.
- `<CHISEL_PLAN>` Executable Decision Graph contract, byte-identical authoring instruction for policy versions 1-11.
- Guarded decision reuse: `localGuard` and `receiptGuard`, deterministic admission with the 1024-token net-saving
  threshold, priors-based admission for versions 8 and 10 that fails closed without frozen TRAIN medians.
- Certified callback substitution: `certified-native-substitution/v1` certificates binding arguments, receipt and
  the bypassed reasoning callback.
- Bank removal from the slow context, preserving reasoning and native actions.
- `/harnessmm` ledger command.
