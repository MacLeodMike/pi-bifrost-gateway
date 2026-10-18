# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions respect
[SemVer](https://semver.org/).

## [0.3.0] — 2026-10-18

### Changed

- **BREAKING** `publishChains` now defaults to `false`. A stock Bifrost
  gateway has no chains-first routing rules, and chains mode fails discovery
  loud when none exist — the conservative default registers only the
  upstream catalog. Installs that want chain models set `publishChains: true`
  explicitly.

### Added

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
