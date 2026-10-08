/** Gateway constants: model id / endpoints. */

export const PROVIDER_ID = "bifrost";
export const PROVIDER_DISPLAY_NAME = "Bifrost Gateway";

/** Different relative to the configured /v1 base URL. */
export const INFERENCE_PATH_MODELS = "models";

/**
 * No built-in default URL. The gateway address comes from /login (stored on
 * the credential), the config file, or BIFROST_BASE_URL env. An install in
 * none of those states must resolve to zero models (no network), never to a
 * baked-in deployment address that would silently route another user's
 * inference through a gateway they don't own.
 */

/**
 * Neutral createProvider-shape baseUrl used before a URL exists from any
 * source above. NEVER requested: every published model carries its own
 * discovery-time baseUrl, and discovery resolves the URL from
 * credential-env → config → env before any fetch. An install in this state
 * publishes zero models.
 */
export const UNRESOLVED_BASE_URL = "http://localhost:8080/v1";

/** Management API paths (2026-10-08 live-verified on Bifrost v2.2.x). */
export const MANAGEMENT_PATH_VIRTUAL_KEYS = "/api/governance/virtual-keys";
export const MANAGEMENT_PATH_ROUTING_RULES = "/api/routing/rules";

/** Auth: env var for the virtual keys value; /login bifrost is the fallback. */
export const AUTH_ENV_KEYS = ["BIFROST_API_KEY"] as const;
