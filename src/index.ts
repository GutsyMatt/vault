/**
 * LibbyHD
 *
 * Patients sign in with their healthcare provider's MyChart, see a summary of
 * their own health record read live from Epic over SMART on FHIR, and ask an
 * assistant about it.
 *
 * @license MIT
 */
import { Env } from "./types";
import { getPatientSession, getProviders, handleAuthRequest } from "./auth";
import { handleChatRequest } from "./chat";
import { getHealthRecord } from "./record";

export default {
	/**
	 * Main request handler for the Worker
	 */
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);

		// MyChart patient sign-in (SMART on FHIR)
		if (url.pathname.startsWith("/auth/")) {
			try {
				const response = await handleAuthRequest(request, env);
				if (response) return response;
			} catch (error) {
				console.error("Error processing auth request:", error);
				return new Response("Sign-in with MyChart is unavailable.", {
					status: 502,
				});
			}
			return new Response("Not found", { status: 404 });
		}

		// Handle static assets (frontend)
		if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
			return env.ASSETS.fetch(request);
		}

		// API Routes
		if (url.pathname === "/api/providers") {
			if (request.method === "GET") {
				return Response.json(await getProviders(env), {
					headers: { "cache-control": "public, max-age=3600" },
				});
			}
			return new Response("Method not allowed", { status: 405 });
		}

		if (url.pathname === "/api/record") {
			if (request.method === "GET") {
				return handleRecordRequest(request, env);
			}
			return new Response("Method not allowed", { status: 405 });
		}

		if (url.pathname === "/api/chat") {
			if (request.method === "POST") {
				const { session, setCookie } = await getPatientSession(request, env);
				if (!session) {
					return Response.json({ authenticated: false }, { status: 401 });
				}
				try {
					const response = await handleChatRequest(request, env, session);
					if (setCookie) response.headers.append("set-cookie", setCookie);
					return response;
				} catch (error) {
					console.error("Error processing chat request:", error);
					return Response.json(
						{ error: "Failed to process request" },
						{ status: 500 },
					);
				}
			}
			return new Response("Method not allowed", { status: 405 });
		}

		// Handle 404 for unmatched routes
		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;

/**
 * Returns a summary of the signed-in patient's health record
 */
async function handleRecordRequest(
	request: Request,
	env: Env,
): Promise<Response> {
	const { session, setCookie } = await getPatientSession(request, env);
	const headers = new Headers({
		"content-type": "application/json",
		"cache-control": "no-store",
	});
	if (setCookie) headers.append("set-cookie", setCookie);

	if (!session) {
		return new Response(JSON.stringify({ authenticated: false }), {
			status: 401,
			headers,
		});
	}

	try {
		const record = await getHealthRecord(session);
		return new Response(JSON.stringify({ authenticated: true, ...record }), {
			headers,
		});
	} catch (error) {
		console.error("Error loading health record:", error);
		return new Response(JSON.stringify({ error: "Failed to load record" }), {
			status: 502,
			headers,
		});
	}
}
