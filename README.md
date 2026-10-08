# pi-bifrost-gateway

Pi extension for a [Bifrost](https://github.com/maximhq/bifrost) LLM gateway:
publishes the gateway's chain models as first-class pi models instead of a
hand-maintained `models.json` block.

Companion-package note: this is the chains-first flavor (VK routing-rule
discovery via the Bifrost management API). It fills the same provider slot
as [lxdlam/pi-bifrost-provider](https://github.com/lxdlam/pi-bifrost-provider)
(standalone-instance flavor) — install one OR the other, not both.

## How it works

`fetchModels` (runs on startup, `/model`, `/reload`, `/login`) does, live:

1. `GET /v1/models` (your VK Bearer) — member catalog with per-member pricing
   and context windows.
2. `GET /api/governance/virtual-keys` — matches your stored credential value
   to discover which virtual key you are (the rule filter's `scope_id`).
3. `GET /api/routing/rules?scope=virtual_key&scope_id=<vk>` — the VK's chain
   rules; CEL `model == "x"` pairs give chain names, targets + `fallbacks[]`
   give member ids.

From that it emits one pi model per chain (`bifrost/<chain>`, e.g.
`bifrost/glm-5.3-flash`), with `contextWindow` = min member window.

## Auth

Stored credential in `auth.json` for provider `bifrost`, or `BIFROST_API_KEY`
env. `/login bifrost` prompts for the key. A stored credential under the
legacy `gateway` provider id is migrated to `bifrost` on load.

## Configuration

`~/.pi/agent/pi-bifrost-gateway.json` (all keys optional; both publish flags default
to `true`):

```json
{ "publishChains": true, "publishUpstream": true }
```

- `publishChains: false` hides the `bifrost/<chain>` models.
- `publishUpstream: false` hides the direct-selectable upstream catalog
  (`hyper/glm-5.3-flash`, `pareto/glm-5.3-flash`, …) with real per-member
  pricing. `publishMembers` is accepted as a legacy alias.
- `baseUrl` (optional) gateway `/v1` URL; when absent, env `BIFROST_BASE_URL`
  is used. There is NO built-in default URL: with neither set, the plugin
  registers no models at all. Set one of the two to your own Bifrost
  instance.

## Cost

Chain models carry **zero** cost by design: pi recomputes cost from catalog
rates and cannot know which member actually served a chain request. Bifrost
`/api/logs` (cost + cost_breakdown per request) remains the system of record.
Member models (when published) carry real `$/Mtok` rates from `/v1/models`.

## Commands

`/bifrost` — auth, baseUrl, config, and loaded-model status.
