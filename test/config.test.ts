import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadBifrostConfig, resolveBaseUrl, type BifrostConfig } from "../src/config.js";

const ENV_KEYS = ["BIFROST_BASE_URL", "GATEWAY_BASE_URL"] as const;

function tempAgentDir(): string {
	return mkdtempSync(join(tmpdir(), "pi-bifrost-test-"));
}

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
	afterEach(() => {
		rmSync(join(tmpdir(), "pi-bifrost-test-fixture"), { force: true, recursive: true });
	});

	it("returns defaults when the config file is absent", () => {
		const dir = tempAgentDir();
		try {
			const cfg = loadBifrostConfig(dir);
			expect(cfg.publishMembers).toBe(false);
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});

	it("reads publishMembers from the config file", () => {
		const dir = tempAgentDir();
		writeFileSync(join(dir, "pi-bifrost.json"), JSON.stringify({ publishMembers: true }));
		try {
			expect(loadBifrostConfig(dir).publishMembers).toBe(true);
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});

	it("reads baseUrl override from the config file", () => {
		const dir = tempAgentDir();
		writeFileSync(
			join(dir, "pi-bifrost.json"),
			JSON.stringify({ baseUrl: "https://gw.example.com/v1" }),
		);
		try {
			expect(loadBifrostConfig(dir).baseUrl).toBe("https://gw.example.com/v1");
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});

	it("adds unknown keys to the issues list", () => {
		const dir = tempAgentDir();
		writeFileSync(
			join(dir, "pi-bifrost.json"),
			JSON.stringify({ publishMembers: false, nope: 1, publish: false }),
		);
		try {
			const cfg = loadBifrostConfig(dir);
			expect(cfg.issues.join(" ")).toContain("nope");
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});

	it("flags a non-boolean publishMembers as an issue and keeps the default", () => {
		const dir = tempAgentDir();
		writeFileSync(join(dir, "pi-bifrost.json"), JSON.stringify({ publishMembers: "yes" }));
		try {
			const cfg = loadBifrostConfig(dir);
			expect(cfg.publishMembers).toBe(false);
			expect(cfg.issues.length).toBeGreaterThan(0);
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});

	it("flags a non-string baseUrl as an issue and drops it", () => {
		const dir = tempAgentDir();
		writeFileSync(join(dir, "pi-bifrost.json"), JSON.stringify({ baseUrl: 42 }));
		try {
			const cfg = loadBifrostConfig(dir);
			expect(cfg.baseUrl).toBeUndefined();
			expect(cfg.issues.length).toBeGreaterThan(0);
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});

	it("does not throw on malformed JSON; reports the parse failure", () => {
		const dir = tempAgentDir();
		writeFileSync(join(dir, "pi-bifrost.json"), "{ not json");
		try {
			const cfg = loadBifrostConfig(dir);
			expect(cfg.publishMembers).toBe(false);
			expect(cfg.issues.length).toBeGreaterThan(0);
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});

	it("does not throw when the json is an array (wrong shape)", () => {
		const dir = tempAgentDir();
		writeFileSync(join(dir, "pi-bifrost.json"), "[1,2]");
		try {
			const cfg = loadBifrostConfig(dir);
			expect(cfg.publishMembers).toBe(false);
			expect(cfg.issues.length).toBeGreaterThan(0);
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});
});

describe("resolveBaseUrl", () => {
	it("prefers explicit config baseUrl", () => {
		expect(
			resolveBaseUrl({ publishMembers: false, baseUrl: "https://cfg.example.com/v1", issues: [] }),
		).toBe("https://cfg.example.com/v1");
	});

	it("falls back to BIFROST_BASE_URL env", () => {
		withEnv({ BIFROST_BASE_URL: "https://env-bf.example.com/v1" }, () => {
			expect(resolveBaseUrl({ publishMembers: false, issues: [] })).toBe("https://env-bf.example.com/v1");
		});
	});

	it("falls back to GATEWAY_BASE_URL when BIFROST_BASE_URL is unset", () => {
		withEnv({ GATEWAY_BASE_URL: "https://env-gw.example.com/v1" }, () => {
			expect(resolveBaseUrl({ publishMembers: false, issues: [] })).toBe("https://env-gw.example.com/v1");
		});
	});

	it("BIFROST_BASE_URL wins over GATEWAY_BASE_URL", () => {
		withEnv(
			{ BIFROST_BASE_URL: "https://env-bf.example.com/v1", GATEWAY_BASE_URL: "https://env-gw.example.com/v1" },
			() => {
				expect(resolveBaseUrl({ publishMembers: false, issues: [] })).toBe("https://env-bf.example.com/v1");
			},
		);
	});

	it("returns a typed error reference (undefined) when nothing is set", () => {
		withEnv({}, () => {
			expect(resolveBaseUrl({ publishMembers: false, issues: [] })).toBeUndefined();
		});
	});

	it("accepts a config with url for the type (structural check)", () => {
		const cfg: BifrostConfig = { publishMembers: true, baseUrl: "https://x/v1", issues: [] };
		expect(cfg.baseUrl).toBe("https://x/v1");
	});
});
