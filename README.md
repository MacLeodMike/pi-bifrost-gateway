# pi-bifrost-gateway

Pi extension for a [Bifrost](https://github.com/maximhq/bifrost) LLM gateway:
publishes the gateway's chain models as first-class pi models instead of a
hand-maintained `models.json` block.

Companion-package note: this is the chains-first flavor (VK routing-rule
discovery via the Bifrost management API). It fills the same provider slot
as [lxdlam/pi-bifrost-provider](https://github.com/lxdlam/pi-bifrost-provider)
(standalone-instance flavor) — install one OR the other, not both.

## Install

From npm:

```sh
pi install npm:pi-bifrost-gateway
```

Or from a local checkout:

```sh
pi install ~/repos/pi-bifrost-gateway
```

Then configure it (`~/.pi/agent/pi-bifrost-gateway.json`) — there is **no
built-in gateway URL**, so an unconfigured install registers zero models:

```json
{
  "baseUrl": "https://your-bifrost.example/v1",
  "publishChains": true,
  "publishUpstream": false
}
```

Auth: `/login bifrost` (stores the virtual key AND the gateway URL on the
credential in `auth.json` — sufficient on its own) or the `BIFROST_API_KEY`
env var.

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

`/login bifrost` prompts for **both** the gateway URL and the virtual key and
stores them together on the credential in `auth.json` (URL in the
credential's `BIFROST_URL` env slot) — after login no config file is needed.
Alternatively set `baseUrl` via config/`BIFROST_BASE_URL` env and `/login`
with the URL left blank to keep that ambient resolution.

URL precedence: login-stored credential URL → config-file `baseUrl` →
`BIFROST_BASE_URL` env. Key: stored credential → `BIFROST_API_KEY` env.
A stored credential under the legacy `gateway` provider id is migrated to
`bifrost` on load; re-running `/login bifrost` upgrades an old key-only
credential to carry its URL.

## Configuration

`~/.pi/agent/pi-bifrost-gateway.json` (all keys optional). Defaults are
CONSERVATIVE — `publishChains` false, chat completions everywhere:

```json
{
  "publishChains": true,
  "publishUpstream": true,
  "nativeProtocols": { "responses": true, "messages": true }
}
```

- `publishChains` (default **false**): emit the `bifrost/<chain>` models
  from the VK's routing rules. Requires a gateway with chains-first
  routing rules for the credential's VK; a stock gateway without chains
  fails discovery loud, which is why the default is off.
- `publishUpstream: false` hides the direct-selectable upstream catalog
  (`hyper/glm-5.3-flash`, `pareto/glm-5.3-flash`, …) with real per-member
  pricing. `publishMembers` is accepted as a legacy alias.
- `baseUrl` (optional) gateway `/v1` URL; then env `BIFROST_BASE_URL`. There
  is NO built-in default URL: with neither set (and no URL stored by
  `/login bifrost`), the plugin registers zero models.
- `managementApiKey` (optional) bearer for the management plane
  (`/api/governance/virtual-keys`, `/api/routing/rules`). Defaults to the
  inference credential (the VK) — correct for dashboard-auth-disabled
  deployments that accept the VK on `/api/*`. Set it when the management
  plane expects a different credential than inference. The VK-value match
  (VK self-identification) always uses the INFERENCE credential, never
  this key.
- `nativeProtocols` (optional; both toggles default **false**) selects the
  client wire per model family:
  - `responses: true` — models matching the built-in [OI]-native family
    heuristic (`gpt-*` except `gpt-oss*`, `o<n>`, `codex*`) publish as
    `openai-responses`. Requires a gateway serving `POST /v1/responses`.
  - `messages: true` — models matching the built-in Anthropic family
    heuristic (`claude-*` in the NAME) publish as `anthropic-messages`,
    pointed at the gateway's `/anthropic` integration route. Requires a
    gateway with the Anthropic integration prefix registered.
  - `responsesModels` / `messagesModels` (optional arrays of exact bare
    model names, e.g. `["gpt-6-luna"]`): when set, the list REPLACES the
    built-in heuristic for that surface — list membership is the only path
    to the native wire. Name matching is case-insensitive, last path
    segment (the serving prefix never decides).
  - Both off (default): every model publishes chat completions — the only
    wire every Bifrost serves; the gateway translates at the boundary.

## Cost

Chain models carry **zero** cost by design: pi recomputes cost from catalog
rates and cannot know which member actually served a chain request. Bifrost
`/api/logs` (cost + cost_breakdown per request) remains the system of record.
Member models (when published) carry real `$/Mtok` rates from `/v1/models`.

## Commands

`/bifrost` — auth, baseUrl, config, and loaded-model status.
