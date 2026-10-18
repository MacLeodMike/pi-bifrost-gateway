import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Native-protocol surface selection (client-side wire choice per model
 * family). Both toggles default false — every model publishes as chat
 * completions, the right shape for a stock gateway. When a toggle is on,
 * models matching the BUILT-IN family heuristic publish that native wire;
 * when the matching exact-name list is ALSO set, the list REPLACES the
 * built-in heuristic for that surface (list membership is the only path to
 * the native wire).
 */
export interface NativeProtocols {
	/** gpt-family models publish openai-responses (gateway must serve /v1/responses). */
	responses: boolean;
	/** claude-family models publish anthropic-messages (gateway must serve the /anthropic integration route). */
	messages: boolean;
	/** Exact bare model names ("gpt-6-luna") for the responses surface; replaces the built-in gpt heuristic. */
	responsesModels?: string[];
	/** Exact bare model names ("claude-sonnet-5-5") for the messages surface; replaces the built-in claude heuristic. */
	messagesModels?: string[];
}

export interface BifrostConfig {
	/** Emit chain models (bifrost/<chain>) from the VK's routing rules. */
	publishChains: boolean;
	/** Emit all upstream models from /v1/models as direct-selectable entries. */
	publishUpstream: boolean;
	/** Explicit gateway /v1 base URL; when set it wins over env fallbacks. */
	baseUrl?: string;
	/**
	 * Per-member thinking-level overrides, keyed by upstream member id
	 * ("provider/model"). Each list is the member's real supported ladder;
	 * when present it REPLACES the full-ladder default on direct-selectable
	 * member models of that id.
	 */
	thinkingOverrides?: Record<string, string[]>;
	/**
	 * Bearer for the management plane (/api/governance/virtual-keys,
	 * /api/routing/rules). Falls back to the inference credential (the VK)
	 * when unset — the right shape for dashboard-auth-disabled deployments
	 * where the VK itself is accepted on /api/*. Set it on deployments whose
	 * management plane expects a different credential than inference.
	 */
	managementApiKey?: string;
	/** Native-protocol surface gates (both default false — chat completions everywhere). */
	nativeProtocols?: NativeProtocols;
	/** Human-readable problems found while loading the file. */
	issues: string[];
}

/** Canonical config file for this package. */
export const CONFIG_FILE_NAME = "pi-bifrost-gateway.json";

/** Pre-rename config filename (pi-bifrost 0.1.x); still read when the canonical file is absent. */
export const LEGACY_CONFIG_FILE_NAME = "pi-bifrost.json";

const URL_KEYS = ["BIFROST_BASE_URL"] as const;

const THINKING_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevelName = (typeof THINKING_LEVELS)[number];

const VALID_LEVELS: ReadonlySet<string> = new Set<string>(THINKING_LEVELS);

function parseThinkingOverrides(raw: unknown, issues: string[]): Record<string, string[]> | undefined {
	if (raw === undefined) return undefined;
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
		issues.push("thinkingOverrides must be an object of member-id → allowed levels; ignoring");
		return undefined;
	}
	const overrides: Record<string, string[]> = {};
	for (const [memberId, levels] of Object.entries(raw as Record<string, unknown>)) {
		if (!Array.isArray(levels)) {
			issues.push(`thinkingOverrides["${memberId}"] must be an array of level strings; ignoring`);
			continue;
		}
		const valid = levels.filter((l): l is string => typeof l === "string" && VALID_LEVELS.has(l));
		if (valid.length !== levels.length) {
			// A ladder the author didn't fully know must not be half-applied:
			// the member keeps the full-map default until the override is
			// corrected.
			issues.push(`thinkingOverrides["${memberId}"] contains unknown level names; entry ignored`);
			continue;
		}
		if (valid.length > 0) overrides[memberId] = valid;
	}
	return Object.keys(overrides).length > 0 ? overrides : undefined;
}

function parseNativeProtocols(raw: unknown, issues: string[]): NativeProtocols | undefined {
	if (raw === undefined) return undefined;
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
		issues.push("nativeProtocols must be an object; ignoring");
		return undefined;
	}
	const obj = raw as Record<string, unknown>;
	const out: NativeProtocols = { responses: false, messages: false };
	let seen = false;
	for (const [key, value] of Object.entries(obj)) {
		switch (key) {
			case "responses":
			case "messages":
				if (typeof value === "boolean") {
					out[key] = value;
					seen = true;
				} else {
					issues.push(`nativeProtocols.${key} must be a boolean (got ${typeof value}); ignoring`);
				}
				break;
			case "responsesModels":
			case "messagesModels": {
				if (!Array.isArray(value) || !value.every((v) => typeof v === "string" && v.trim().length > 0)) {
					issues.push(`nativeProtocols.${key} must be an array of non-empty model names; ignoring`);
					break;
				}
				const names = (value as string[]).map((v) => v.trim());
				if (new Set(names).size !== names.length) {
					issues.push(`nativeProtocols.${key} contains duplicates; ignoring the list`);
					break;
				}
				out[key] = names;
				seen = true;
				break;
			}
			default:
				issues.push(`unknown nativeProtocols key "${key}"`);
				break;
		}
	}
	return seen ? out : undefined;
}

