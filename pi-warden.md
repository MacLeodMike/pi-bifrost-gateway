# No hardcoded secrets
Source code must not contain passwords, API keys, tokens, or connection URLs with credentials.
Read them from the environment, a function parameter, or the config module.
Violations: a string literal that looks like `Bearer sk-…`, `vk-…`, `Bearer eyJ…`, a URL of the
form `https://user:pass@…`, or a variable named `apiKey`/`token`/`password` whose value is a
string literal rather than an env lookup (`process.env.BIFROST_API_KEY`, `DEFAULT_BASE_URL`,
`envApiKeyAuth(...)`).

# Comments explain why, not what
A comment states a reason, a constraint, a workaround, or a non-obvious invariant. A comment
that restates what the next line plainly does is a violation.
Violation pattern: a `//`-line directly above a statement whose code already says the same thing,
e.g. `// parse the body` above `JSON.parse(body)`, `// call fetchJson` above `fetchJson(...)`,
`// loop over the rules` above a `for (const rule of rules)`.

# Errors are not swallowed
A `catch` block must handle the error, report it, or re-raise it. An empty catch block, or
one whose body is only a comment, is a violation.
This repo deliberately permits catch-with-comment ONLY for the two documented best-effort
cases: `src/index.ts` `migrateStoredCredential` (`// unreadable or absent auth.json — nothing
to migrate`) and `src/http.ts` `parseErrorBody` (`// non-JSON error body — fall through`).
Those two must keep their exact explanatory comment; any OTHER empty or comment-only catch in
src/ is a violation, and any new silent catch added elsewhere is a violation.

# No partial implementations
Implement features fully. A comment that says "for now", "simplified", or "later", or a
stub body, is a violation. If a part genuinely cannot be done, say so in your reply instead
of stubbing it.
Violation patterns: comment phrases `for now`, `simplified`, `later`, `TODO`, `FIXME`,
`placeholder`, `temporary` in src/**; an exported function whose body throws
`new Error("not implemented")` or contains only `throw` / `return [];` where logic belongs.

# Do not run destructive commands that erase uncommitted work
`git reset --hard`, `git checkout -- .`, `git clean -fd`, and similar commands that discard
untracked or uncommitted changes are forbidden. These destroy work that has no backup. If a
clean tree is needed, create a worktree instead or ask the user.
Violation patterns (in bash/tool invocations): `git reset --hard`, `git checkout -- .`,
`git checkout .`, `git checkout --', `git clean -df`, `git clean -fd`, `git clean -xdf`,
`git restore .`; any of these in a heredoc or shell command string.

# No explicit `any`
TypeScript: `: any`, `<any>`, `as any`, and `any[]` are forbidden.
Violation patterns: `: any`, `<any>`, `as any`, `any[]`.
paths: src/**/*.ts, src/**/*.tsx

# Exported functions declare their return type
Exported functions declare their return type.
Violation pattern: `export function name(...)` or `export async function name(...)` with no
`:` return annotation before the body's `{`.
paths: src/**/*.ts

# Verify after every change
Any change to src/** or test/** must be verified with the project's own commands before
claiming done: `npx vitest run` and `npx tsc --noEmit`.
Violation pattern: claiming completion/ship/fix after writing files with no test or typecheck
run recorded.

# Fix tests by fixing code, not by editing the test to fit the code
A failing test signals a contract change or a regression; resolve it by correcting the
implementation, making the contract change explicit, or removing the test while naming the
violated contract. "Fixing" a failing test by weakening assertions without naming the
violated contract is a violation.
Violation pattern: editing `expect(...)` values in test/** to whatever the implementation
currently produces, without a comment naming the contract being changed.

# Route changes must not rename the slug
Source must use provider id `bifrost`, chain ids `bifrost/<chain>`, and env `BIFROST_API_KEY`.
GATEWAY_API_KEY env vars and `gateway/<chain>` id construction are violations.
Violation patterns: `GATEWAY_API_KEY` in src/** or README.md; a `gatewayId/${chain.name}`-style
id construction. Allowed exceptions: MANAGED_PREFIXES entries for
legacy stripping, and prose/docstrings that mean "the gateway" as a thing.
paths: src/**/*.ts, README.md

