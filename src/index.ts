import { homedir } from "node:os";
import { join } from "node:path";
import {
	createProvider,
	type ApiKeyAuth,
	type Model,
	type Provider,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
// pi's extension loader doesn't virtualize lazy API implementation subpaths yet
import { openAICompletionsApi } from "@earendil-works/pi-ai/compat";
import { AUTH_ENV_KEYS, PROVIDER_DISPLAY_NAME, PROVIDER_ID, UNRESOLVED_BASE_URL } from "./bifrost.js";
import { loadBifrostConfig, resolveBaseUrl } from "./config.js";
import { buildAllModels, wireDiscovery, wireRulesToChains, wireScopeId } from "./catalog.js";

/** Credential env key carrying the gateway URL captured at /login. */
const CRED_ENV_URL = "BIFROST_URL";

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
 * Auth for the gateway: the virtual-key value AND, captured at /login, the
 * gateway URL itself.
 *
 * URL precedence is credential-owned > ambient (config file baseUrl, then
 * BIFROST_BASE_URL): a URL captured at login is stored on the credential
 * that will serve requests, so it must outrank ambient config that could
 * describe a different deployment. Exported for the same test-seam reason
 * as discoverModels: the pi-ai interaction types are impractical to fake
 * through a full provider runtime.
 */
export function gatewayAuth(): ApiKeyAuth {
	return {
		name: `${PROVIDER_DISPLAY_NAME} virtual key`,
		async login(interaction) {
			interaction.notify({
				type: "info",
				message: "Configure your Bifrost gateway. The URL is stored with the credential; ambient config/env remain as fallback.",
			});
			const rawUrl = (
				await interaction.prompt({
					type: "text",
					message: `Gateway base URL (ends in /v1; blank to keep ambient config)`,
					placeholder: "https://your-bifrost.example/v1",
				})
			).trim();
			if (rawUrl && !/^https?:\/\//.test(rawUrl)) {
				throw new Error(`bifrost: gateway URL must start with http:// or https:// (got "${rawUrl}")`);
			}
			const key = (
				await interaction.prompt({
					type: "secret",
					message: `Virtual key (BIFROST_API_KEY)`,
				})
			).trim();
			if (!key) throw new Error("bifrost: login cancelled — a virtual key is required");
			// URL persists in the credential's provider-scoped env bag exactly
			// so refresh can pick it up on machines where the config file is
			// absent; key material stays in the key field, never in env.
			return {
				type: "api_key",
				key,
				env: rawUrl ? { [CRED_ENV_URL]: rawUrl } : undefined,
			};
		},
		async resolve({ ctx, credential }) {
			const key = credential?.type === "api_key" ? credential.key : undefined;
			const credUrl =
				credential?.type === "api_key" ? (credential.env?.[CRED_ENV_URL] ?? undefined) : undefined;
			if (!key) {
				const envKey = await ctx.env(AUTH_ENV_KEYS[0]!);
				if (!envKey) return undefined;
				return {
					auth: { apiKey: envKey },
					source: AUTH_ENV_KEYS[0],
				};
			}
			return {
				auth: { apiKey: key },
				env: credUrl ? { [CRED_ENV_URL]: credUrl } : undefined,
				source: credUrl ? "stored bifrost credential (key + gateway URL)" : "stored bifrost credential",
			};
		},
	};
}

/**
 * Compose the gateway model list from live Bifrost state: member catalog
 * (`/v1/models`) + this VK's routing rules → chain models (`bifrost/<chain>`)
 * and, when configured, direct-selectable member models.
 * Returns an empty list when the credential or baseUrl is missing.
 * When `thinkingOverrides` carries an entry for a member id, that member's
 * direct-selectable model ships the override ladder instead of the full one
 * (a member that rejects effort levels it doesn't support would otherwise
 * 400 every effort-pinned request).
 * Throws when discovery itself fails (bad credential, unreachable gateway,
 * VK not recognized) so pi surfaces the error instead of silently dropping.
 */
export async function discoverModels(
	token: string | undefined,
	baseUrl: string | undefined,
	publishChains: boolean,
	publishUpstream: boolean,
	thinkingOverrides?: Record<string, string[]>,
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
	return buildAllModels(chains, catalog, PROVIDER_ID, baseUrl, publishChains, publishUpstream, thinkingOverrides);
}

/**
 * Build the complete Provider for the gateway. `createProvider`'s
 * `fetchModels` returns the composed list; pi persists and publishes it.
 * The catalog is re-pulled on every refresh (startup, /reload, /model) —
 * live-refresh semantics by design.
 */
export function bifrostProvider(options: {
	publishChains: boolean;
	publishUpstream: boolean;
	baseUrl?: string;
	thinkingOverrides?: Record<string, string[]>;
}): Provider<"openai-completions"> {
	return createProvider<"openai-completions">({
		id: PROVIDER_ID,
		name: PROVIDER_DISPLAY_NAME,
		// UNRESOLVED_BASE_URL (see bifrost.ts) satisfies createProvider's
		// shape before any URL exists; it is never requested — discovery
		// resolves the real URL below, and every published model carries it.
		baseUrl: options.baseUrl ?? UNRESOLVED_BASE_URL,
		auth: { apiKey: gatewayAuth() },
		models: [],
		api: openAICompletionsApi(),
		fetchModels: async (context) => {
			const credential = context.credential?.type === "api_key" ? context.credential : undefined;
			const token = credential?.key;
			// URL precedence: a URL captured at /login (stored on the
			// credential) wins — it was typed alongside the key that serves
			// requests. Config-file baseUrl is the ambient fallback, then
			// BIFROST_BASE_URL. Leaving the URL blank at /login keeps ambient
			// resolution, so the config file remains a working no-credential-edit pin.
			const url =
				credential?.env?.[CRED_ENV_URL] ??
				options.baseUrl ??
				(process.env.BIFROST_BASE_URL || undefined);
			return discoverModels(
				token,
				url,
				options.publishChains,
				options.publishUpstream,
				options.thinkingOverrides,
				context.signal,
			);
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
				`auth: ${status.configured ? "configured" : "missing (run /login bifrost or set BIFROST_API_KEY)"}`,
				`baseUrl (config/env): ${resolveBaseUrl(config) ?? "<unset — /login bifrost can store it, or set baseUrl / BIFROST_BASE_URL>"}`,
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
	// Registered even with no URL anywhere: /login must be reachable, and it
	// stores the URL on the credential for the next refresh. Until a URL and
	// key exist, fetchModels returns [] without any network — an unconfigured
	// install publishes zero models.
	const provider = bifrostProvider({
		publishChains: config.publishChains,
		publishUpstream: config.publishUpstream,
		baseUrl: resolveBaseUrl(config),
		thinkingOverrides: config.thinkingOverrides,
	});
	registerBifrostProvider(pi, provider);
}