/**
 * Load plugin config from `<agentDir>/pi-bifrost-gateway.json`, falling back to the
 * pre-rename `pi-bifrost.json` (0.1.x install) when the canonical file is absent.
 * Missing file = defaults; malformed file = defaults + issue; unknown keys
 * and wrong-typed values are reported but never fatal.
 *
 * Defaults are CONSERVATIVE: publishChains false (a stock gateway has no
 * chains-first routing rules — chains mode would fail discovery) and both
 * native-protocol toggles false (chat completions everywhere, the only wire
 * every Bifrost serves).
 */
function readConfigFile(agentDir: string): { content: string; file: string } {
	try {
		return { content: readFileSync(join(agentDir, CONFIG_FILE_NAME), "utf8"), file: CONFIG_FILE_NAME };
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
	}
	// Canonical file absent — fall back to the pre-rename 0.1.x file so a
	// renamed install keeps working without user action.
	return { content: readFileSync(join(agentDir, LEGACY_CONFIG_FILE_NAME), "utf8"), file: LEGACY_CONFIG_FILE_NAME };
}

export function loadBifrostConfig(agentDir: string): BifrostConfig {
	const issues: string[] = [];
	let raw: unknown;
	try {
		raw = JSON.parse(readConfigFile(agentDir).content);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException)?.code;
		if (code === "ENOENT") {
			return { publishChains: false, publishUpstream: true, thinkingOverrides: undefined, issues };
		}
		const message = error instanceof Error ? error.message : String(error);
		issues.push(`${CONFIG_FILE_NAME} is not valid JSON (${message}); using defaults`);
		return { publishChains: false, publishUpstream: true, issues };
	}

	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		issues.push(`${CONFIG_FILE_NAME} must contain a JSON object; using defaults`);
		return { publishChains: false, publishUpstream: true, issues };
	}

	const obj = raw as Record<string, unknown>;
	let publishChains = false;
	let legacyMembers: boolean | undefined;
	let publishUpstream: boolean | undefined;
	let baseUrl: string | undefined;
	let thinkingOverrides: Record<string, string[]> | undefined;
	let managementApiKey: string | undefined;
	let nativeProtocols: NativeProtocols | undefined;

	for (const [key, value] of Object.entries(obj)) {
		switch (key) {
			case "publishChains":
				if (typeof value === "boolean") publishChains = value;
				else issues.push(`publishChains must be a boolean (got ${typeof value}); using false`);
				break;
			case "publishUpstream":
				if (typeof value === "boolean") {
					if (legacyMembers !== undefined && legacyMembers !== value) {
						issues.push("legacy publishMembers conflicts with publishUpstream; publishUpstream wins");
					}
					publishUpstream = value;
				} else {
					issues.push(`publishUpstream must be a boolean (got ${typeof value}); ignoring`);
				}
				break;
			case "publishMembers":
				if (typeof value !== "boolean") {
					issues.push(`publishMembers must be a boolean (got ${typeof value}); ignoring`);
					break;
				}
				if (legacyMembers === undefined) {
					legacyMembers = value;
					if (publishUpstream === undefined) {
						issues.push("publishMembers is legacy; use publishUpstream (same meaning)");
					}
				}
				break;
			case "baseUrl":
				if (typeof value === "string" && value.trim().length > 0) baseUrl = value.trim();
				else issues.push(`baseUrl must be a non-empty string (got ${typeof value}); ignoring`);
				break;
			case "thinkingOverrides":
				thinkingOverrides = parseThinkingOverrides(value, issues);
				break;
			case "managementApiKey":
				if (typeof value === "string" && value.trim().length > 0) managementApiKey = value.trim();
				else issues.push(`managementApiKey must be a non-empty string (got ${typeof value}); ignoring`);
				break;
			case "nativeProtocols":
				nativeProtocols = parseNativeProtocols(value, issues);
				break;
			default:
				issues.push(`unknown config key "${key}"`);
				break;
		}
	}

	return {
		publishChains,
		publishUpstream: publishUpstream ?? legacyMembers ?? true,
		baseUrl,
		thinkingOverrides,
		managementApiKey,
		nativeProtocols,
		issues,
	};
}

/**
 * Effective gateway base URL: explicit config value, then BIFROST_BASE_URL,
 * then nothing — the caller supplies the built-in default URL.
 */
/**
 * Ambient URL for refresh-time resolution: explicit config file wins, then
 * BIFROST_BASE_URL. NOT the full precedence — a URL captured at /login
 * (stored in the credential's env) outranks both, because it belongs to the
 * credential that will serve the request. Undefined = nothing ambient.
 */
export function resolveBaseUrl(config: BifrostConfig): string | undefined {
	if (config.baseUrl) return config.baseUrl;
	for (const key of URL_KEYS) {
		const value = (globalThis.process?.env?.[key] ?? "").trim();
		if (value.length > 0) return value;
	}
	// Explicitly undefined, not a default: an unconfigured plugin must
	// resolve to zero models (see bifrost.ts) rather than any baked-in URL.
	return undefined;
}
