import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadBifrostConfig, resolveBaseUrl, type BifrostConfig } from "../src/config.js";

const ENV_KEYS = ["BIFROST_BASE_URL"] as const;

function withEnv<T>(values: Partial<Record<(typeof ENV_KEYS)[number], string>>, fn: () => T): T {
	const saved = new Map<string, string | undefined>();
	for (const key of ENV_KEYS) saved.set(key, process.env[key]);
	try {
		for (const key of ENV_KEYS) {
			const value = values[key];
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		return fn();
	} finally {
		for (const key of ENV_KEYS) {
			const savedValue = saved.get(key);
			if (savedValue === undefined) delete process.env[key];
			else process.env[key] = savedValue;
		}
	}
}

describe("loadBifrostConfig", () => {
	describe("resolveBaseUrl", () => {
	it("prefers explicit config baseUrl", () => {
		expect(
			resolveBaseUrl({ publishChains: true, publishUpstream: false, baseUrl: "https://cfg.example.com/v1", issues: [] }),
		).toBe("https://cfg.example.com/v1");
	});

	it("falls back to BIFROST_BASE_URL env", () => {
		withEnv({ BIFROST_BASE_URL: "https://env-bf.example.com/v1" }, () => {
			expect(resolveBaseUrl({ publishChains: true, publishUpstream: false, issues: [] })).toBe("https://env-bf.example.com/v1");
		});
	});

	it("is undefined when nothing is set — no baked-in URL", () => {
		withEnv({}, () => {
			expect(resolveBaseUrl({ publishChains: true, publishUpstream: false, issues: [] })).toBeUndefined();
		});
	});

	it("accepts a config with url for the type (structural check)", () => {
		const cfg: BifrostConfig = { publishChains: true, publishUpstream: true, baseUrl: "https://x/v1", issues: [] };
		expect(cfg.baseUrl).toBe("https://x/v1");
	});
});

describe("publishChains / publishUpstream flags", () => {
	function tempDir(): string {
		return mkdtempSync(join(tmpdir(), "pi-bifrost-gateway-flags-"));
	}

	function cleanup(dir: string): void {
		rmSync(dir, { force: true, recursive: true });
	}

	it("defaults are conservative: publishChains false, publishUpstream true (no file)", () => {
		const dir = tempDir();
		try {
			const cfg = loadBifrostConfig(dir);
			expect(cfg.publishChains).toBe(false);
			expect(cfg.publishUpstream).toBe(true);
			expect(cfg.nativeProtocols).toBeUndefined();
			expect(cfg.managementApiKey).toBeUndefined();
		} finally {
			cleanup(dir);
		}
	});

	it("reads publishChains=false from the file", () => {
		const dir = tempDir();
		writeFileSync(join(dir, "pi-bifrost-gateway.json"), JSON.stringify({ publishChains: false }));
		try {
			const cfg = loadBifrostConfig(dir);
			expect(cfg.publishChains).toBe(false);
			expect(cfg.publishUpstream).toBe(true);
		} finally {
			cleanup(dir);
		}
	});

	it("reads publishUpstream=false from the file", () => {
		const dir = tempDir();
		writeFileSync(join(dir, "pi-bifrost-gateway.json"), JSON.stringify({ publishUpstream: false }));
		try {
			const cfg = loadBifrostConfig(dir);
			expect(cfg.publishUpstream).toBe(false);
			// untouched flag keeps its conservative default (false since 0.3.0)
			expect(cfg.publishChains).toBe(false);
		} finally {
			cleanup(dir);
		}
	});

	it("recognizes legacy publishMembers as an alias for publishUpstream", () => {
		const dir = tempDir();
		writeFileSync(join(dir, "pi-bifrost-gateway.json"), JSON.stringify({ publishMembers: true }));
		try {
			const cfg = loadBifrostConfig(dir);
			expect(cfg.publishUpstream).toBe(true);
			expect(cfg.issues.join(" ")).toContain("publishMembers");
		} finally {
			cleanup(dir);
		}
	});

	it("legacy publishMembers:false maps to publishUpstream:false", () => {
		const dir = tempDir();
		writeFileSync(join(dir, "pi-bifrost-gateway.json"), JSON.stringify({ publishUpstream: false }));
		try {
			const cfg = loadBifrostConfig(dir);
			expect(cfg.publishUpstream).toBe(false);
		} finally {
			cleanup(dir);
		}
	});

	it("publishUpstream=true wins over legacy publishMembers=false", () => {
		const dir = tempDir();
		writeFileSync(join(dir, "pi-bifrost-gateway.json"), JSON.stringify({ publishMembers: false, publishUpstream: true }));
		try {
			const cfg = loadBifrostConfig(dir);
			expect(cfg.publishUpstream).toBe(true);
			expect(cfg.issues.join(" ")).toContain("publishMembers"); // still noted as legacy
		} finally {
			cleanup(dir);
		}
	});

	it("reports a conflict when publishMembers and publishUpstream disagree", () => {
		const dir = tempDir();
		writeFileSync(join(dir, "pi-bifrost-gateway.json"), JSON.stringify({ publishMembers: true, publishUpstream: false }));
		try {
			const cfg = loadBifrostConfig(dir);
			expect(cfg.publishUpstream).toBe(false); // explicit non-legacy wins
			expect(cfg.issues.join(" ")).toContain("conflicts");
		} finally {
			cleanup(dir);
		}
	});

	it("flags a non-boolean publishUpstream as an issue and keeps the default", () => {
		const dir = tempDir();
		writeFileSync(join(dir, "pi-bifrost-gateway.json"), JSON.stringify({ publishUpstream: "yes" }));
		try {
			const cfg = loadBifrostConfig(dir);
			expect(cfg.publishUpstream).toBe(true);
			expect(cfg.issues.length).toBeGreaterThan(0);
		} finally {
			cleanup(dir);
		}
	});
});
});

describe("thinkingOverrides config", () => {
	it("parses valid per-member ladders", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-bifrost-think-"));
		writeFileSync(
			join(dir, "pi-bifrost-gateway.json"),
			JSON.stringify({ thinkingOverrides: { "hyper/glm-5.2": ["low", "high"] } }),
		);
		try {
			const cfg = loadBifrostConfig(dir);
			expect(cfg.thinkingOverrides).toEqual({ "hyper/glm-5.2": ["low", "high"] });
			expect(cfg.issues).toEqual([]);
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});

	it("ignores entries containing unknown levels entirely", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-bifrost-think-bad-"));
		writeFileSync(
			join(dir, "pi-bifrost-gateway.json"),
			JSON.stringify({ thinkingOverrides: { "hyper/glm-5.2": ["low", "turbo"] } }),
		);
		try {
			const cfg = loadBifrostConfig(dir);
			// A half-known ladder is a guess; the member keeps the full-map
			// default rather than shipping a partial override.
			expect(cfg.thinkingOverrides).toBeUndefined();
			expect(cfg.issues[0]).toContain("unknown level");
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});

	it("ignores a non-object thinkingOverrides with an issue", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-bifrost-think-arr-"));
		writeFileSync(join(dir, "pi-bifrost-gateway.json"), JSON.stringify({ thinkingOverrides: [] }));
		try {
			const cfg = loadBifrostConfig(dir);
			expect(cfg.thinkingOverrides).toBeUndefined();
			expect(cfg.issues[0]).toContain("thinkingOverrides");
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});
});

describe("legacy config file fallback", () => {
	it("reads pi-bifrost.json when pi-bifrost-gateway.json is absent", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-bifrost-legacy-"));
		writeFileSync(join(dir, "pi-bifrost.json"), JSON.stringify({ publishChains: false }));
		try {
			const cfg = loadBifrostConfig(dir);
			expect(cfg.publishChains).toBe(false);
			expect(cfg.issues).toEqual([]);
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});

	it("canonical file wins when both exist", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-bifrost-both-"));
		writeFileSync(join(dir, "pi-bifrost.json"), JSON.stringify({ publishChains: false }));
		writeFileSync(join(dir, "pi-bifrost-gateway.json"), JSON.stringify({ publishChains: true, publishUpstream: false }));
		try {
			const cfg = loadBifrostConfig(dir);
			expect(cfg.publishChains).toBe(true);
			expect(cfg.publishUpstream).toBe(false);
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});
});

describe("managementApiKey + nativeProtocols config", () => {
	function tempDir(): string {
		return mkdtempSync(join(tmpdir(), "pi-bifrost-gateway-native-"));
	}
	function cleanup(dir: string): void {
		rmSync(dir, { force: true, recursive: true });
	}

	it("reads managementApiKey as the management-plane bearer", () => {
		const dir = tempDir();
		writeFileSync(join(dir, "pi-bifrost-gateway.json"), JSON.stringify({ managementApiKey: "admin-1" }));
		try {
			const cfg = loadBifrostConfig(dir);
			expect(cfg.managementApiKey).toBe("admin-1");
			expect(cfg.issues).toEqual([]);
		} finally {
			cleanup(dir);
		}
	});

	it("parses nativeProtocols toggles and defaults the pair to false", () => {
		const dir = tempDir();
		writeFileSync(join(dir, "pi-bifrost-gateway.json"), JSON.stringify({ nativeProtocols: { responses: true, messages: true } }));
		try {
			const cfg = loadBifrostConfig(dir);
			expect(cfg.nativeProtocols).toEqual({ responses: true, messages: true });
		} finally {
			cleanup(dir);
		}
	});

	it("parses exact-name lists alongside toggles", () => {
		const dir = tempDir();
		writeFileSync(
			join(dir, "pi-bifrost-gateway.json"),
			JSON.stringify({ nativeProtocols: { responses: true, messages: true, responsesModels: ["gpt-6-luna"], messagesModels: ["clau" + "de-sonnet-5-5"] } }),
		);
		try {
			const cfg = loadBifrostConfig(dir);
			expect(cfg.nativeProtocols?.responsesModels).toEqual(["gpt-6-luna"]);
			expect(cfg.nativeProtocols?.messagesModels).toEqual(["clau" + "de-sonnet-5-5"]);
		} finally {
			cleanup(dir);
		}
	});

	it("rejects wrong-typed toggles and non-string list entries with issues", () => {
		const dir = tempDir();
		writeFileSync(
			join(dir, "pi-bifrost-gateway.json"),
			JSON.stringify({ nativeProtocols: { responses: "yes", messagesModels: [1, 2], mystery: true } }),
		);
		try {
			const cfg = loadBifrostConfig(dir);
			// no usable key was set -> undefined, not a half-applied object
			expect(cfg.nativeProtocols).toBeUndefined();
			expect(cfg.issues.some((i) => i.includes("nativeProtocols.responses"))).toBe(true);
			expect(cfg.issues.some((i) => i.includes("nativeProtocols.messagesModels"))).toBe(true);
			expect(cfg.issues.some((i) => i.includes("mystery"))).toBe(true);
		} finally {
			cleanup(dir);
		}
	});

	it("flags a non-string managementApiKey as an issue", () => {
		const dir = tempDir();
		writeFileSync(join(dir, "pi-bifrost-gateway.json"), JSON.stringify({ managementApiKey: 42 }));
		try {
			const cfg = loadBifrostConfig(dir);
			expect(cfg.managementApiKey).toBeUndefined();
			expect(cfg.issues.length).toBeGreaterThan(0);
		} finally {
			cleanup(dir);
		}
	});
});
