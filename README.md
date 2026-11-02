# LLM Chat Application Template

A simple, ready-to-deploy chat application template powered by Cloudflare Workers AI. This template provides a clean starting point for building AI chat applications with streaming responses.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cloudflare/templates/tree/main/llm-chat-app-template)

<!-- dash-content-start -->

## Demo

This template demonstrates how to build an AI-powered chat interface using Cloudflare Workers AI with streaming responses. It features:

- Real-time streaming of AI responses using Server-Sent Events (SSE)
- Easy customization of models and system prompts
- Support for AI Gateway integration
- Clean, responsive UI that works on mobile and desktop

## Features

- 💬 Simple and responsive chat interface
- ⚡ Server-Sent Events (SSE) for streaming responses
- 🧠 Powered by Cloudflare Workers AI LLMs
- 🛠️ Built with TypeScript and Cloudflare Workers
- 📱 Mobile-friendly design
- 🔄 Maintains chat history on the client
- 🔎 Built-in Observability logging
<!-- dash-content-end -->

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or newer)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
- A Cloudflare account with Workers AI access

### Installation

1. Clone this repository:

   ```bash
   git clone https://github.com/cloudflare/templates.git
   cd templates/llm-chat-app
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Generate Worker type definitions:
   ```bash
   npm run cf-typegen
   ```

### Development

Start a local development server:

```bash
npm run dev
```

This will start a local server at http://localhost:8787.

Note: Using Workers AI accesses your Cloudflare account even during local development, which will incur usage charges.

### Deployment

Deploy to Cloudflare Workers:

```bash
npm run deploy
```

### Monitor

View real-time logs associated with any deployed Worker:

```bash
npm wrangler tail
```

## Project Structure

```
/
├── public/             # Static assets
│   ├── index.html      # Chat UI HTML
│   └── chat.js         # Chat UI frontend script
├── src/
│   ├── index.ts        # Main Worker entry point
│   ├── auth.ts         # Epic MyChart patient sign-in (SMART on FHIR)
│   └── types.ts        # TypeScript type definitions
├── test/               # Test files
├── wrangler.jsonc      # Cloudflare Worker configuration
├── tsconfig.json       # TypeScript configuration
└── README.md           # This documentation
```

## How It Works

### Backend

The backend is built with Cloudflare Workers and uses the Workers AI platform to generate responses. The main components are:

1. **API Endpoint** (`/api/chat`): Accepts POST requests with chat messages and streams responses
2. **Streaming**: Uses Server-Sent Events (SSE) for real-time streaming of AI responses
3. **Workers AI Binding**: Connects to Cloudflare's AI service via the Workers AI binding

### Frontend

The frontend is a simple HTML/CSS/JavaScript application that:

1. Presents a chat interface
2. Sends user messages to the API
3. Processes streaming responses in real-time
4. Maintains chat history on the client side

## MyChart Patient Sign-In

Patients can sign in with their Epic MyChart account. This follows Epic's
[patient authentication tutorial](https://open.epic.com/Tutorial/PatientAuthentication):
a SMART on FHIR standalone launch using the OAuth 2.0 authorization code flow with PKCE.

| Route            | Purpose                                                                 |
| ---------------- | ----------------------------------------------------------------------- |
| `/auth/login`    | Takes the chosen provider (`?iss=`), discovers its endpoints from `.well-known/smart-configuration` and redirects to MyChart |
| `/auth/callback` | Verifies `state`, exchanges the code + PKCE verifier for an access token |
| `/auth/logout`   | Clears the session                                                      |
| `/api/patient`   | Returns the signed-in patient's name and birth date (FHIR `Patient` read) |
| `/api/providers` | Lists the healthcare providers patients can choose from                 |

Patients pick their healthcare provider from a searchable list before signing
in. The list always starts with the default FHIR server (the Epic sandbox unless
`EPIC_FHIR_BASE_URL` is set). When `EPIC_PRODUCTION_CLIENT_ID` is set, it also
includes every organization in [Epic's endpoint directory](https://open.epic.com/Endpoints/R4),
cached for a day. `/auth/login` only accepts providers from this list.

The session is stored in an AES-GCM encrypted, `HttpOnly` cookie, and the
access token is refreshed automatically when Epic issues a refresh token.

### Setup

1. Create an app at [Epic on FHIR](https://fhir.epic.com/) with **Patients** as
   the audience, and register `https://<your-worker>/auth/callback` (and
   `http://localhost:8787/auth/callback` for local development) as redirect URIs.
2. Configure the Worker:

   ```bash
   # Required
   npx wrangler secret put SESSION_SECRET      # any long random string
   # Set EPIC_CLIENT_ID as a var in wrangler.jsonc or in the dashboard
   # Optional
   npx wrangler secret put EPIC_CLIENT_SECRET  # confidential clients only
   ```

   For local development, put the same values in a `.dev.vars` file.

| Variable             | Default                                                       |
| -------------------- | ------------------------------------------------------------- |
| `EPIC_CLIENT_ID`     | — (required; use the non-production ID for the sandbox)       |
| `SESSION_SECRET`     | — (required)                                                  |
| `EPIC_PRODUCTION_CLIENT_ID` | unset → only the default provider is offered; set it to offer every Epic organization |
| `EPIC_CLIENT_SECRET` | unset → public client (PKCE only)                             |
| `EPIC_FHIR_BASE_URL` | `https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4` (sandbox) |
| `EPIC_REDIRECT_URI`  | `<request origin>/auth/callback`                              |
| `EPIC_SCOPE`         | `launch/patient openid fhirUser`                              |

Epic issues separate non-production and production client IDs. The sandbox
uses `EPIC_CLIENT_ID`; every other provider uses `EPIC_PRODUCTION_CLIENT_ID`.
A patient-facing app is typically available at an organization only once
Epic's production client ID has synced to it, so a provider in the list may
still reject sign-in until then.

## Customization

### Changing the Model

To use a different AI model, update the `MODEL_ID` constant in `src/index.ts`. You can find available models in the [Cloudflare Workers AI documentation](https://developers.cloudflare.com/workers-ai/models/).

### Using AI Gateway

The template includes commented code for AI Gateway integration, which provides additional capabilities like rate limiting, caching, and analytics.

To enable AI Gateway:

1. [Create an AI Gateway](https://dash.cloudflare.com/?to=/:account/ai/ai-gateway) in your Cloudflare dashboard
2. Uncomment the gateway configuration in `src/index.ts`
3. Replace `YOUR_GATEWAY_ID` with your actual AI Gateway ID
4. Configure other gateway options as needed:
   - `skipCache`: Set to `true` to bypass gateway caching
   - `cacheTtl`: Set the cache time-to-live in seconds

Learn more about [AI Gateway](https://developers.cloudflare.com/ai-gateway/).

### Modifying the System Prompt

The default system prompt can be changed by updating the `SYSTEM_PROMPT` constant in `src/index.ts`.

### Styling

The UI styling is contained in the `<style>` section of `public/index.html`. You can modify the CSS variables at the top to quickly change the color scheme.

## Resources

- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Cloudflare Workers AI Documentation](https://developers.cloudflare.com/workers-ai/)
- [Workers AI Models](https://developers.cloudflare.com/workers-ai/models/)
