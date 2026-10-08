import { describe, expect, it } from "vitest";
import type { Model } from "@earendil-works/pi-ai";
import { bifrostProvider, discoverModels, registerBifrostProvider, type BifrostRegistrationPi } from "../src/index.js";

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
	it("builds a provider named gateway with retry-through-openai-completions", () => {
		const provider = bifrostProvider({ publishChains: true, publishUpstream: false, baseUrl: BASE_URL }) as unknown as {
			id: string;
			baseUrl?: string;
			getModels?: () => unknown;
		};
		expect(provider.id).toBe("gateway");
		expect(provider.baseUrl).toBe(BASE_URL);
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
		expect(commands).toEqual(["bifrost-gateway"]);
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
					type === "chat" && providerName === "gateway" ? chatModels : [],
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
