# pi-bifrost-gateway

pi provider extension exposing a [Bifrost](https://github.com/maximhq/bifrost)
LLM gateway as selectable chat models. The gateway is the product: chains are
first-class `bifrost/<chain>` model ids routed server-side by the gateway's
VK-scoped routing rules; upstream members are also selectable as
`provider/model` ids for direct pinning. All failover, key selection, and
routing happens in Bifrost — this extension never routes anything itself.

## Architecture

Five modules, acyclic, one-directional:

```
src/bifrost.ts   constants only — PROVIDER_ID="bifrost", PROVIDER_DISPLAY_NAME="Bifrost Gateway",
                 DEFAULT_BASE_URL (deployed tailscale gateway /v1), INFERENCE_PATH_MODELS="models",
                 MANAGEMENT_PATH_VIRTUAL_KEYS="/api/governance/virtual-keys",
                 MANAGEMENT_PATH_ROUTING_RULES="/api/routing/rules",
                 AUTH_ENV_KEYS=["BIFROST_API_KEY"]
src/config.ts    ← loadBifrostConfig (~/.pi/agent/pi-bifrost-gateway.json; LEGACY_CONFIG_FILE_NAME=pi-bifrost.json fallback), resolveBaseUrl
                   (config baseUrl → BIFROST_BASE_URL → DEFAULT_BASE_URL),
                   publishChains/publishUpstream flags + legacy publishMembers alias
src/http.ts      ← transport only — fetchJson (Bearer GET + typebox validation), HttpError{status,code,message}
src/catalog.ts   ← wireDiscovery (catalog + routing rules), PURE mappers for tests:
                   chainNameFromCel (managed-prefix stripping), wireRulesToChains,
                   wireCatalogToModels, buildChainModels, buildMemberModels, buildAllModels
src/index.ts     ← default factory: createProvider + fetchModels, /bifrost status command,
                   one-time auth.json migration (gateway → bifrost)
```

No custom `streamSimple`. Everything streams through pi-ai's
`openAICompletionsApi()` (imported from `@earendil-works/pi-ai/compat` —
pi's extension loader does not virtualize lazy API subpaths). pi-ai owns
message conversion, tool handling, usage accounting, cancellation, retries.
Adding a custom stream is a design-level decision, never a drive-by fix.

## Wire contract (live-pinned 2026-10-08, verify before trusting)

- Auth: `Authorization: Bearer <VK value>` on the inference surface
  (`/v1/*`). `/v1/models` is 401 unauthenticated.
- Management API is **unauthenticated on this deployment** (iidm: dashboard
  auth disabled by design); if that posture ever changes, these calls
  fail loud with 401/403 — do not silently retry or fabricate data.
- `GET /v1/models` → `{data:[...]}`; items carry `id` as `provider/model`,
  `context_length`, `pricing` as per-token STRINGS
  (`prompt`/`completion`/`input_cache_read`), `owned_by`. Chain names do
  NOT appear here — that is why refresh fetches routing rules separately.
- `GET /api/governance/virtual-keys` → `{virtual_keys:[...]}`; the `value`
  field is the RESOLVED VK secret for every VK (including other VKs') —
  the plugin matches its own credential against it to self-identify
  `scope_id`, and must never log or echo that payload.
- `GET /api/routing/rules?scope=virtual_key&scope_id=<vk>` →
  `{count,limit,offset,rules:[...]}` — PAGINATED (limit default 10). vk-pi
  currently has exactly 10 rules; the plugin reads one page. If the rule
  count ever exceeds the page size, add offset pagination BEFORE trusting
  discovery completeness.
- Routing rule CEL shape: `model == "<bare>" || model == "gateway/<bare>"
  || model == "bifrost/<bare>"` (2 or 3 arms). Routing targets carry
  `provider` and `model` as SEPARATE fields (`model` may be bare) — the
  member id is the join `provider + "/" + model`, never `model` alone.
- Cost: streaming inference responses carry `usage.cost: {}` (empty);
  non-streaming carries `usage.cost.total_cost`. Either way pi recomputes
  cost from catalog rates — see invariant 2. Bifrost `/api/logs`
  `cost`/`cost_breakdown` is the system of record.

## Invariants (breaking any of these is a reverted commit)

1. **Slug consistency**: provider id `bifrost` everywhere; chain model ids
   `bifrost/<chain>`; env `BIFROST_API_KEY`; no `GATEWAY_API_KEY` env, no
   `gateway` provider ids in shipped config or docs. The string `gateway`
   survives ONLY in (a) MANAGED_PREFIXES legacy stripping, (b) prose
   meaning "the gateway".
2. **Chain cost honesty**: chain models carry `cost = {0,0,0,0}` BY
   DESIGN. pi recomputes message cost from the model entry's rates, and no
   single rate describes a chain whose serving member varies with
   failover. A fabricated rate is a lie; the real number lives in Bifrost
   `/api/logs` + Grafana. Upstream models (publishUpstream) DO carry real
   $/Mtok rates converted from wire per-token strings (`perMtok`).
3. **Cost/wire strings are never Number()ed blindly**: `perMtok` returns
   undefined for non-finite/non-positive values; missing pricing → cost 0,
   never NaN.
4. **Context-window floor**: chain `contextWindow` = min over members
   PRESENT in the catalog; absent members are skipped rather than guessed.
   Empty result → `CONTEXT_WINDOW_FALLBACK = 128_000`;
   `MAX_TOKENS_FALLBACK = 8_192` likewise. pi-ai requires both as numbers.
5. **Chain names come from CEL canonicalization, never from rule names**:
   every `model ==` arm must strip to ONE bare name (after removing any
   managed prefix). Zero, two, or disagreeing arms → not a chain rule.
   Disabled rules and multi-target rules are skipped, never published.
6. **reasoning:true + full thinkingLevelMap on every published model** —
   chains are transport-only; the gateway owns effort routing. A false
   negative hides thinking levels (the worse error).
7. **No key leakage**: the VK value appears ONLY in the Authorization
   header and pi's credential store. Never log, print, or persist it. The
   virtual-keys discovery response contains OTHER VKs' secrets —
   `wireScopeId` consumes it and discards everything but the matched id.
8. **Unconfigured = zero models, no network**: `discoverModels` returns
   `[]` when auth resolves no key or baseUrl is unset. pi-ai hands stored
   AND env-resolved keys as `context.credential` — do not add a second
   key-resolution path.
9. **No plugin-owned persistence**: refresh is always live (re-pull on
   every fetchModels). pi-ai's models-store handles offline restore; a
   plugin-owned snapshot would serve stale routing.
10. **Gateway coupling is part of this repo's contract**: requests send
    the full model id (`bifrost/<chain>`), so the gateway's routing-rule
    CELs (flux-app-llm `gateway/helmrelease.yaml`) MUST carry a
    `model == "bifrost/<chain>"` arm. Changing the slug here without the
    helmrelease (or vice versa) breaks every chain request with
    "could not auto resolve a provider".

## Commands

```
npx vitest run        # full suite (40 tests, <2s)
npx tsc --noEmit      # typecheck
npm pack --dry-run    # inspect package contents before publishing
```

pi packs the extension from `package.json` `pi.extensions:
["./src/index.ts"]`. Local install: `pi install ~/repos/pi-bifrost-gateway`
(settings.json entry `../../repos/pi-bifrost-gateway`). node_modules is a SYMLINK
to a compatible tree in this repo's checkout — `npm install` re-creates it
as a real dir when publishing.

**Dev-loop gotcha**: pi-ai network-refreshes extension providers ONLY from
the interactive TUI (post-init `refreshModelCatalogs`). `--list-models`,
`--mode json`, and `--print` NEVER network-refresh — they restore from
`~/.pi/agent/models-store.json`. To force a live refresh headless:

```sh
node -e "(async () => {
  const PI='/home/linuxbrew/.linuxbrew/Cellar/pi-coding-agent/<ver>/libexec/lib/node_modules/@earendil-works/pi-coding-agent';
  const { createRequire } = await import('node:module');
  const req = createRequire(PI + '/dist/index.js');
  const { createJiti } = req('jiti');
  const jiti = createJiti(PI + '/dist/index.js', { interopDefault: true });
  const { ModelRuntime } = await jiti.import(PI + '/dist/core/model-runtime.js');
  const runtime = await ModelRuntime.create({ refreshOnCreate: false });
  const registered = [];
  const { default: factory } = await jiti.import('$HOME/repos/pi-bifrost-gateway/src/index.ts');
  factory({ registerProvider: (p) => registered.push(p), registerCommand: () => {},
            modelRegistry: { getProviderAuthStatus: () => ({ configured: false }) } });
  for (const p of registered) runtime.registerNativeProvider(p);
  await new Promise(r => setTimeout(r, 400));
  await runtime.refresh({ allowNetwork: true, force: true });
  console.log(runtime.models.getModels().filter(m => m.provider === 'bifrost').map(m => m.id));
  process.exit(0);
})()"
```

A failed refresh persists EMPTY models to models-store.json — delete the
`bifrost` key there before re-testing, or every offline run shows nothing.

## Environment gotchas (learned the hard way)

- **Pi packages declare host modules as peerDependencies, never
  dependencies**: `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`,
  `typebox` go in `peerDependencies` with `"*"` ranges; keep `dependencies`
  empty. Mirror the same modules in `devDependencies` (real version pins)
  for the repo's own tests/typecheck.
- **TypeScript 6.0.3**: tsconfig MUST carry `types: ["node"]` — TS 6
  dropped automatic `@types/*` inclusion.
- **typebox 1.3.36**: compiled validators are `Validator<TProperties,
  TSchema>` — pass the validator, not the schema, to `fetchJson`. Error
  detail lives on `instancePath`. Extra payload keys pass through by
  default; do NOT add `additionalProperties: false` to wire schemas.
- **createProvider's fetchModels RETURNS the list** (pi persists it);
  `context.publish({update})` belongs to the lower-level `refreshModels`
  contract — don't mix the two.
- **Management API paths are absolute (`/api/...`) while `/v1/models` is
  RELATIVE to the /v1 base**. `managementBase()` strips a trailing
  `/v1`/`/v1/` from the inference base URL. Joining the bare path to the
  base without re-adding `/` produced `.../v1models` (SPA HTML 404) —
  pinned by test.
- **Git signing**: fresh clones inherit `gpg.format=ssh` globally but need
  `git config user.signingkey ~/.ssh/michaelmacleod.id_ecdsa.pub` locally,
  and `--format=%G?` shows `N` unless
  `gpg.ssh.allowedSignersFile=/home/michaelmacleod/.ssh/allowed_signers`
  is passed (or configured).
- **History rewrite pattern** (pi-inferhub precedent): interactive rebase
  `--exec` loops hang without a TTY. Use
  `FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch --env-filter '...' \
  --commit-filter 'git commit-tree -S "$@"' --tag-name-filter cat -- --all`
  — deterministic, editor-free, preserves trees/dates, re-signs fresh.
  Verify signatures with `%G?` + the allowedSignersFile, and prune
  `refs/original` + `git gc --prune=now` after.
- **Live pinning of wire shapes is allowed and encouraged** when a shape
  is undocumented: run a listing GET, pin the parsed envelope in a typebox
  validator, leave a dated comment. Drift surfaces as
  `code: "schema_mismatch"` — fail-loud by design.

## Testing conventions

- Typebox schemas live at module scope (`Compile(Type.Object({...}))`).
- Tabs, ESM with `.js` import specifiers, single-responsibility modules.
- Tests verify real behavior through public seams: the pure mappers in
  `catalog.ts` (CEL decoding, model building), `config.ts` flag handling,
  `migrateLegacyCredential`, and the real `createProvider` refresh path
  with injected `fetchImpl`. No seams into internals.
- Deleting a contract-asserting test line, or "fixing" a failing test by
  editing the test to fit the code rather than the contract, is not
  allowed without naming the contract being violated.
