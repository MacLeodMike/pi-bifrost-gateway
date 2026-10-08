import { homedir } from "node:os";
import { join } from "node:path";
import { createProvider, type Model, type Provider } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
// pi's extension loader doesn't virtualize lazy API implementation subpaths yet
import { envApiKeyAuth, openAICompletionsApi } from "@earendil-works/pi-ai/compat";
import { AUTH_ENV_KEYS, DEFAULT_BASE_URL, PROVIDER_DISPLAY_NAME, PROVIDER_ID } from "./bifrost.js";
import { loadBifrostConfig, resolveBaseUrl } from "./config.js";
import { buildAllModels, wireDiscovery, wireRulesToChains, wireScopeId } from "./catalog.js";

/**
 * Minimal registration surface `registerBifrostProvider` needs from
 * `ExtensionAPI` — the two methods the extension actually calls. Kept as an
 * exported type so the provider wiring is unit-testable without a full pi
 * runtime.
 */
export interface BifrostRegistrationPi {
	registerProvider(provider: Provider): void;
	registerCommand(
		name: string,
		options: { description?: string; handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> },
	): void;
}

/**
 * Compose the gateway model list from live Bifrost state: member catalog
 * (`/v1/models`) + this VK's routing rules → chain models (`bifrost/<chain>`)
 * and, when configured, direct-selectable member models.
 * Returns an empty list when the credential or baseUrl is missing.
 * Throws when discovery itself fails (bad credential, unreachable gateway,
 * VK not recognized) so pi surfaces the error instead of silently dropping.
 */
export async function discoverModels(
	token: string | undefined,
	baseUrl: string | undefined,
	publishChains: boolean,
	publishUpstream: boolean,
	signal?: AbortSignal,
): Promise<Model<"openai-completions">[]> {
	if (!token || !baseUrl) return [];

	const scopeId = await wireScopeId(token, baseUrl, signal);
	if (!scopeId) {
		throw new Error(
			"bifrost: credential does not match any virtual key in /api/governance/virtual-keys",
		);
	}
	const { catalog, rules } = await wireDiscovery(token, baseUrl, scopeId, signal);
	const chains = wireRulesToChains(rules);
	if (chains.length === 0) {
		throw new Error(
			`bifrost: no chain routing rules found for ${scopeId} — is chains-first routing configured for this VK?`,
		);
	}
	return buildAllModels(chains, catalog, PROVIDER_ID, baseUrl, publishChains, publishUpstream);
}

/**
 * Build the complete Provider for the gateway. `createProvider`'s
 * `fetchModels` returns the composed list; pi persists and publishes it.
 * The catalog is re-pulled on every refresh (startup, /reload, /model) —
 * live-refresh semantics by design.
 */
export function bifrostProvider(options: { publishChains: boolean; publishUpstream: boolean; baseUrl?: string }): Provider<"openai-completions"> {
	return createProvider<"openai-completions">({
		id: PROVIDER_ID,
		name: PROVIDER_DISPLAY_NAME,
		baseUrl: options.baseUrl,
		auth: { apiKey: envApiKeyAuth(PROVIDER_DISPLAY_NAME, [...AUTH_ENV_KEYS]) },
		models: [],
		api: openAICompletionsApi(),
		fetchModels: async (context) => {
			const credential = context.credential;
			const token = credential?.type === "api_key" ? credential.key : undefined;
			return discoverModels(token, options.baseUrl, options.publishChains, options.publishUpstream, context.signal);
		},
	});
}

/** Register the Bifrost gateway provider and its status command. */
export function registerBifrostProvider(pi: BifrostRegistrationPi, provider: Provider): void {
	pi.registerProvider(provider);

	pi.registerCommand("bifrost", {
		description: "Show Bifrost provider status (auth, config, chains/upstream)",
		handler: async (_args, ctx) => {
			const config = loadBifrostConfig(defaultAgentDir());
			const status = ctx.modelRegistry.getProviderAuthStatus(PROVIDER_ID);
			const lines = [
				`auth: ${status.configured ? "configured" : "missing (set BIFROST_API_KEY or run /login bifrost)"}`,
				`baseUrl: ${resolveBaseUrl(config, DEFAULT_BASE_URL)}`,
				`publishChains: ${config.publishChains}, publishUpstream: ${config.publishUpstream}`,
			];
			if (config.issues.length > 0) lines.push(`config issues: ${config.issues.join("; ")}`);
			lines.push(`models loaded: ${ctx.modelRegistry.getModelsOfType("chat", PROVIDER_ID).length}`);
			ctx.ui.notify(lines.join("\n"), status.configured ? "info" : "warning");
		},
	});
}

/** Best-effort auth.json migration; never throws into extension loading. */
function migrateStoredCredential(): void {
	try {
		const authPath = join(defaultAgentDir(), "auth.json");
		const parsed = JSON.parse(readFileSync(authPath, "utf8")) as Record<string, { type: string; key?: string }>;
		if (migrateLegacyCredential(parsed)) {
			writeFileSync(authPath, `${JSON.stringify(parsed, null, "\t")}\n`);
		}
	} catch {
		// unreadable or absent auth.json — nothing to migrate
	}
}

/** Agent dir where pi-bifrost-gateway.json lives; overridable for tests and CLI use. */
export function defaultAgentDir(): string {
	if (process.env.PI_AGENT_DIR) return process.env.PI_AGENT_DIR;
	return join(homedir(), ".pi", "agent");
}

import { readFileSync, writeFileSync } from "node:fs";

/**
 * One-time migration: copy a stored api_key from the legacy `gateway`
 * provider id to `bifrost` when `bifrost` has no credential of its own.
 * Mutates and persists the parsed auth.json object; returns whether
 * anything was written.
 */
export function migrateLegacyCredential(
	store: Record<string, { type: string; key?: string }>,
): boolean {
	const legacy = store["gateway"];
	if (legacy?.type !== "api_key" || !legacy.key) return false;
	const existing = store[PROVIDER_ID];
	if (existing?.type === "api_key" && existing.key) return false;
	store[PROVIDER_ID] = { type: "api_key", key: legacy.key };
	return true;
}

/** Pi extension entrypoint. */
export default function (pi: ExtensionAPI): void {
	migrateStoredCredential();
	const config = loadBifrostConfig(defaultAgentDir());
	const provider = bifrostProvider({
		publishChains: config.publishChains,
		publishUpstream: config.publishUpstream,
		baseUrl: resolveBaseUrl(config, DEFAULT_BASE_URL),
	});
	registerBifrostProvider(pi, provider);
}
