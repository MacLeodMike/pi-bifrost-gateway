import type { Model, ThinkingLevel, ThinkingLevelMap } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { Compile } from "typebox/compile";
import { fetchJson, type FetchJsonOptions } from "./http.js";
import { INFERENCE_PATH_MODELS, MANAGEMENT_PATH_VIRTUAL_KEYS, MANAGEMENT_PATH_ROUTING_RULES } from "./bifrost.js";
import { PROVIDER_ID } from "./bifrost.js";

/**
 * pi thinking levels, ladder order; `off` (the map's disable key) comes from
 * ModelThinkingLevel, not this ladder. Chain models are transport-only:
 * effort routing happens through the gateway, so every chain advertises the
 * full map and pi sends reasoning_effort untouched.
 */
const PI_THINKING_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const satisfies readonly ThinkingLevel[];

const CONTEXT_WINDOW_FALLBACK = 128_000;
const MAX_TOKENS_FALLBACK = 8_192;

/* ---------- wire schemas (typebox-validated) ---------- */

const PricingSchema = Type.Object({
	prompt: Type.String(),
	completion: Type.String(),
	input_cache_read: Type.Optional(Type.String()),
	input_cache_write: Type.Optional(Type.String()),
});

export const CatalogModelSchema = Type.Object({
	id: Type.String(),
	owned_by: Type.Optional(Type.String()),
	context_length: Type.Optional(Type.Number()),
	max_output_limit: Type.Optional(Type.Number()),
	pricing: Type.Optional(PricingSchema),
});

export const ModelsEnvelopeSchema = Type.Object({
	data: Type.Array(CatalogModelSchema),
});

export const RoutingTargetSchema = Type.Object({
	provider: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	model: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	weight: Type.Number(),
});

export const RoutingRuleSchema = Type.Object({
	id: Type.String(),
	name: Type.String(),
	enabled: Type.Optional(Type.Boolean()),
	cel_expression: Type.String(),
	targets: Type.Array(RoutingTargetSchema),
	fallbacks: Type.Optional(Type.Array(Type.String())),
	scope: Type.String(),
	scope_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	priority: Type.Optional(Type.Number()),
});

export const RulesEnvelopeSchema = Type.Object({
	rules: Type.Array(RoutingRuleSchema),
});

