import { describe, expect, it } from "vitest";
import { chainWarmingAction, isChainModel } from "../src/warming.js";

/**
 * Chain warming exists because chain models publish ZERO cost by design, so
 * pi's own cache-warming economics (`expectedSavings` vs $0.05) are
 * unavailable and the warmer always declines. These tests pin the two things
 * that can go wrong: warming a model that is NOT a chain, and failing to warm
 * one that is.
 */

const PROVIDER = "bifrost";

/** A chain as this extension publishes it: id prefixed with the provider. */
function chain(id = "bifrost/glm-5.3-flash") {
	return { id, provider: PROVIDER, cost: { input: 0, output: 0 } };
}

/** A direct-selectable member: keeps its upstream id. */
function member(id = "hyper/glm-5.3-flash", input = 0.0087) {
	return { id, provider: PROVIDER, cost: { input, output: 0.03 } };
}

describe("isChainModel", () => {
	it("recognizes chain ids", () => {
		expect(isChainModel(chain(), PROVIDER)).toBe(true);
		expect(isChainModel(chain("bifrost/deepseek-v4.1-flash"), PROVIDER)).toBe(true);
	});

	it("rejects member ids, even when their price is zero", () => {
		expect(isChainModel(member(), PROVIDER)).toBe(false);
		// 34 of 90 real members publish zero because the gateway datasheet has
		// no rate for them; cost must never be the discriminator.
		expect(isChainModel(member("hyper/deepseek-v4-flash-0731", 0), PROVIDER)).toBe(false);
	});

	it("rejects other providers and a missing model", () => {
		expect(isChainModel({ ...chain(), provider: "inferhub" }, PROVIDER)).toBe(false);
		expect(isChainModel(undefined, PROVIDER)).toBe(false);
	});
});

describe("chainWarmingAction", () => {
	const base = {
		providerId: PROVIDER,
		piAction: "stop" as const,
		missCost: 0,
		continuationProbability: 1,
	};

	it("forces a warm for a chain pi declined", () => {
		expect(chainWarmingAction({ ...base, model: chain() })).toEqual({ action: "warm" });
	});

	it("leaves a member alone (pi's economics or lack of them stay decisive)", () => {
		expect(chainWarmingAction({ ...base, model: member() })).toEqual({});
		// unpriced member: still not a chain, so still not ours to force
		expect(chainWarmingAction({ ...base, model: member("hyper/x", 0) })).toEqual({});
	});

	it("never overrides a model from another provider", () => {
		expect(chainWarmingAction({ ...base, model: { ...chain(), provider: "hyper" } })).toEqual({});
	});

	it("never overrides a model the session does not have", () => {
		expect(chainWarmingAction({ ...base, model: undefined })).toEqual({});
	});

	it("does not second-guess pi when pi already chose warm", () => {
		expect(chainWarmingAction({ ...base, piAction: "warm", model: chain() })).toEqual({});
	});

	it("does not warm once the agent is idle", () => {
		// pi reports 1 while streaming and 0.15 when idle; refreshing an idle
		// session buys nothing a later turn will collect.
		expect(chainWarmingAction({ ...base, continuationProbability: 0.15, model: chain() })).toEqual({});
	});

	it("steps aside when pi produced real economics", () => {
		// Non-zero missCost means pi HAD prices to work with; its $0.05
		// threshold is doing useful work and must win.
		expect(chainWarmingAction({ ...base, missCost: 0.4, model: chain() })).toEqual({});
	});
});
