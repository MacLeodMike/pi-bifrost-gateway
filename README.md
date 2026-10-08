# pi-bifrost

Pi extension for a [Bifrost](https://github.com/maximhq/bifrost) LLM gateway:
publishes the gateway's chain models as first-class pi models instead of a
hand-maintained `models.json` block.

## How it works

`fetchModels` (runs on startup, `/model`, `/reload`, `/login`) does, live:

1. `GET /v1/models` (your VK Bearer) — member catalog with per-member pricing
   and context windows.
2. `GET /api/governance/virtual-keys` — matches your stored credential value
   to discover which virtual key you are (the rule filter's `scope_id`).
3. `GET /api/routing/rules?scope=virtual_key&scope_id=<vk>` — the VK's chain
   rules; CEL `model == "x"` pairs give chain names, targets + `fallbacks[]`
   give member ids.

From that it emits one pi model per chain (`gateway/<chain>`, e.g.
`gateway/glm-5.3-flash`), with `contextWindow` = min member window.

## Auth

Stored credential in `auth.json` for provider `gateway`, or `GATEWAY_API_KEY`
env. `/login gateway` prompts for the key.

## Configuration

`~/.pi/agent/pi-bifrost.json` (all keys optional; both publish flags default
to `true`):

```json
{ "publishChains": true, "publishUpstream": true }
```

- `publishChains: false` hides the `gateway/<chain>` models.
- `publishUpstream: false` hides the direct-selectable upstream catalog
  (`hyper/glm-5.3-flash`, `pareto/glm-5.3-flash`, …) with real per-member
  pricing. `publishMembers` is accepted as a legacy alias.
- `baseUrl` (optional) overrides the gateway URL; then env
  `BIFROST_BASE_URL`, then `GATEWAY_BASE_URL`; default is the deployed
  tailscale gateway URL.

## Cost

Chain models carry **zero** cost by design: pi recomputes cost from catalog
rates and cannot know which member actually served a chain request. Bifrost
`/api/logs` (cost + cost_breakdown per request) remains the system of record.
Member models (when published) carry real `$/Mtok` rates from `/v1/models`.

## Commands

`/bifrost-gateway` — auth, baseUrl, config, and loaded-model status.