export const VirtualKeySchema = Type.Object({
	id: Type.String(),
	name: Type.Optional(Type.String()),
	value: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

/**
 * Wire envelope as observed 2026-10-08: GET /api/governance/virtual-keys
 * returns `{virtual_keys: [...], count, ...}` with the full VK rows
 * INCLUDING their secret values. Unknown extra fields pass validation.
 */
export const VirtualKeysEnvelopeSchema = Type.Object({
	virtual_keys: Type.Array(VirtualKeySchema),
});

export type CatalogModel = {
	id: string;
	owned_by?: string;
	context_length?: number;
	max_output_limit?: number;
	pricing?: { prompt: string; completion: string; input_cache_read?: string; input_cache_write?: string };
};

export type RoutingRule = {
	id: string;
	name: string;
	enabled?: boolean;
	cel_expression: string;
	targets: Array<{ provider?: string | null; model?: string | null; weight: number }>;
	fallbacks?: string[];
	scope: string;
	scope_id?: string | null;
	priority?: number;
};

export type VirtualKey = { id: string; name?: string; value?: string | null };

/* ---------- decoded types ---------- */

export type Chain = {
	/** Chain model name extracted from the routing rule (e.g. "glm-5.3-flash"). */
	name: string;
	/** Primary member id, "provider/model". */
	primary: string;
	/** Fallback member ids, in order. */
	fallbacks: string[];
};

const ModelsEnvelopeValidator = Compile(ModelsEnvelopeSchema);
const RulesEnvelopeValidator = Compile(RulesEnvelopeSchema);
const VirtualKeysEnvelopeValidator = Compile(VirtualKeysEnvelopeSchema);

/* ---------- wire fetching ---------- */

/** Decode an OpenAI-shaped /v1/models wire envelope into member entries. */
export function wireCatalogToModels(envelope: { data: CatalogModel[] }): CatalogModel[] {
	return envelope.data;
}

/** GET gateway /v1/models with the VK — the full member catalog with pricing. */
export async function wireCatalog(
	token: string,
	baseUrl: string,
	signal?: AbortSignal,
	opts?: FetchJsonOptions,
): Promise<CatalogModel[]> {
	const envelope = await fetchJson(
		`${baseUrl.replace(/\/$/, "")}/${INFERENCE_PATH_MODELS}`,
		token,
		ModelsEnvelopeValidator,
		signal,
		opts,
	);
	return wireCatalogToModels(envelope as { data: CatalogModel[] });
}

/** Resolve the management-plane base URL from the inference /v1 base URL. */
export function managementBase(baseUrl: string): string {
	return baseUrl.replace(/\/v1\/?$/, "");
}

/**
 * GET /api/governance/virtual-keys and match the stored credential value to
 * discover this plugin's VK id (the scope_id for routing-rule filtering).
 * Returns undefined when no VK row's value matches the token.
 */
export async function wireScopeId(
	token: string,
	baseUrl: string,
	signal?: AbortSignal,
	opts?: FetchJsonOptions,
): Promise<string | undefined> {
	const url = `${managementBase(baseUrl)}${MANAGEMENT_PATH_VIRTUAL_KEYS}`;
	const envelope = await fetchJson(url, token, VirtualKeysEnvelopeValidator, signal, opts);
	const keys = (envelope as { virtual_keys: VirtualKey[] }).virtual_keys;
	const match = keys.find((vk) => vk.value === token);
	return match?.id;
}

/**
 * GET /api/routing/rules?scope=virtual_key&scope_id=<id> and decode the
 * chain rules. Throws when Bifrost responds with an error envelope
 * (schema mismatch or HTTP error surfaced by fetchJson).
 */
export async function wireRules(
	token: string,
	baseUrl: string,
	scopeId: string,
	signal?: AbortSignal,
	opts?: FetchJsonOptions,
): Promise<RoutingRule[]> {
	const url = `${managementBase(baseUrl)}${MANAGEMENT_PATH_ROUTING_RULES}?scope=virtual_key&scope_id=${encodeURIComponent(scopeId)}`;
	const envelope = await fetchJson(url, token, RulesEnvelopeValidator, signal, opts);
	return (envelope as { rules: RoutingRule[] }).rules;
}

/** Full discovery: catalog + rules for the VK, in parallel where possible. */
export async function wireDiscovery(
	token: string,
	baseUrl: string,
	scopeId: string,
	signal?: AbortSignal,
	opts?: FetchJsonOptions,
): Promise<{ catalog: CatalogModel[]; rules: RoutingRule[] }> {
	const [catalog, rules] = await Promise.all([
		wireCatalog(token, baseUrl, signal, opts),
		wireRules(token, baseUrl, scopeId, signal, opts),
	]);
	return { catalog, rules };
}

/* ---------- chain decoding (pure) ---------- */

/**
 * Extract a chain model name from a routing rule's CEL expression.
 * Recognizes the chains-first convention `model == "x" || model == "gateway/x"`
 * (either side), picking the bare name. Returns undefined for anything
 * else (expression-based or multi-name rules) — those are not chain rules.
 */
export function chainNameFromCel(cel: string): string | undefined {
	const bare = cel.match(/model\s*==\s*"([^"]+)"/g);
	if (!bare || bare.length !== 2) return undefined;
	const names = bare.map((m) => m.replace(/.*"([^"]+)".*/, "$1"));
	const [a, b] = names as [string, string];
	if (a.startsWith(`${PROVIDER_ID}/`) && !b.startsWith(`${PROVIDER_ID}/`)) return b;
	if (b.startsWith(`${PROVIDER_ID}/`) && !a.startsWith(`${PROVIDER_ID}/`)) return a;
	// Both bare+gateway w/o prefix or two identical names: prefer the bare one.
	return a === b ? a : undefined;
}

/** Decode enabled, unambiguous chain rules. Order follows rule priority. */
export function wireRulesToChains(rules: RoutingRule[]): Chain[] {
	const usable: Array<{ chain: Chain; priority: number }> = [];
	for (const rule of rules) {
		if (rule.enabled === false) continue;
		const name = chainNameFromCel(rule.cel_expression);
		if (!name) continue;
		const primaries = new Set(
			rule.targets.map((t) => {
				if (typeof t.model !== "string" || t.model.length === 0) return null;
				return typeof t.provider === "string" && t.provider.length > 0 ? `${t.provider}/${t.model}` : t.model;
			}).filter((m): m is string => typeof m === "string"),
		);
		if (primaries.size !== 1) continue; // zero or multiple pinned models = ambiguous
		const primary = [...primaries][0]!;
		usable.push({
			chain: { name, primary, fallbacks: rule.fallbacks ?? [] },
			priority: rule.priority ?? 0,
		});
	}
	usable.sort((a, b) => a.priority - b.priority);
	return usable.map((entry) => entry.chain);
}

/* ---------- model building (pure) ---------- */

/** Convert a $/token wire string to pi's $/Mtok rate. */
export function perMtok(dollarsPerToken: string): number | undefined {
	const value = Number.parseFloat(dollarsPerToken);
	return Number.isFinite(value) && value > 0 ? value * 1_000_000 : undefined;
}

function thinkingLevelMap(): ThinkingLevelMap {
	const map: ThinkingLevelMap = { off: "off" };
	for (const level of PI_THINKING_LEVELS) map[level] = level;
	return map;
}

/** Build one gateway/<chain> chat model per chain. Cost is 0 by design. */
export function buildChainModels(
	chains: Chain[],
	catalog: CatalogModel[],
	gatewayId: string,
	baseUrl: string,
): Model<"openai-completions">[] {
	const byId = new Map(catalog.map((m) => [m.id, m] as const));
	return chains.map((chain) => {
		const members = [chain.primary, ...chain.fallbacks];
		const contexts = members
			.map((id) => byId.get(id)?.context_length)
			.filter((v): v is number => typeof v === "number");
		const contextWindow = contexts.length > 0 ? Math.min(...contexts) : CONTEXT_WINDOW_FALLBACK;
		const model: Model<"openai-completions"> = {
			id: `${gatewayId}/${chain.name}`,
			name: chain.name,
			api: "openai-completions",
			provider: gatewayId,
			baseUrl,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			reasoning: true,
			contextWindow,
			maxTokens: MAX_TOKENS_FALLBACK,
			thinkingLevelMap: thinkingLevelMap(),
		};
		return model;
	});
}

/**
 * Build direct-selectable models for the /v1/models catalog with real
 * per-member pricing, ordered with chain members first.
 */
export function buildMemberModels(
	chains: Chain[],
	catalog: CatalogModel[],
	gatewayId: string,
	baseUrl: string,
): Model<"openai-completions">[] {
	const memberIds: string[] = [];
	const seen = new Set<string>();
	for (const chain of chains) {
		for (const id of [chain.primary, ...chain.fallbacks]) {
			if (!seen.has(id)) {
				seen.add(id);
				memberIds.push(id);
			}
		}
	}
	const byId = new Map(catalog.map((m) => [m.id, m] as const));
	for (const entry of catalog) {
		if (!seen.has(entry.id)) {
			seen.add(entry.id);
			memberIds.push(entry.id);
		}
	}
	const models: Model<"openai-completions">[] = [];
	for (const memberId of memberIds) {
		const entry = byId.get(memberId);
		if (!entry) continue; // chain member absent from /v1/models — skip rather than guess
		const inputRate = entry.pricing ? perMtok(entry.pricing.prompt) : undefined;
		const outputRate = entry.pricing ? perMtok(entry.pricing.completion) : undefined;
		models.push({
			id: memberId,
			name: memberId,
			api: "openai-completions",
			provider: gatewayId,
			baseUrl,
			input: ["text"],
			cost: { input: inputRate ?? 0, output: outputRate ?? 0, cacheRead: 0, cacheWrite: 0 },
			reasoning: true,
			contextWindow: entry.context_length ?? CONTEXT_WINDOW_FALLBACK,
			maxTokens: entry.max_output_limit ?? MAX_TOKENS_FALLBACK,
			thinkingLevelMap: thinkingLevelMap(),
		});
	}
	return models;
}

/** Chains first, then upstream models (deduped by id — chain ids are namespaced). */
export function buildAllModels(
	chains: Chain[],
	catalog: CatalogModel[],
	gatewayId: string,
	baseUrl: string,
	publishChains: boolean,
	publishUpstream: boolean,
): Model<"openai-completions">[] {
	const chainModels = publishChains ? buildChainModels(chains, catalog, gatewayId, baseUrl) : [];
	const upstreamModels = publishUpstream ? buildMemberModels(chains, catalog, gatewayId, baseUrl) : [];
	return [...chainModels, ...upstreamModels];
}

