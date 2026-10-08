/** Gateway constants: model id / endpoints. */

export const PROVIDER_ID = "bifrost";
export const PROVIDER_DISPLAY_NAME = "Bifrost Gateway";

/** Different relative to the configured /v1 base URL. */
export const INFERENCE_PATH_MODELS = "models";

/**
 * No built-in default URL. The gateway address is user configuration:
 * baseUrl in the config file, else BIFROST_BASE_URL env, else unset. An
 * unconfigured plugin must resolve to zero models (no network), never to a
 * baked-in deployment address that would silently route another user's
 * inference through a gateway they don't own.
 */

/** Management API paths (2026-10-08 live-verified on Bifrost v2.2.x). */
export const MANAGEMENT_PATH_VIRTUAL_KEYS = "/api/governance/virtual-keys";
export const MANAGEMENT_PATH_ROUTING_RULES = "/api/routing/rules";

/** Auth: env var for the virtual keys value; /login bifrost is the fallback. */
export const AUTH_ENV_KEYS = ["BIFROST_API_KEY"] as const;
