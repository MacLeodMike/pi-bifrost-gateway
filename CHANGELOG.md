# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions respect
[SemVer](https://semver.org/).

## [0.3.2] - 2026-10-23

### Fixed

- MAX_OUTPUT map: renamed `minimax-m3.1-flash-preview` → `minimax-m3.1-flash`
  (combo renamed upstream, no longer preview); added `kimi-k3.1-pro` at
  32K (its cb/cbcn combo members report 32K directly; kc/kcai rails
  report 131072 but are not combo members).

## [0.3.1] — 2026-10-20

### Fixed

- Chain and member models now publish real max-output limits via a curated
  per-name map (16 workhorse chains). Bifrost's `/v1/models` wire never
  carries `max_output_limit` (verified 0/86 rows), so every model fell back
  to the generic 8192 and long generations hard-stopped there — a plausible
  contributor to truncated responses on pi traffic. Values sourced from
  inferhub.dev/pricing (2026-10-20); unmapped names keep the 8192 fallback.

## [0.3.0] — 2026-10-18

### Changed

- **BREAKING** `publishChains` now defaults to `false`. Chains mode fails
  discovery loud when no usable routing rules exist — the conservative
  default publishes only the upstream catalog and needs no governance.
  Installs that want chain models set `publishChains: true` explicitly.

### Added

- Member-catalog-only mode: with `publishChains: false`, discovery uses the
  inference plane alone (`GET /v1/models`) — no management-API access — so
  the full upstream catalogue publishes against a stock gateway with
  governance disabled entirely. Previously discovery required chains and
  management access unconditionally.
- `nativeProtocols` config (`responses` / `messages` toggles, both default
  `false`): publish matching models as `openai-responses` /
  `anthropic-messages` so claude-family and gpt-family chains talk their
  native wire end to end through a gateway that serves the Responses API
  and the Anthropic integration route. Optional `responsesModels` /
  `messagesModels` exact-name lists replace the built-in family heuristic
  for that surface.
- `managementApiKey` config: separate bearer for the management plane
  (`/api/governance/*`, `/api/routing/rules`), for deployments whose
  management API does not accept the inference virtual key. Defaults to the
  VK; virtual-key self-identification always matches the inference
  credential regardless.

### Fixed

- History scrub: no personal paths anywhere in the repository tree or git
  history.

## [0.2.0] — never published

Prepared (files whitelist, repository/engines metadata, install docs) but
superseded by 0.3.0 before release; the version number was never occupied on
the registry.

## [0.1.0] — 2026-10-08 (unpublished same day)

Initial release: chain models from VK routing rules, upstream member
catalog, `/login bifrost`, `/bifrost` status command, one-time
`gateway` → `bifrost` credential migration. Unpublished shortly after
release because its default gateway URL baked in a private address; replaced
by config/env-only URL resolution before any later publish.
