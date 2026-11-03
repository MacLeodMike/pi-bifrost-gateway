# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions respect
[SemVer](https://semver.org/).

## [0.3.3] - 2026-11-03

### Added

- **`warmChains`** config flag (default `false`). Chain models publish zero
  cost by design, which makes pi's cache-warming economics unavailable and the
  warmer a no-op for exactly the models this extension provides. With this on,
  a `cache_warming_decision` handler supplies the decision pi cannot compute:
  it warms a `bifrost/<chain>` while a run is streaming (pi's
  `continuationProbability` 1), and stays silent once the agent is idle
  (0.15) so refreshes never accumulate on a session nobody is driving. It
  never touches member models, never overrides a model from another provider,
  and steps aside whenever pi produced real economics (`missCost` non-zero).
  Off by default because refreshes are real, billable requests.

### Fixed

- **Per-provider settings now reach the request.** `gatewayAuth().resolve()`
  forwarded only `BIFROST_URL` and dropped every other key from the
  credential's env bag, so a per-provider override stored on the credential
  was silently ignored. pi-ai resolves provider-scoped settings through that
  bag (`getProviderEnvValue`), which is what makes `PI_CACHE_RETENTION` — the
  only per-provider retention control pi offers, since `cacheWarming` is
  global — actually take effect.
- Models now declare `promptCache` lifetimes (`short` 300s, `long` 3600s), on
  both chain and direct-selectable member models. pi's cache warmer only runs
  for a model that declares a lifetime for the active retention tier, so
  warming was silently inert for every bifrost model: a gap longer than the
  provider TTL turned the next request into a full-price cache write instead
  of a cheap refresh. Declaring the lifetimes makes models *eligible* to be
  kept warm; it does not send `ttl:"1h"` unless the caller asks for long
  retention (`PI_CACHE_RETENTION=long`).

### Verified

- Against a live Bifrost → InferHub `anthropic-messages` route: a
  `cache_control: {type:"ephemeral", ttl:"1h"}` breakpoint still read back as
  a cache hit at 45 minutes, while the default 5m entry never survived a
  6-minute gap. The `extended-cache-ttl-2025-04-11` beta header is not
  required.
- InferHub bills cache writes at the plain input rate for both tiers (no 2x
  long-write premium) and cache reads at 0.1x, so moving to the 1h tier costs
  nothing extra on this gateway.
- Cache-warming behaviour driven through pi's real `CacheWarmer`: chain models
  go from 0 to 1 warm request once the handler is enabled, and back to 0 when
  idle; priced members and anthropic-wire members are unchanged by the
  handler.

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
