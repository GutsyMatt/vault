/**
 * LLM Chat Application Template
 *
 * A simple chat application using Cloudflare Workers AI.
 * This template demonstrates how to implement an LLM-powered chat interface with
 * streaming responses using Server-Sent Events (SSE).
 *
 * @license MIT
 */
import { Env, ChatMessage } from "./types";
import {
	fetchFhir,
	getPatientSession,
	getProviders,
	handleAuthRequest,
} from "./auth";

// Model ID for Workers AI model
// https://developers.cloudflare.com/workers-ai/models/
const MODEL_ID = "@cf/meta/llama-3.1-8b-instruct-fp8";

// Default system prompt
const SYSTEM_PROMPT =
	"You are a helpful, friendly assistant. Provide concise and accurate responses.";

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
		if (url.pathname === "/api/chat") {
			// Handle POST requests for chat
			if (request.method === "POST") {
				return handleChatRequest(request, env);
			}

			// Method not allowed for other request types
			return new Response("Method not allowed", { status: 405 });
		}

		if (url.pathname === "/api/providers") {
			if (request.method === "GET") {
				return Response.json(await getProviders(env), {
					headers: { "cache-control": "public, max-age=3600" },
				});
			}
			return new Response("Method not allowed", { status: 405 });
		}

		if (url.pathname === "/api/patient") {
			if (request.method === "GET") {
				return handlePatientRequest(request, env);
			}
			return new Response("Method not allowed", { status: 405 });
		}

		// Handle 404 for unmatched routes
		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;

/**
 * Handles chat API requests
 */
async function handleChatRequest(
	request: Request,
	env: Env,
): Promise<Response> {
	try {
		// Parse JSON request body
		const { messages = [] } = (await request.json()) as {
			messages: ChatMessage[];
		};

		// Add system prompt if not present
		if (!messages.some((msg) => msg.role === "system")) {
			messages.unshift({ role: "system", content: SYSTEM_PROMPT });
		}

		const stream = await env.AI.run(
			MODEL_ID,
			{
				messages,
				max_tokens: 1024,
				stream: true,
			},
			{
				// Uncomment to use AI Gateway
				// gateway: {
				//   id: "YOUR_GATEWAY_ID", // Replace with your AI Gateway ID
				//   skipCache: false,      // Set to true to bypass cache
				//   cacheTtl: 3600,        // Cache time-to-live in seconds
				// },
			},
		);

		return new Response(stream, {
			headers: {
				"content-type": "text/event-stream; charset=utf-8",
				"cache-control": "no-cache",
				connection: "keep-alive",
			},
		});
	} catch (error) {
		console.error("Error processing chat request:", error);
		return new Response(
			JSON.stringify({ error: "Failed to process request" }),
			{
				status: 500,
				headers: { "content-type": "application/json" },
			},
		);
	}
}

/**
 * Returns a summary of the signed-in patient's FHIR Patient resource
 */
async function handlePatientRequest(
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
		const response = await fetchFhir(
			session,
			`Patient/${encodeURIComponent(session.patient)}`,
		);
		if (!response.ok) {
			throw new Error(`FHIR Patient read failed: ${response.status}`);
		}
		const patient = (await response.json()) as {
			id: string;
			birthDate?: string;
			name?: {
				use?: string;
				text?: string;
				given?: string[];
				family?: string;
			}[];
		};
		const name =
			patient.name?.find((n) => n.use === "official") ?? patient.name?.[0];
		return new Response(
			JSON.stringify({
				authenticated: true,
				patient: {
					id: patient.id,
					name:
						name?.text ??
						[...(name?.given ?? []), name?.family].filter(Boolean).join(" "),
					birthDate: patient.birthDate,
				},
			}),
			{ headers },
		);
	} catch (error) {
		console.error("Error fetching patient:", error);
		return new Response(JSON.stringify({ error: "Failed to load patient" }), {
			status: 502,
			headers,
		});
	}
}
