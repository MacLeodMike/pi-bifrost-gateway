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
The ONLY accepted spelling of "any" in src/** is `unknown` plus a runtime type guard, or a
concrete union/generic type. Forbidden content anywhere in a src/** file — comments and
fixtures included — is any of these literal substrings: `: any`, `<any>`, `as any`, `any[]`,
`Array<any>`, `Record<string, any>`. A `grep` over the changed file finding any of them is a
violation. `unknown[]`, `never`, and generic type params (`<T>`) are all allowed.
paths: src/**/*.ts, src/**/*.tsx

# Exported functions declare their return type
Every header line in src/** matching `export function` or `export async function` MUST also
contain a `): <TYPE> {` before the end of that header line — `TYPE` being any non-empty
string other than whitespace (examples: `): string {`, `): Promise<Model[]> {`, `): void {`,
`): Provider<"openai-completions"> {`). A violation is a header line ending with `{` directly after the parameter list with no
`):` annotation. Multi-line parameter lists count by their FINAL header line
(the one containing the closing `)` and `{`). Overloads declare the return type on the
signature line too. Arrow exports (`export const f = (...) => ...`) are exempt.
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
In src/catalog.ts, `wireRulesToChains` MUST obtain the published chain `name` from
`chainNameFromCel(rule.cel_expression)` and never read `rule.name`. A violation is any line
in src/catalog.ts where a variable assigned from `rule.name` (or from a literal beginning
`"Chain: `) is used as a chain model name or as the id of a published model, OR any
`wireRulesToChains`/`buildChainModels` invocation that emits a chain whose
`chainNameFromCel(...)` result is `undefined`. The `name:` field of every entry emitted by
`buildChainModels` must equal the chain name extracted from CEL text.
paths: src/catalog.ts

# Fallback limits stay honest
In src/catalog.ts, the literals `128_000` and `8_192` may appear ONLY inside the
module-scope declarations `const CONTEXT_WINDOW_FALLBACK = 128_000;` and
`const MAX_TOKENS_FALLBACK = 8_192;`. A violation is any OTHER occurrence of the literal
`128_000` or `8_192` anywhere in src/** (they must be reached via the two named constants),
OR `contextWindow` / `maxTokens` fields on a Model built in `buildChainModels`/
`buildMemberModels` whose value expression is anything other than a member-catalog-derived
`Math.min(...)` spread or one of those two constants.
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
Two exact facts must hold within the changed file: (1) in src/bifrost.ts, the ONLY env var
read for credential purposes appears in the single line `export const AUTH_ENV_KEYS =
["BIFROST_API_KEY"] as const;` — any OTHER occurrence of `BIFROST_API_KEY` or
`GATEWAY_API_KEY` in that file is a violation. (2) In src/index.ts and src/catalog.ts, the
string `auth.json` is read/written ONLY inside `migrateStoredCredential` — a violation is
any `auth.json` reference or `readFileSync`/`writeFileSync` in those files OUTSIDE that
function, or a second credential source (`prompt(` loops, `credentials` map reads) added
outside `bifrostProvider`'s `auth:` line.
paths: src/**/*.ts

# Slash status command constants must not lie
Grep the changed file. A violation is ANY of these literal occurrences:
(a) `bifrost-gateway` or `gateway` as the name argument of a `registerCommand(` call in
src/index.ts (the one status command must be registered as `"bifrost"`);
(b) the substring `/login gateway` in any src/** or README.md file;
(c) `CONFIG_FILE_NAME` in src/config.ts holding anything other than `"pi-bifrost.json"`
(the string literal `'pi-bifrost.json'` in src/config.ts is correct exactly once).
paths: src/**/*.ts, README.md

# Keep fetchImpl injectable for tests
src/http.ts must contain BOTH of these lines, verbatim:
(1) `fetchImpl?: typeof fetch;` (inside `interface FetchJsonOptions {`), and
(2) `const doFetch = opts?.fetchImpl ?? globalThis.fetch;` (inside `fetchJson`).
A violation is the absence of either line, a rename of `FetchJsonOptions`/`fetchImpl`/
`opts`, or (2) replaced with a call that doesn't consult `opts?.fetchImpl` first
(e.g. a bare `globalThis.fetch` call inside `fetchJson`, or `fetch(` not routed through
`doFetch`). Re-exporting `FetchJsonOptions` from any module other than src/http.ts is also a
violation.
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
In src/catalog.ts and src/index.ts, every HTTP GET of a wire payload goes through `fetchJson`
with a `Compile(...)`-built validator. Single-file violations:
(a) any `JSON.parse(...)` in src/catalog.ts/src/index.ts whose parsed value is USED
(assigned, returned, iterated) instead of being immediately passed to or wrapped by
`fetchJson` — src/http.ts's own parse-error body handling and src/index.ts's
`migrateStoredCredential` auth.json read are the ONLY two allowed sites;
(b) `additionalProperties: false` appearing on `ModelsEnvelopeSchema`,
`VirtualKeysEnvelopeSchema`, or `RulesEnvelopeSchema` in src/catalog.ts;
(c) any `fetchJson(...)` call whose `validator` argument is a `Type.Object` literal or
other uncompiled schema rather than a `Compile(...)` result.
paths: src/**/*.ts

# Keep the auth.json migration best-effort
`migrateStoredCredential` copies a legacy `gateway` api_key to `bifrost` when `bifrost` is
absent, never throws into extension load, and never deletes the legacy entry. Changing it
to be load-fatal, or to remove the `gateway` entry, is a violation.
Violation patterns in src/index.ts: `migrateStoredCredential` allowed to throw, or
`delete store.gateway` added, or a second non-`api_key` type copied by `migrateLegacyCredential`.
paths: src/index.ts
