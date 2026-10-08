import { describe, expect, it } from "vitest";
import {
	wireCatalogToModels,
	wireRulesToChains,
	buildChainModels,
	buildMemberModels,
	buildAllModels,
} from "../src/catalog.js";
import type { CatalogModel, RoutingRule } from "../src/catalog.js";

const GATEWAY_ID = "gateway";

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
		cel_expression: cel ?? `model == "${name}" || model == "gateway/${name}"`,
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
	it("builds gateway/<chain> entries with min context window and zero cost", () => {
		const catalog = [
			memberModel("hyper/glm-5.3-flash", { context_length: 1_000_000 }),
			memberModel("pareto/glm-5.3-flash", { context_length: 500_000 }),
		];
		const chains = [{ name: "glm-5.3-flash", primary: "hyper/glm-5.3-flash", fallbacks: ["pareto/glm-5.3-flash"] }];
		const models = buildChainModels(chains, catalog, GATEWAY_ID, BASE_URL);
		expect(models).toHaveLength(1);
		const m = models[0]!;
		expect(m.id).toBe("gateway/glm-5.3-flash");
		expect(m.provider).toBe(GATEWAY_ID);
		expect(m.baseUrl).toBe(BASE_URL);
		expect(m.contextWindow).toBe(500_000);
		expect(m.cost.input).toBe(0);
		expect(m.cost.output).toBe(0);
		expect(m.reasoning).toBe(true);
		expect(m.input).toEqual(["text"]);
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
		expect(models[0]?.id).toBe("gateway/glm-5.3-flash");
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

	it("is empty when publishMembers is false", () => {
		expect(buildMemberModels([], [], GATEWAY_ID, BASE_URL)).toEqual([]);
	});
});

describe("buildAllModels", () => {
	it("chains first, then members, deduped", () => {
		const catalog = [memberModel("hyper/glm-5.3-flash")];
		const chains = [{ name: "glm-5.3-flash", primary: "hyper/glm-5.3-flash", fallbacks: [] }];
		const all = buildAllModels(chains, catalog, GATEWAY_ID, BASE_URL, true, false);
		expect(all.map((m) => m.id)).toEqual(["gateway/glm-5.3-flash"]);

		const allWithMembers = buildAllModels(chains, catalog, GATEWAY_ID, BASE_URL, true, true);
		expect(allWithMembers.map((m) => m.id)).toEqual(["gateway/glm-5.3-flash", "hyper/glm-5.3-flash"]);
	});
});
