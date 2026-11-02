import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
	test: {
		poolOptions: {
			workers: {
				singleWorker: true,
				// SQLite-backed Durable Objects are not compatible with isolated storage in vitest-pool-workers;
				// tests are written to be independent of shared state instead.
				isolatedStorage: false,
				wrangler: { configPath: "./wrangler.jsonc" },
				miniflare: {
					bindings: {
						DEV_AUTH_EMAIL: "parent@example.test",
						HOST_PERSON_MAP: JSON.stringify({
							"callum.localhost": "callum",
							"finnley.localhost": "finnley",
							"callum.libbyhd.org": "callum",
							"finnley.libbyhd.org": "finnley",
						}),
					},
				},
			},
		},
	},
});
