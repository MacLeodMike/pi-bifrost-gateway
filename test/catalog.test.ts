import { describe, expect, it } from "vitest";
import {
	wireCatalogToModels,
	wireRulesToChains,
	buildChainModels,
	buildMemberModels,
	buildAllModels,
	nativeFamily,
	surfaceFor,
} from "../src/catalog.js";
import type { CatalogModel, RoutingRule } from "../src/catalog.js";

const GATEWAY_ID = "bifrost";

/* ---------- fixtures ---------- */

function memberModel(
	id: string,
	overrides: Partial<CatalogModel> = {},
): CatalogModel {
	return {
		id,
		owned_by: id.split("/")[0] ?? "",
		context_length: 1_000_000,
		pricing: { prompt: "0.0000001000", completion: "0.0000005000" },
		...overrides,
	};
}

function chainRule(name: string, target: string, fallbacks: string[], cel?: string): RoutingRule {
	return {
		id: `vk-pi-chain-${name}`,
		name: `Chain: ${name}`,
		enabled: true,
		cel_expression: cel ?? `model == "${name}" || model == "bifrost/${name}"`,
		targets: [(() => {
			const [first, rest] = [target.split("/")[0] ?? "", target.split("/").slice(1).join("/")];
			return rest.length > 0
				? { provider: first, model: rest, weight: 1 }
				: { provider: "", model: target, weight: 1 };
		})()],
		fallbacks,
		scope: "virtual_key",
		scope_id: "vk-pi",
		priority: 0,
	};
}

const BASE_URL = "https://llm-gateway.example.com/v1";

describe("wireCatalogToModels", () => {
	it("parses an OpenAI-shaped /v1/models envelope", () => {
		const envelope = {
			object: "list",
			data: [memberModel("hyper/glm-5.3-flash"), memberModel("ollama-cloud/glm-5.3-flash")],
		};
		const models = wireCatalogToModels(envelope);
		expect(models).toHaveLength(2);
		expect(models[0]?.id).toBe("hyper/glm-5.3-flash");
	});

	it("tolerates missing pricing and empty fallback data", () => {
		const envelope = { data: [{ id: "x/y", context_length: 8192 }] };
		expect(wireCatalogToModels(envelope)).toHaveLength(1);
	});
});

describe("wireRulesToChains", () => {
	it("extracts chain name from cel model == expression and skips non-chain rules", () => {
		const rules: RoutingRule[] = [
			chainRule("glm-5.3-flash", "hyper/glm-5.3-flash", ["pareto/glm-5.3-flash"]),
			{
				...chainRule("other", "hyper/x", []),
				cel_expression: 'model.startsWith("x")',
			},
		];
		const chains = wireRulesToChains(rules);
		expect(chains).toHaveLength(1);
		expect(chains[0]?.name).toBe("glm-5.3-flash");
		expect(chains[0]?.primary).toBe("hyper/glm-5.3-flash");
		expect(chains[0]?.fallbacks).toEqual(["pareto/glm-5.3-flash"]);
	});

	it("skips disabled rules and multi-model targets (ambiguous)", () => {
		const rules: RoutingRule[] = [
			{ ...chainRule("a", "p/m1", []), enabled: false },
			{
				...chainRule("b", "p/m", []),
				targets: [
					{ provider: "p", model: "m1", weight: 0.5 },
					{ provider: "p", model: "m2", weight: 0.5 },
				],
			},
		];
		expect(wireRulesToChains(rules)).toHaveLength(0);
	});

	it("skips rules whose cel has no model == form (expression rules are not chains)", () => {
		const rules = [chainRule("kimi-k3", "hyper/kimi-k3", [], 'provider == "other"*')];
		expect(wireRulesToChains(rules)).toHaveLength(0);
	});
});

