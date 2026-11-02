/**
 * LibbyHD assistant: chat grounded in the signed-in patient's own record.
 *
 * The record is always loaded server-side from the patient's session, never
 * taken from the request, so the assistant can only see the record of the
 * person who is signed in. Replies can end with a `SHOW: <section>` line,
 * which the dashboard uses to open and highlight that card.
 */
import { getHealthRecord } from "./record";
import { Env, PatientSession } from "./types";

// Model ID for Workers AI model
// https://developers.cloudflare.com/workers-ai/models/
const MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

// Only the most recent turns are sent to the model
const MAX_MESSAGES = 20;

// Longest message accepted from the patient
const MAX_MESSAGE_LENGTH = 2000;

// Dashboard sections the assistant can navigate to
const SECTIONS = [
	"medications",
	"allergies",
	"conditions",
	"labs",
	"immunizations",
	"visits",
];

interface ChatMessage {
	role: "user" | "assistant";
	content: string;
}

/**
 * Streams the assistant's reply as Server-Sent Events.
 */
export async function handleChatRequest(
	request: Request,
	env: Env,
	session: PatientSession,
): Promise<Response> {
	const body = (await request.json().catch(() => null)) as {
		messages?: unknown;
	} | null;
	const messages = sanitizeMessages(body?.messages);
	if (!messages.length || messages[messages.length - 1].role !== "user") {
		return Response.json({ error: "Expected a user message" }, { status: 400 });
	}

	const record = await getHealthRecord(session);
	const stream = await env.AI.run(MODEL_ID, {
		messages: [
			{ role: "system", content: buildSystemPrompt(record) },
			...messages,
		],
		max_tokens: 1024,
		stream: true,
	});

	return new Response(stream as ReadableStream, {
		headers: {
			"content-type": "text/event-stream; charset=utf-8",
			"cache-control": "no-cache",
			connection: "keep-alive",
		},
	});
}

/**
 * Keeps only well-formed user/assistant turns; system prompts from the client
 * are dropped so the patient can't replace the assistant's instructions.
 */
function sanitizeMessages(input: unknown): ChatMessage[] {
	if (!Array.isArray(input)) return [];
	return input
		.filter(
			(m): m is ChatMessage =>
				(m?.role === "user" || m?.role === "assistant") &&
				typeof m.content === "string" &&
				m.content.trim().length > 0,
		)
		.slice(-MAX_MESSAGES)
		.map((m) => ({
			role: m.role,
			content: m.content.slice(0, MAX_MESSAGE_LENGTH),
		}));
}

function buildSystemPrompt(
	record: Awaited<ReturnType<typeof getHealthRecord>>,
): string {
	const today = new Date().toISOString().slice(0, 10);
	return `You are LibbyHD, a warm, plain-spoken health record assistant. You are talking with ${record.patient.name}, the patient whose record is below, and you work on their behalf: help them understand their own record, find things in it, and prepare for conversations with their care team.

Today is ${today}.

How to answer:
- Use only the patient's record below for facts about them. If something isn't in the record, say so; never guess or invent results, medications or dates.
- A section with status "unavailable" was not shared by the patient in MyChart; say that and that they can change it in MyChart. Status "error" means it couldn't be loaded right now.
- Explain medical terms and lab results in everyday language. Say whether a result is in or out of its normal range when the record shows one.
- You are not a doctor. Don't diagnose, change treatment or tell them to start or stop a medication; suggest what to ask their care team instead.
- If they describe an emergency (e.g. chest pain, trouble breathing, thoughts of self-harm), tell them to call 911 or their local emergency number now.
- When asked, draft questions or a short message they can send their care team through MyChart, written in their voice.
- Keep replies short: a few sentences or a short "- " bulleted list. Use **bold** sparingly. No headings or tables.

Navigating the dashboard:
- When your answer is about one part of the record, end your reply with a final line "SHOW: <section>", where <section> is one of: ${SECTIONS.join(", ")}. The app then opens that card for the patient. Use at most one SHOW line, and omit it otherwise.

The patient's record (JSON):
${JSON.stringify(record)}`;
}
