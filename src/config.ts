import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface BifrostConfig {
	/** Emit direct-selectable member models (provider/model) alongside chain models. */
	publishMembers: boolean;
	/** Explicit gateway /v1 base URL; when set it wins over env fallbacks. */
	baseUrl?: string;
	/** Human-readable problems found while loading the file. */
	issues: string[];
}

export const CONFIG_FILE_NAME = "pi-bifrost.json";

const URL_KEYS = ["BIFROST_BASE_URL", "GATEWAY_BASE_URL"] as const;

/**
 * Load plugin config from `<agentDir>/pi-bifrost.json`.
 * Missing file = defaults; malformed file = defaults + issue; unknown keys
 * and wrong-typed values are reported but never fatal.
 */
export function loadBifrostConfig(agentDir: string): BifrostConfig {
	const issues: string[] = [];
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(join(agentDir, CONFIG_FILE_NAME), "utf8"));
	} catch (error) {
		const code = (error as NodeJS.ErrnoException)?.code;
		if (code === "ENOENT") {
			return { publishMembers: false, issues };
		}
		const message = error instanceof Error ? error.message : String(error);
		issues.push(`${CONFIG_FILE_NAME} is not valid JSON (${message}); using defaults`);
		return { publishMembers: false, issues };
	}

	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		issues.push(`${CONFIG_FILE_NAME} must contain a JSON object; using defaults`);
		return { publishMembers: false, issues };
	}

	const obj = raw as Record<string, unknown>;
	let publishMembers = false;
	let baseUrl: string | undefined;

	for (const [key, value] of Object.entries(obj)) {
		switch (key) {
			case "publishMembers":
				if (typeof value === "boolean") publishMembers = value;
				else issues.push(`publishMembers must be a boolean (got ${typeof value}); using false`);
				break;
			case "baseUrl":
				if (typeof value === "string" && value.trim().length > 0) baseUrl = value.trim();
				else issues.push(`baseUrl must be a non-empty string (got ${typeof value}); ignoring`);
				break;
			default:
				issues.push(`unknown config key "${key}"`);
				break;
		}
	}

	return { publishMembers, baseUrl, issues };
}

/**
 * Effective gateway base URL: explicit config value, then BIFROST_BASE_URL,
 * then GATEWAY_BASE_URL. `undefined` when nothing is configured.
 */
export function resolveBaseUrl(config: BifrostConfig): string | undefined {
	if (config.baseUrl) return config.baseUrl;
	for (const key of URL_KEYS) {
		const value = (globalThis.process?.env?.[key] ?? "").trim();
		if (value.length > 0) return value;
	}
	return undefined;
}