describe("buildChainModels", () => {
	it("builds bifrost/<chain> entries with min context window and zero cost", () => {
		const catalog = [
			memberModel("hyper/glm-5.3-flash", { context_length: 1_000_000 }),
			memberModel("pareto/glm-5.3-flash", { context_length: 500_000 }),
		];
		const chains = [{ name: "glm-5.3-flash", primary: "hyper/glm-5.3-flash", fallbacks: ["pareto/glm-5.3-flash"] }];
		const models = buildChainModels(chains, catalog, GATEWAY_ID, BASE_URL);
		expect(models).toHaveLength(1);
		const m = models[0]!;
		expect(m.id).toBe("bifrost/glm-5.3-flash");
		expect(m.provider).toBe(GATEWAY_ID);
		expect(m.baseUrl).toBe(BASE_URL);
		expect(m.contextWindow).toBe(500_000);
		expect(m.cost.input).toBe(0);
		expect(m.cost.output).toBe(0);
		expect(m.reasoning).toBe(true);
		// Input modalities: image is declared so pi-ai forwards tool-result
		// images instead of silently replacing them (the worse-error rule —
		// see INPUT_MODALITIES in catalog.ts).
		expect(m.input).toEqual(["text", "image"]);
	});

	it("publishes text-only for the glm-5.3 chain (user ruling: never vision-capable)", () => {
		const models = buildChainModels(
			[{ name: "glm-5.3", primary: "hyper/glm-5.3", fallbacks: [] }],
			[],
			GATEWAY_ID,
			BASE_URL,
		);
		expect(models[0]?.input).toEqual(["text"]);
		// Sibling sweep guard: glm-5.3-flash is vision-capable first-party and
		// must NOT inherit the bare glm-5.3 denial (exact-name matching).
		const flash = buildChainModels(
			[{ name: "glm-5.3-flash", primary: "hyper/glm-5.3-flash", fallbacks: [] }],
			[],
			GATEWAY_ID,
			BASE_URL,
		);
		expect(flash[0]?.input).toEqual(["text", "image"]);
	});

	it("publishes text-only for the deepseek-v4-flash and deepseek-v4-pro chains, image for v4.1", () => {
		for (const name of ["deepseek-v4-flash", "deepseek-v4-pro"]) {
			const models = buildChainModels([{ name, primary: `ollama-cloud/${name}`, fallbacks: [] }], [], GATEWAY_ID, BASE_URL);
			expect(models[0]?.input, name).toEqual(["text"]);
		}
		// deepseek-v4.1-flash is vision-capable — the version-suffix denial
		// must not bleed into the .1 generation.
		const v41 = buildChainModels(
			[{ name: "deepseek-v4.1-flash", primary: "hyper/deepseek-v4.1-flash", fallbacks: [] }],
			[],
			GATEWAY_ID,
			BASE_URL,
		);
		expect(v41[0]?.input).toEqual(["text", "image"]);
	});

	it("applies the text-only denylist to member models by bare name", () => {
		const catalog = [
			memberModel("hyper/glm-5.3"),
			memberModel("hyper/glm-5.3-flash"),
			memberModel("ollama-cloud/deepseek-v4-pro-0813"),
		];
		const chains = [{ name: "glm-5.3-flash", primary: "hyper/glm-5.3-flash", fallbacks: [] }];
		const models = buildMemberModels(chains, catalog, GATEWAY_ID, BASE_URL);
		const byId = new Map(models.map((m) => [m.id, m] as const));
		expect(byId.get("hyper/glm-5.3")?.input).toEqual(["text"]);
		expect(byId.get("hyper/glm-5.3-flash")?.input).toEqual(["text", "image"]);
		expect(byId.get("ollama-cloud/deepseek-v4-pro-0813")?.input).toEqual(["text"]);
	});

	it("declares image input on member models too (tool-result image gate)", () => {
		const catalog = [memberModel("hyper/glm-5.3-flash", { context_length: 200_000 })];
		const chains = [{ name: "glm-5.3-flash", primary: "hyper/glm-5.3-flash", fallbacks: [] }];
		const models = buildMemberModels(chains, catalog, GATEWAY_ID, BASE_URL);
		expect(models[0]?.input).toEqual(["text", "image"]);
		// Fresh array per model — no shared-mutable-array aliasing across entries.
		const chains2 = [{ name: "kimi-k3", primary: "hyper/kimi-k3", fallbacks: [] }];
		const more = buildChainModels(chains2, catalog, GATEWAY_ID, BASE_URL);
		expect(more[0]?.input).toEqual(["text", "image"]);
		expect(more[0]!.input).not.toBe(models[0]!.input);
	});

	it("uses a fallback context window when no member has one", () => {
		const models = buildChainModels(
			[{ name: "chain-x", primary: "p/mx", fallbacks: [] }],
			[],
			GATEWAY_ID,
			BASE_URL,
		);
		expect(models[0]?.contextWindow).toBe(128_000);
	});

	it("a member missing from the catalog keeps the chain viable with defaults", () => {
		const models = buildChainModels(
			[{ name: "glm-5.3-flash", primary: "hyper/glm-5.3-flash", fallbacks: [] }],
			[],
			GATEWAY_ID,
			BASE_URL,
		);
		expect(models[0]?.id).toBe("bifrost/glm-5.3-flash");
		expect(models[0]?.contextWindow).toBe(128_000);
	});
});

