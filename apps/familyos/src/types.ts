import type { PersonVault } from "./storage/person-vault";

export interface Env {
	ASSETS: Fetcher;
	PERSON_VAULT: DurableObjectNamespace<PersonVault>;
	/** JSON: {"callum.libbyhd.org":"callum", ...}. Host -> person key. */
	HOST_PERSON_MAP: string;
	/** JSON: {"hosts":["familyos.libbyhd.org"],"members":[{"person":"callum","host":"callum.libbyhd.org"},...]} (members left → right) */
	HOUSEHOLD: string;
	/** e.g. "libbyhd.cloudflareaccess.com" */
	ACCESS_TEAM_DOMAIN?: string;
	/** Access application AUD tag */
	ACCESS_AUD?: string;
	/** Comma-separated parent emails allowed in (defence in depth behind Access). */
	ALLOWED_EMAILS?: string;
	/** Local development and tests only. Ignored unless the host is *.localhost. */
	DEV_AUTH_EMAIL?: string;
	APP_VERSION?: string;
}
