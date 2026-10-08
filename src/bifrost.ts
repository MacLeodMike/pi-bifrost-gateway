/** Gateway constants: model id / endpoints. */

export const PROVIDER_ID = "gateway";
export const PROVIDER_DISPLAY_NAME = "Bifrost Gateway";

/** Inference path: OpenAI-compatible /v1 prefix (models + chat completions). */
export const INFERENCE_PATH_MODELS = "/v1/models";

/** Management API paths (2026-10-08 live-verified on Bifrost v2.2.x). */
export const MANAGEMENT_PATH_VIRTUAL_KEYS = "/api/governance/virtual-keys";
export const MANAGEMENT_PATH_ROUTING_RULES = "/api/routing/rules";

/** Auth: env var for the virtual keys value; /login bifrost is the fallback. */
export const AUTH_ENV_KEYS = ["GATEWAY_API_KEY"] as const;