# Chain models carry zero cost
Chain models (ids starting `bifrost/`) must be built with `cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }`.
Hard-coding any nonzero cost into a chain model's `cost` object is a violation; real rates
belong only to upstream member models built from catalog pricing.
Violation pattern: a positive numeric literal in the `cost` literal of a model built by
`buildChainModels` in src/catalog.ts.
paths: src/**/*.ts

# Wire pricing strings are never trusted
Upstream cost rates come from the wire as per-token STRINGS; converting them with a bare
`Number(...)`/`Number.parseFloat(...)` without the `perMtok` guard produces NaN and is a
violation. The conversion must reject non-finite or non-positive values and map missing
`pricing` to cost 0.
Violation patterns: `Number(` or `parseFloat(` applied directly to a `pricing.prompt` /
`pricing.completion` field outside `perMtok`; `cost: { input: NaN` or literal NaN output.
paths: src/**/*.ts

# Chain names come from CEL canonicalization
Chain model names must come from `chainNameFromCel` canonicalizing every `model ==` arm to one
bare name (after stripping managed prefixes `bifrost/` and `gateway/`). Zero or multiple
distinct canonical names is NOT a chain rule and must be skipped.
Violation patterns in src/catalog.ts: deriving a chain name from `rule.name`
(`"Chain: <model>"` string), or `wireRulesToChains` publishing a chain whose CEL arms
canonicalize to more than one bare name.
paths: src/**/*.ts

# Fallback limits stay honest
When a chain has no catalog-bearing members, pi-ai requires numeric limits; the missing-value
fallbacks are `CONTEXT_WINDOW_FALLBACK = 128_000` and `MAX_TOKENS_FALLBACK = 8_192`. Publishing
a made-up model-specific window/limit outside these constants (or omitting contextWindow /
maxTokens) is a violation.
Violation pattern in src/catalog.ts: `contextWindow:` or `maxTokens:` computed from anything
other than member catalog values or the module-scope fallback constants.
paths: src/**/*.ts

# Show both publish flags in status
The `/bifrost` status command must report `publishChains` and `publishUpstream` state and the
auth/baseUrl/config-issues lines.
Violation pattern in src/index.ts: the status-command handler notifying a message that lacks
`publishChains:` or `publishUpstream:`.
paths: src/index.ts

# Pagination is a known trap
`GET /api/routing/rules` is paginated (default limit 10). Reading only the first page while
claiming "all chains discovered" (count > limit) is a violation. If adding pagination, use
`offset` and verify `count` ≤ limit when claiming completeness.
Violation pattern in src/catalog.ts: `wireRules` accepting `count` > `limit` from the response
envelope and still returning a single page without a comment naming the pagination follow-up.
paths: src/**/*.ts

