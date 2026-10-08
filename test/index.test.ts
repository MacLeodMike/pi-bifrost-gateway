import { describe, expect, it } from "vitest";
import type { Model } from "@earendil-works/pi-ai";
import { gatewayAuth, bifrostProvider, discoverModels, migrateLegacyCredential, registerBifrostProvider, type BifrostRegistrationPi } from "../src/index.js";
import { UNRESOLVED_BASE_URL } from "../src/bifrost.js";

const BASE_URL = "https://llm-gateway.example.com/v1";

function chainModel(name: string): Model<"openai-completions"> {
	return {
		id: `gateway/${name}`,
		name,
		api: "openai-completions",
		provider: "gateway",
		baseUrl: BASE_URL,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		reasoning: true,
		contextWindow: 128_000,
		maxTokens: 8192,
	};
}

describe("bifrostProvider", () => {
	it("builds a provider named bifrost with retry-through-openai-completions", () => {
		const provider = bifrostProvider({ publishChains: true, publishUpstream: false, baseUrl: BASE_URL }) as unknown as {
			id: string;
			baseUrl?: string;
			getModels?: () => unknown;
		};
		expect(provider.id).toBe("bifrost");
		expect(provider.baseUrl).toBe(BASE_URL);
	});

	it("falls back to UNRESOLVED_BASE_URL when no URL is configured", () => {
		const provider = bifrostProvider({ publishChains: true, publishUpstream: false }) as unknown as {
			id: string;
			baseUrl?: string;
		};
		expect(provider.baseUrl).toBe(UNRESOLVED_BASE_URL);
	});
});

describe("gatewayAuth login", () => {
	function interaction(responses: { url?: string; key?: string }) {
		return {
			signal: new AbortController().signal,
			prompt: async (prompt: { type: string }) =>
				prompt.type === "text" ? (responses.url ?? "") : (responses.key ?? ""),
			notify: () => {},
		};
	}

	it("stores the URL in the credential env next to the key", async () => {
		const credential = await gatewayAuth().login!(interaction({ url: "https://gw.example/v1", key: "vk-secret" }));
		expect(credential).toEqual({
			type: "api_key",
			key: "vk-secret",
			env: { BIFROST_URL: "https://gw.example/v1" },
		});
	});

	it("keeps ambient resolution when the URL is left blank", async () => {
		const credential = await gatewayAuth().login!(interaction({ url: "", key: "vk-secret" }));
		expect(credential.type).toBe("api_key");
		expect(credential.key).toBe("vk-secret");
		expect(credential.env).toBeUndefined();
	});

	it("rejects a URL without an http(s) scheme", async () => {
		await expect(
			gatewayAuth().login!(interaction({ url: "gw.example/v1", key: "vk" })),
		).rejects.toThrow(/http/);
	});

	it("rejects an empty key", async () => {
		await expect(
			gatewayAuth().login!(interaction({ url: "https://gw.example/v1", key: "" })),
		).rejects.toThrow(/virtual key is required/);
	});
});

describe("gatewayAuth resolve", () => {
	function ctx(env: Record<string, string>) {
		return { env: async (name: string) => env[name], fileExists: async () => false };
	}

	it("returns the stored key and echoes the stored URL env", async () => {
		const result = await gatewayAuth().resolve!({
			ctx: ctx({}),
			credential: { type: "api_key", key: "vk-secret", env: { BIFROST_URL: "https://gw.example/v1" } },
			signal: new AbortController().signal,
		});
		expect(result?.auth.apiKey).toBe("vk-secret");
		expect(result?.env).toEqual({ BIFROST_URL: "https://gw.example/v1" });
		expect(result?.source).toContain("gateway URL");
	});

	it("resolves BIFROST_API_KEY from the environment when nothing is stored", async () => {
		const result = await gatewayAuth().resolve!({
			ctx: ctx({ BIFROST_API_KEY: "vk-env" }),
			signal: new AbortController().signal,
		});
		expect(result?.auth.apiKey).toBe("vk-env");
		expect(result?.source).toBe("BIFROST_API_KEY");
	});

	it("is unconfigured with no credential and no env", async () => {
		const result = await gatewayAuth().resolve!({
			ctx: ctx({}),
			signal: new AbortController().signal,
		});
		expect(result).toBeUndefined();
	});
});

describe("registerBifrostProvider", () => {
	it("registers the provider and the bifrost-gateway status command", () => {
		const registered: unknown[] = [];
		const commands: string[] = [];
		const pi = {
			registerProvider: (provider: unknown) => registered.push(provider),
			registerCommand: (name: string) => {
				commands.push(name);
			},
		} as unknown as BifrostRegistrationPi;

		const provider = bifrostProvider({ publishChains: true, publishUpstream: false, baseUrl: BASE_URL });
		registerBifrostProvider(pi, provider);

		expect(registered).toHaveLength(1);
		expect(commands).toEqual(["bifrost"]);
	});

	it("the status command notifies auth/config/model count via ctx", async () => {
		const notifications: string[] = [];
		let handler: ((args: string, ctx: unknown) => Promise<void>) | undefined;
		const provider = bifrostProvider({ publishChains: true, publishUpstream: false, baseUrl: BASE_URL });
		const pi = {
			registerProvider: (p: unknown) => void p,
			registerCommand: (_name: string, opts: { handler: typeof handler }) => {
				handler = opts.handler;
			},
		} as unknown as BifrostRegistrationPi;
		registerBifrostProvider(pi, provider);

		const chatModels = [chainModel("a"), chainModel("b")];
		await handler?.("", {
			ui: { notify: (message: string) => notifications.push(message) },
			modelRegistry: {
				getProviderAuthStatus: () => ({ configured: true }),
				getModelsOfType: (type: string, providerName: string) =>
					type === "chat" && providerName === "bifrost" ? chatModels : [],
			},
		});
		expect(notifications).toHaveLength(1);
		expect(notifications[0]).toContain("models loaded: 2");
		expect(notifications[0]).toContain("publishChains: true");
		expect(notifications[0]).toContain("publishUpstream: false");
	});
});

describe("discoverModels", () => {
	it("returns empty when token or baseUrl is missing", async () => {
		expect(await discoverModels(undefined, BASE_URL, true, false)).toEqual([]);
		expect(await discoverModels("token", undefined, true, false)).toEqual([]);
	});
});

describe("migrateLegacyCredential", () => {
	it("copies gateway api_key to bifrost when bifrost is absent", () => {
		const store: Record<string, unknown> = { gateway: { type: "api_key", key: "vk-a" } };
		const changed = migrateLegacyCredential(store as Record<string, { type: string; key?: string }>);
		expect(changed).toBe(true);
		expect(store.bifrost).toEqual({ type: "api_key", key: "vk-a" });
	});

	it("does nothing when bifrost already has a credential", () => {
		const store = {
			gateway: { type: "api_key", key: "old" },
			bifrost: { type: "api_key", key: "new" },
		} as unknown as Record<string, { type: string; key?: string }>;
		expect(migrateLegacyCredential(store)).toBe(false);
		expect(store.gateway.key).toBe("old");
	});

	it("does nothing when there is no gateway entry", () => {
		const store = {} as Record<string, { type: string; key?: string }>;
		expect(migrateLegacyCredential(store)).toBe(false);
	});

	it("does nothing when the gateway entry is not an api_key", () => {
		const store = { gateway: { type: "oauth", key: "x" } } as unknown as Record<string, { type: string; key?: string }>;
		expect(migrateLegacyCredential(store)).toBe(false);
	});
});
