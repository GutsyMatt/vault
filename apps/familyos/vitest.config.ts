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
						AUTOMATION_TOKEN_SHA256: "d6d0cb0a563361ca67aa948186c949b9832419a9b5e437a599d5e4bae3d4fe45",
						HOUSEHOLD: JSON.stringify({
							hosts: ["familyos.localhost", "familyos.libbyhd.org"],
							members: [
								{ person: "callum", host: "callum.localhost", name: "Callum", label: "Baby A · LEFT", side: "left" },
								{ person: "finnley", host: "finnley.localhost" },
							],
						}),
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