describe("buildMemberModels", () => {
	it("publishes one entry per unique member with real rates from the catalog", () => {
		const catalog = [
			memberModel("hyper/glm-5.3-flash", { pricing: { prompt: "0.0000001633", completion: "0.0000005444" } }),
			memberModel("pareto/glm-5.3-flash"),
		];
		const chains = [
			{ name: "glm-5.3-flash", primary: "hyper/glm-5.3-flash", fallbacks: ["pareto/glm-5.3-flash"] },
		];
		const models = buildMemberModels(chains, catalog, GATEWAY_ID, BASE_URL);
		expect(models).toHaveLength(2);
		const hyper = models.find((m) => m.id === "hyper/glm-5.3-flash");
		expect(hyper?.cost.input).toBeCloseTo(0.1633, 4);
		expect(hyper?.cost.output).toBeCloseTo(0.5444, 4);
	});

	it("carries wire cache rates when the gateway reports them", () => {
		const catalog = [
			memberModel("hyper/glm-5.3-flash", {
				pricing: {
					prompt: "0.0000001000",
					completion: "0.0000005000",
					input_cache_read: "0.0000000100",
					input_cache_write: "0.0000001250",
				},
			}),
		];
		const models = buildMemberModels([], catalog, GATEWAY_ID, BASE_URL);
		expect(models[0]?.cost.cacheRead).toBeCloseTo(0.01, 4);
		expect(models[0]?.cost.cacheWrite).toBeCloseTo(0.125, 4);
	});

	it("stays at honest-zero cost when cache rates are absent", () => {
		const catalog = [memberModel("hyper/glm-5.3-flash")];
		const models = buildMemberModels([], catalog, GATEWAY_ID, BASE_URL);
		expect(models[0]?.cost.cacheRead).toBe(0);
		expect(models[0]?.cost.cacheWrite).toBe(0);
	});

	it("is empty when publishMembers is false", () => {
		expect(buildMemberModels([], [], GATEWAY_ID, BASE_URL)).toEqual([]);
	});

	it("ships the override ladder when the config declares one for a member", () => {
		const catalog = [memberModel("hyper/glm-5.2")];
		const models = buildMemberModels([], catalog, GATEWAY_ID, BASE_URL, { "hyper/glm-5.2": ["low", "high"] });
		expect(models[0]?.thinkingLevelMap).toEqual({ off: "off", low: "low", high: "high" });
	});

	it("ships the full ladder when no override is declared", () => {
		const catalog = [memberModel("hyper/glm-5.2")];
		const models = buildMemberModels([], catalog, GATEWAY_ID, BASE_URL);
		expect(Object.keys(models[0]?.thinkingLevelMap ?? {})).toContain("xhigh");
	});

	it("chains always carry the full ladder even when overrides exist", () => {
		const catalog = [memberModel("hyper/glm-5.2")];
		const chains = [{ name: "glm-5.2", primary: "hyper/glm-5.2", fallbacks: [] }];
		const models = buildChainModels(chains, catalog, GATEWAY_ID, BASE_URL);
		expect(Object.keys(models[0]?.thinkingLevelMap ?? {})).toContain("xhigh");
	});
});

describe("buildAllModels", () => {
	it("chains first, then members, deduped", () => {
		const catalog = [memberModel("hyper/glm-5.3-flash")];
		const chains = [{ name: "glm-5.3-flash", primary: "hyper/glm-5.3-flash", fallbacks: [] }];
		const all = buildAllModels(chains, catalog, GATEWAY_ID, BASE_URL, true, false);
		expect(all.map((m) => m.id)).toEqual(["bifrost/glm-5.3-flash"]);

		const allWithMembers = buildAllModels(chains, catalog, GATEWAY_ID, BASE_URL, true, true);
		expect(allWithMembers.map((m) => m.id)).toEqual(["bifrost/glm-5.3-flash", "hyper/glm-5.3-flash"]);
	});
});

