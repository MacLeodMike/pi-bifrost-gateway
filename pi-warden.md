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
Literal forbidden substrings anywhere in src/** (including comments and test fixtures):
`: any`, `<any>`, `as any`, `any[]`. Use `unknown` plus a type guard, or a concrete type.
paths: src/**/*.ts, src/**/*.tsx

# Exported functions declare their return type
Every `export function` / `export async function` carries an explicit return annotation:
the header line matches `export (async )?function \w+` AND contains `: ` after the closing
parenthesis of the parameter list (e.g. `): string {`, `): Promise<Model[]> {`, `): void {`).
A violation is ANY `export function` / `export async function` whose header line has no
`): <type> {` before the opening brace (including inferred-only returns and generators
without annotations). Arrow-function exports (`export const f = (...) => ...`) are exempt
as they cannot be annotated without a `:` after the parens anyway.
paths: src/**/*.ts

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
In src/catalog.ts, `wireRulesToChains` must derive each published chain's `name` from
`chainNameFromCel(rule.cel_expression)` — never from `rule.name` (the human label
`"Chain: <model>"`) and never by hand-built string work. A concrete violation is ANY use of
`rule.name` as a chain model name, or calling `wireRulesToChains` on a rule whose CEL arms
(`model == "x"`) canonicalize to 2+ distinct bare names after stripping managed prefixes
(`chainNameFromCel` returning `undefined`) and the rule still being published.
paths: src/catalog.ts

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
The credential is resolved in exactly one place: `AUTH_ENV_KEYS` (src/bifrost.ts) plumbed
into `envApiKeyAuth(...)` in src/index.ts. Single-file violations: (a) any OTHER
`process.env.BIFROST_API_KEY` (or `process.env.GATEWAY_API_KEY`) READ outside
`AUTH_ENV_KEYS = [...]` in src/bifrost.ts; (b) any `readFile`/`readFileSync` call in
src/index.ts or src/catalog.ts that opens `auth.json` outside `migrateStoredCredential`
in src/index.ts; (c) any credential prompting loop (`interaction.prompt(...)`) added
outside the `login` implementation in src/index.ts.
paths: src/**/*.ts

# Slash status command constants must not lie
User-facing identifiers in src/** must be exactly these literals. A violation is ANY of:
(a) any `registerCommand(...)` name that is not `"bifrost"` in src/index.ts; (b) the literal substring `/login gateway` anywhere in src/** or
README.md (only `/login bifrost` is correct); (c) `CONFIG_FILE_NAME` in src/config.ts holding
a value other than `"pi-bifrost.json"`.
paths: src/**/*.ts, README.md

# Keep fetchImpl injectable for tests
src/http.ts MUST keep BOTH of these exact shapes: (a) `export interface FetchJsonOptions {`
containing the field `fetchImpl?: typeof fetch;`, and (b) inside `fetchJson`, the line
`const doFetch = opts?.fetchImpl ?? globalThis.fetch;`. Deleting either line, renaming the
interface or field, or replacing the fallback chain in (b) with an unconditional
`globalThis.fetch` call is a violation. `fetchJson` must also keep its
`FetchJsonOptions`-typed optional `opts` parameter. The interface must not be re-exported
from any module other than src/http.ts, so tests retain one seam to import.
paths: src/http.ts

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
Every wire payload is parsed ONLY by `fetchJson` in src/http.ts (Bearer GET + typebox
validation). Single-file violations: (a) a `JSON.parse(...)` call anywhere in src/catalog.ts
or src/index.ts whose parsed result is USED (assigned, returned, iterated) rather than
immediately wrapped in `fetchJson`; (b) `additionalProperties: false` present on any
`Type.Object` envelope schema (`ModelsEnvelopeSchema`, `VirtualKeysEnvelopeSchema`,
`RulesEnvelopeSchema`) in src/catalog.ts — extra provider fields must continue to pass
through unchecked; (c) a `fetchJson` call passing a raw schema (a `Type.Object` value) as the
`validator` argument instead of a compiled validator from `Compile(...)`.
paths: src/**/*.ts

# Keep the auth.json migration best-effort
`migrateStoredCredential` copies a legacy `gateway` api_key to `bifrost` when `bifrost` is
absent, never throws into extension load, and never deletes the legacy entry. Changing it
to be load-fatal, or to remove the `gateway` entry, is a violation.
Violation patterns in src/index.ts: `migrateStoredCredential` allowed to throw, or
`delete store.gateway` added, or a second non-`api_key` type copied by `migrateLegacyCredential`.
paths: src/index.ts
