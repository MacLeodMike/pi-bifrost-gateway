/** Gateway constants: model id / endpoints. */

export const PROVIDER_ID = "bifrost";
export const PROVIDER_DISPLAY_NAME = "Bifrost Gateway";

/** Different relative to the configured /v1 base URL. */
export const INFERENCE_PATH_MODELS = "models";

/**
 * Deployed gateway URL (tailscale L7 ingress, LE cert). Overridable via
 * config baseUrl, then BIFROST_BASE_URL env.
 */
export const DEFAULT_BASE_URL = "https://bifrost.example.invalid/v1";

/** Management API paths (2026-10-08 live-verified on Bifrost v2.2.x). */
export const MANAGEMENT_PATH_VIRTUAL_KEYS = "/api/governance/virtual-keys";
export const MANAGEMENT_PATH_ROUTING_RULES = "/api/routing/rules";

/** Auth: env var for the virtual keys value; /login bifrost is the fallback. */
export const AUTH_ENV_KEYS = ["BIFROST_API_KEY"] as const;