describe("chain id prefix (bifrost)", () => {
	it("accepts a 3-arm cel (bare, gateway/, bifrost/) and strips managed prefixes", () => {
		const rules = [
			chainRule("glm-5.3-flash", "hyper/glm-5.3-flash", [], 'model == "glm-5.3-flash" || model == "gateway/glm-5.3-flash" || model == "bifrost/glm-5.3-flash"'),
		];
		const chains = wireRulesToChains(rules);
		expect(chains).toHaveLength(1);
		expect(chains[0]?.name).toBe("glm-5.3-flash");
	});

	it("rejects cels with 2 model == arms that do not share one bare name", () => {
		const rules = [
			chainRule("weird", "hyper/x", [], 'model == "glm-5.3-flash" || model == "kimi-k3"'),
		];
		expect(wireRulesToChains(rules)).toHaveLength(0);
	});

	it("accepts a gateway-prefixed-only cel (2 arms, gateway arm + bare)", () => {
		const rules = [
			chainRule("glm-5.2", "hyper/glm-5.2", [], 'model == "glm-5.2" || model == "gateway/glm-5.2"'),
		];
		const chains = wireRulesToChains(rules);
		expect(chains).toHaveLength(1);
		expect(chains[0]?.name).toBe("glm-5.2");
	});
});

describe("native-protocol surfaces (gated, toggles on)", () => {
	it("claude-family chains publish anthropic-messages at the /anthropic integration prefix", () => {
		const chains = [{ name: "claude-sonnet-5-5", primary: "inferhub-anthropic/claude-sonnet-5-5", fallbacks: [] }];
		const models = buildChainModels(chains, [], GATEWAY_ID, BASE_URL, { responses: true, messages: true });
		expect(models[0]?.api).toBe("anthropic-messages");
		// Anthropic SDK appends /v1/messages itself — baseUrl must be the
		// gateway root + the integration prefix, never the /v1 base.
		expect(models[0]?.baseUrl).toBe("https://llm-gateway.example.com/anthropic");
		expect(models[0]?.thinkingLevelMap).toEqual({ off: null });
		expect(models[0]?.compat).toEqual({ forceAdaptiveThinking: true });
	});

	it("gpt-family chains publish openai-responses with off:none on the /v1 base", () => {
		const chains = [{ name: "gpt-6-luna", primary: "inferhub-openai/gpt-6-luna", fallbacks: [] }];
		const models = buildChainModels(chains, [], GATEWAY_ID, BASE_URL, { responses: true, messages: true });
		expect(models[0]?.api).toBe("openai-responses");
		expect(models[0]?.baseUrl).toBe(BASE_URL);
		expect(models[0]?.thinkingLevelMap).toEqual({
			off: "none",
			minimal: "minimal",
			low: "low",
			medium: "medium",
			high: "high",
			xhigh: "xhigh",
			max: "max",
		});
		expect(models[0]?.compat).toBeUndefined();
	});

	it("open-weight chains stay openai-completions with off:off", () => {
		const chains = [{ name: "glm-5.3-flash", primary: "hyper/glm-5.3-flash", fallbacks: ["inferhub-openai/glm-5.3-flash"] }];
		const models = buildChainModels(chains, [], GATEWAY_ID, BASE_URL, { responses: true, messages: true });
		expect(models[0]?.api).toBe("openai-completions");
		expect(models[0]?.baseUrl).toBe(BASE_URL);
		expect(models[0]?.thinkingLevelMap).toEqual({
			off: "off",
			minimal: "minimal",
			low: "low",
			medium: "medium",
			high: "high",
			xhigh: "xhigh",
			max: "max",
		});
	});

	it("gpt-oss stays chat completions (open-weight, not an [OI]-native model)", () => {
		const models = buildMemberModels([], [memberModel("inferhub-openai/gpt-oss-120b")], GATEWAY_ID, BASE_URL, undefined, { responses: true, messages: true });
		expect(models[0]?.api).toBe("openai-completions");
	});

	it("family comes from the model NAME, never the serving prefix", () => {
		const catalog = [
			memberModel("kiro/claude-sonnet-5-5"),
			memberModel("kiro/gpt-5.6-luna"),
			memberModel("cc/claude-opus-5-5"),
			memberModel("cx/gpt-6-astra"),
		];
		const models = buildMemberModels([], catalog, GATEWAY_ID, BASE_URL, undefined, { responses: true, messages: true });
		const byId = new Map(models.map((m) => [m.id, m] as const));
		expect(byId.get("kiro/claude-sonnet-5-5")?.api).toBe("anthropic-messages");
		expect(byId.get("kiro/gpt-5.6-luna")?.api).toBe("openai-responses");
		expect(byId.get("cc/claude-opus-5-5")?.api).toBe("anthropic-messages");
		expect(byId.get("cx/gpt-6-astra")?.api).toBe("openai-responses");
	});

	it("member anthropic models carry the adaptive-thinking pin; completions members do not", () => {
		const catalog = [memberModel("inferhub-anthropic/claude-opus-5-5"), memberModel("hyper/glm-5.3")];
		const models = buildMemberModels([], catalog, GATEWAY_ID, BASE_URL, undefined, { responses: true, messages: true });
		const byId = new Map(models.map((m) => [m.id, m] as const));
		expect(byId.get("inferhub-anthropic/claude-opus-5-5")?.compat).toEqual({ forceAdaptiveThinking: true });
		expect(byId.get("hyper/glm-5.3")?.compat).toBeUndefined();
	});
});

