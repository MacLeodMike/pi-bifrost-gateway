/**
 * Cache-warming policy for gateway chains.
 *
 * pi decides whether to refresh an expiring prompt-cache entry from the
 * model's own prices: `expectedSavings = continuationProbability * missCost -
 * warmCost`, and it warms only when that clears $0.05. Chain models publish
 * ZERO cost by design — pi cannot know which member served a chain request, so
 * inventing a rate would be a fabricated number — which makes both sides of
 * that subtraction zero: `economicsAvailable` is false and pi's answer is
 * always "stop". Warming therefore never fires for `bifrost/<chain>`, the very
 * models this extension exists to provide, and a long tool call or subagent
 * wait lets the entry lapse into a full-price write at the next turn.
 *
 * The extension cannot recover pi's economics: the decision event carries
 * costs, not the real billed rate of whichever member answered. So this rule
 * does not pretend to. It opts chains out of the estimate the only way that is
 * not a lie — warm while a run is streaming, when a follow-up turn is
 * imminent — and stays silent everywhere else.
 *
 * That distinction matters for cost. pi reports `continuationProbability` 1
 * while the agent is streaming and 0.15 once it is idle, so gating on 1 keeps
 * refreshes inside an active run and never pays to keep a session nobody is
 * driving warm. A refresh is a cache read of the prefix; far cheaper than the
 * cache write it replaces, but not free, which is why this is behind a config
 * flag rather than silently on.
 */

import type { Model } from "@earendil-works/pi-ai";

/** A `continuationProbability` of 1 means pi is mid-run (its "streaming" phase). */
const STREAMING_CONTINUATION_PROBABILITY = 1;

/**
 * Chain models are the ones this extension publishes as
 * `${providerId}/${chainName}`; direct-selectable member models keep their
 * upstream id (`hyper/glm-5.3-flash`, `inferhub-openai/gpt-6-luna`, ...). The
 * provider-id prefix is therefore the exact discriminator.
 *
 * Cost is deliberately NOT the test. Zero pricing does not mean "chain": 34 of
 * 90 real upstream members are also published at zero (the gateway datasheet
 * carries no rate for them), and warming those would spend money on models pi
 * merely believes are free — while getting the pricing wrong in the process.
 */
export function isChainModel(
	model: Pick<Model<string>, "provider" | "id"> | undefined,
	providerId: string,
): boolean {
	if (!model || model.provider !== providerId) return false;
	return model.id.startsWith(`${providerId}/`);
}

/**
 * Decide an override for one `cache_warming_decision`.
 *
 * Returns `{ action: "warm" }` to force a refresh, or `{}` to leave pi's own
 * decision standing. Every early return is a case this rule has no business
 * touching.
 */
export function chainWarmingAction(args: {
	providerId: string;
	/** The session's current model (`ctx.model`). */
	model: Pick<Model<string>, "provider" | "id"> | undefined;
	piAction: "warm" | "stop";
	/** pi's computed avoided-miss cost; 0 when it had no prices to work with. */
	missCost: number;
	/** pi's estimate that a follow-up turn arrives before expiry. */
	continuationProbability: number;
}): { action: "warm" } | Record<string, never> {
	// pi already decided to warm — there is nothing to override.
	if (args.piAction !== "stop") return {};
	if (!isChainModel(args.model, args.providerId)) return {};
	// Non-zero missCost means pi HAD prices, so its $0.05 threshold is doing
	// real work. Leave it alone; this rule exists only for the unpriced case.
	if (args.missCost !== 0) return {};
	// Only while a run is streaming. Once idle, pi's 0.15 continuation
	// estimate applies to a session nobody may touch again, and refreshes
	// would accumulate with no turn to pay them back.
	if (args.continuationProbability < STREAMING_CONTINUATION_PROBABILITY) return {};
	return { action: "warm" };
}
