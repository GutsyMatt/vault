# LibbyHD

Patients sign in with their healthcare provider's MyChart and see their own
health record in one place: medications, allergies, health issues, lab
results, immunizations and recent visits. Data is read live from the
provider's Epic server over SMART on FHIR and is not stored.

The **Ask LibbyHD** assistant answers questions from the patient's own record,
opens the matching dashboard card, and helps them prepare questions or
messages for their care team.

Built on Cloudflare Workers and Workers AI.

## Getting Started

```bash
npm install
npm run dev      # http://localhost:8787
npm run deploy
```

Sign-in needs an Epic client ID and a session secret; see [Setup](#setup).

## Project Structure

```
/
├── public/
│   ├── index.html      # Sign-in page and dashboard
│   └── app.js          # Provider search, dashboard and assistant
├── src/
│   ├── index.ts        # Worker entry point and API routes
│   ├── auth.ts         # MyChart sign-in (SMART on FHIR standalone launch)
│   ├── record.ts       # Reads and summarizes the patient's FHIR record
│   ├── chat.ts         # Ask LibbyHD assistant (Workers AI)
│   └── types.ts        # Type definitions
├── wrangler.jsonc      # Cloudflare Worker configuration
└── tsconfig.json       # TypeScript configuration
```

## How sign-in works

Patients can sign in with their Epic MyChart account. This follows Epic's
[patient authentication tutorial](https://open.epic.com/Tutorial/PatientAuthentication):
a SMART on FHIR standalone launch using the OAuth 2.0 authorization code flow with PKCE.

| Route            | Purpose                                                                 |
| ---------------- | ----------------------------------------------------------------------- |
| `/auth/login`    | Takes the chosen provider (`?iss=`), discovers its endpoints from `.well-known/smart-configuration` and redirects to MyChart |
| `/auth/callback` | Verifies `state`, exchanges the code + PKCE verifier for an access token |
| `/auth/logout`   | Clears the session                                                      |
| `/api/record`    | Returns a summary of the signed-in patient's record (see below)        |
| `/api/providers` | Lists the healthcare providers patients can choose from                 |

Patients pick their healthcare provider from a searchable list before signing
in. The list always starts with the default FHIR server (the Epic sandbox unless
`EPIC_FHIR_BASE_URL` is set). When `EPIC_PRODUCTION_CLIENT_ID` is set, it also
includes every organization in [Epic's endpoint directory](https://open.epic.com/Endpoints/R4),
cached for a day. `/auth/login` only accepts providers from this list.

The session is stored in an AES-GCM encrypted, `HttpOnly` cookie, and the
access token is refreshed automatically when Epic issues a refresh token.

### Setup

1. Create an app named **LibbyHD** at [Epic on FHIR](https://fhir.epic.com/)
   with **Patients** as the audience and these R4 APIs: `Patient.Read`,
   `MedicationRequest.Search`, `AllergyIntolerance.Search`, `Condition.Search
   (Problems)`, `Observation.Search (Labs)`, `Immunization.Search` and
   `Encounter.Search`. Leave it as a public (non-confidential) client and register `https://<your-worker>/auth/callback` (and
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


## The dashboard

`/api/record` loads each part of the record in parallel and reduces it to the
fields the dashboard shows:

| Section            | FHIR query                                              |
| ------------------ | ------------------------------------------------------- |
| Medications        | `MedicationRequest?status=active`                       |
| Allergies          | `AllergyIntolerance?clinical-status=active`             |
| Health issues      | `Condition?category=problem-list-item&clinical-status=active` |
| Lab results        | `Observation?category=laboratory` (20 most recent)      |
| Immunizations      | `Immunization`                                          |
| Recent visits      | `Encounter` (10 most recent)                            |

Patients can choose not to share some kinds of data when they allow access in
MyChart. A section Epic refuses (401/403) shows as "Not shared with LibbyHD"
instead of breaking the page.

## Ask LibbyHD

`POST /api/chat` streams a reply from Workers AI
(`@cf/meta/llama-3.3-70b-instruct-fp8-fast`, set in `src/chat.ts`).

- The patient's record is loaded on the server from their session and given to
  the model as context; the client only sends the conversation, and any
  client-supplied system message is dropped.
- The assistant answers only from the record, explains results in plain
  language, doesn't diagnose or change treatment, and points to emergency
  services when needed.
- When an answer is about one part of the record, the reply ends with a
  `SHOW: <section>` line. The app strips it, scrolls to and highlights that
  card, and adds an "Open …" button to the message.

Workers AI usage is billed to your Cloudflare account, including during local
development.
