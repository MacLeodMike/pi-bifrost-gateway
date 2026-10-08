import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadBifrostConfig, resolveBaseUrl, type BifrostConfig } from "../src/config.js";
import { DEFAULT_BASE_URL } from "../src/bifrost.js";

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
			resolveBaseUrl({ publishChains: true, publishUpstream: false, baseUrl: "https://cfg.example.com/v1", issues: [] }, DEFAULT_BASE_URL),
		).toBe("https://cfg.example.com/v1");
	});

	it("falls back to BIFROST_BASE_URL env", () => {
		withEnv({ BIFROST_BASE_URL: "https://env-bf.example.com/v1" }, () => {
			expect(resolveBaseUrl({ publishChains: true, publishUpstream: false, issues: [] }, DEFAULT_BASE_URL)).toBe("https://env-bf.example.com/v1");
		});
	});

	it("falls back to DEFAULT_BASE_URL when nothing is set", () => {
		withEnv({}, () => {
			expect(resolveBaseUrl({ publishChains: true, publishUpstream: false, issues: [] }, DEFAULT_BASE_URL)).toBe(DEFAULT_BASE_URL);
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

	it("defaults to both true when no config file exists", () => {
		const dir = tempDir();
		try {
			const cfg = loadBifrostConfig(dir);
			expect(cfg.publishChains).toBe(true);
			expect(cfg.publishUpstream).toBe(true);
			expect(cfg.publishUpstream).toBe(true);
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
			expect(cfg.publishChains).toBe(true);
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