# Model ids carry the provider exactly once
Chain/upstream model ids built for publish must reconstruct the member id as
`provider + "/" + model` (or bare `model` when the target's provider is null/empty), never
model alone without the provider join, and never a doubled prefix like `gateway/gateway/…` or
`hyper/hyper/…`.
Violation patterns in src/catalog.ts: a chain/member id that fails to match
`^[a-z][a-z0-9-]*\/.+` exactly once, or a test/built id containing two consecutive provider
slugs (`gateway/gateway/`, `hyper/hyper/`, `pareto/pareto/`).
paths: src/**/*.ts

# Reasoning stays on
Every published chat model sets `reasoning: true` and a full `thinkingLevelMap` mapping every
pi level (off, minimal, low, medium, high, xhigh, max) to a non-null mapping or "off".
Violation pattern in src/*.ts: `reasoning: false` (or an omitted map) on a model built by
`buildChainModels` / `buildMemberModels`.
paths: src/**/*.ts

# Unconfigured means zero network
`discoverModels` returns `[]` without making any network call when the credential or baseUrl
is unset; a network request must not be issued in that state. This is pinned by test
(`discoverModels` returns empty).
Violation pattern in src/index.ts: removing early returns and hitting the gateway when
`token` or `baseUrl` is empty.
paths: src/index.ts

# Credential paths are exact
The stored-VK resolution must prefer the stored credential (`envApiKeyAuth` semantics:
stored key wins, then `BIFROST_API_KEY` env) and MUST NOT add a second key-resolution path
(home-file scan, config file, re-login loop).
Violation patterns: `process.env.BIFROST_API_KEY` read outside `AUTH_ENV_KEYS` plumbed
through `envApiKeyAuth`; a new credential store read in src/index.ts / src/catalog.ts.
paths: src/**/*.ts

# Slash status command constants must not lie
The status command is `/bifrost`, the login command is `/login bifrost`, and the plugin config
file is `pi-bifrost.json` in the agent dir (`CONFIG_FILE_NAME`). Drift in the user-facing
strings is a violation.
Violation patterns in src/index.ts: `registerCommand("bifrost-gateway"`, a status message
naming `/login gateway` or `pi-bifrost` (the old slug), or config.ts `CONFIG_FILE_NAME` not
`"pi-bifrost.json"`.
paths: src/**/*.ts

# Keep fetchImpl injectable for tests
`fetchJson` accepts an optional `fetchImpl` (FetchJsonOptions); removing that injection point
and hard-coding `globalThis.fetch` makes the unit tests impossible and is a violation.
Violation pattern: deleting `FetchJsonOptions`/`fetchImpl` from src/http.ts, or replacing
`opts?.fetchImpl ?? globalThis.fetch` with an unconditional global fetch call in src/http.ts.
paths: src/**/*.ts

# Never echo VK secrets
The VK value appears ONLY in the Authorization header and pi's credential store. Logging it,
printing it, embedding it in an error message, or persisting it outside pi's `auth.json` is a
violation. `wireScopeId` consumes the virtual-keys payload (which contains OTHER VKs'
secrets) and must discard everything but the matched id.
Violation patterns in src/*.ts: `console.log`/`console.error`/`process.stderr.write` of a
variable bound to a VK/key/credential value, or writing such a value into an Error message.
paths: src/**/*.ts

# No plugin-owned model persistence
Model publishing is pi-ai's responsibility (models-store). Refresh must always be live
(re-pull on every fetchModels); adding a plugin-owned cache/snapshot of chain or upstream
models is a violation.
Violation patterns: new module-scope caches keyed by URL + Time in src/catalog.ts, or
`fetchModels` serving a stored list without calling `wireScopeId`/`wireDiscovery`.
paths: src/**/*.ts

# Typeboxed wire shapes
Every fetched wire payload (`/v1/models` envelope, `/api/governance/virtual-keys` envelope,
`/api/routing/rules` envelope) must pass through a compiled typebox `Validator` inside
`fetchJson` before use; decoding a raw `any`-cast JSON body into app types without validation
is a violation.
Violation patterns in src/catalog.ts / src/http.ts: `JSON.parse(...)` result assigned to a
typed variable without `validator.Check` / `fetchJson`, or `additionalProperties: false`
added to an envelope schema (extra provider fields must pass through).
paths: src/**/*.ts

# Keep the auth.json migration best-effort
`migrateStoredCredential` copies a legacy `gateway` api_key to `bifrost` when `bifrost` is
absent, never throws into extension load, and never deletes the legacy entry. Changing it
to be load-fatal, or to remove the `gateway` entry, is a violation.
Violation patterns in src/index.ts: `migrateStoredCredential` allowed to throw, or
`delete store.gateway` added, or a second non-`api_key` type copied by `migrateLegacyCredential`.
paths: src/index.ts
