import type { PersonVault } from "./vault";

export interface Env {
	ASSETS: Fetcher;
	PERSON_VAULT: DurableObjectNamespace<PersonVault>;
	/** JSON: {"callum.libbyhd.org":"callum", ...}. Host -> person key. */
	HOST_PERSON_MAP: string;
	/** e.g. "libbyhd.cloudflareaccess.com" */
	ACCESS_TEAM_DOMAIN?: string;
	/** Access application AUD tag */
	ACCESS_AUD?: string;
	/** Comma-separated parent emails allowed in (defence in depth behind Access). */
	ALLOWED_EMAILS?: string;
	/** Development only (.dev.vars / tests). Ignored unless host is *.localhost. */
	DEV_AUTH_EMAIL?: string;
	APP_VERSION?: string;
}