describe("native-protocol config gating (nativeProtocols)", () => {
	const CLAUDE = "clau" + "de-sonnet-5-5";

	it("both toggles off (default): every model publishes chat completions on the /v1 base", () => {
		const chains = [
			{ name: CLAUDE, primary: `inferhub-anthropic/${CLAUDE}`, fallbacks: [] },
			{ name: "gpt-6-luna", primary: "inferhub-openai/gpt-6-luna", fallbacks: [] },
		];
		const models = buildChainModels(chains, [], GATEWAY_ID, BASE_URL);
		expect(models.every((m) => m.api === "openai-completions")).toBe(true);
		expect(models.every((m) => m.baseUrl === BASE_URL)).toBe(true);
	});

	it("toggles on: built-in heuristic applies (claude→anthropic, gpt→responses)", () => {
		const native = { responses: true, messages: true };
		const chains = [
			{ name: CLAUDE, primary: `inferhub-anthropic/${CLAUDE}`, fallbacks: [] },
			{ name: "gpt-6-luna", primary: "inferhub-openai/gpt-6-luna", fallbacks: [] },
			{ name: "glm-5.3-flash", primary: "hyper/glm-5.3-flash", fallbacks: [] },
		];
		const models = buildChainModels(chains, [], GATEWAY_ID, BASE_URL, native);
		expect(models[0]?.api).toBe("anthropic-messages");
		expect(models[1]?.api).toBe("openai-responses");
		expect(models[2]?.api).toBe("openai-completions");
	});

	it("messages toggle alone leaves gpt on completions; responses toggle alone leaves claude on completions", () => {
		expect(surfaceFor(CLAUDE, BASE_URL, { responses: true, messages: false }).api).toBe("openai-completions");
		expect(surfaceFor("gpt-6-luna", BASE_URL, { responses: false, messages: true }).api).toBe("openai-completions");
	});

	it("exact-name lists REPLACE the built-in heuristic for that surface", () => {
		const native = {
			responses: true,
			messages: true,
			// only this exact name gets the native wire — claude-* heuristic disabled
			messagesModels: ["my-custom-claude-host"],
			responsesModels: ["gpt-6-luna"],
		};
		expect(surfaceFor("my-custom-claude-host", BASE_URL, native).api).toBe("anthropic-messages");
		// heuristic-only names no longer match
		expect(surfaceFor(CLAUDE, BASE_URL, native).api).toBe("openai-completions");
		// gpt-6-luna matches the list; gpt-6-astra (heuristic-only) does not
		expect(surfaceFor("gpt-6-luna", BASE_URL, native).api).toBe("openai-responses");
		expect(surfaceFor("gpt-6-astra", BASE_URL, native).api).toBe("openai-completions");
	});

	it("member models honor the gates too", () => {
		const catalog = [memberModel(`inferhub-anthropic/${CLAUDE}`), memberModel("inferhub-openai/gpt-6-luna")];
		const off = buildMemberModels([], catalog, GATEWAY_ID, BASE_URL, undefined, undefined);
		expect(off.every((m) => m.api === "openai-completions")).toBe(true);
		const on = buildMemberModels([], catalog, GATEWAY_ID, BASE_URL, undefined, { responses: true, messages: true });
		const byId = new Map(on.map((m) => [m.id, m] as const));
		expect(byId.get(`inferhub-anthropic/${CLAUDE}`)?.api).toBe("anthropic-messages");
		expect(byId.get("inferhub-openai/gpt-6-luna")?.api).toBe("openai-responses");
	});

	it("gpt-oss stays completions even with the responses toggle on", () => {
		expect(surfaceFor("gpt-oss-120b", BASE_URL, { responses: true, messages: true }).api).toBe("openai-completions");
	});

	it("nativeFamily classifies by NAME not prefix", () => {
		expect(nativeFamily("kiro/" + CLAUDE)).toBe("anthropic");
		expect(nativeFamily("kiro/gpt-5.6-luna")).toBe("openai");
		expect(nativeFamily("cc/" + CLAUDE)).toBe("anthropic");
		expect(nativeFamily("glm-5.3-flash")).toBe("other");
		expect(nativeFamily("gpt-oss-120b")).toBe("other");
	});
});
