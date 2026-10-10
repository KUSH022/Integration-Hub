# External API contract requirements

The KP WFM and KP QA Agent source code and API documentation were **not available** when KP Integration Hub was built. So the Hub does **not** hard-code any endpoint, payload schema, authentication scheme or status vocabulary for either system. Instead, every contract detail is configuration, entered by an administrator from the real documentation and stored in the Hub database.

This document lists exactly what must be supplied before each adapter can be activated.

## 1. KP WFM (destination)

Collect these from the KP WFM API documentation or source code. Record where each one came from in the operation's `contractReference` field.

| # | Information required | Where it is entered in the Hub | Notes |
|---|---|---|---|
| W1 | **Base URL** of the KP WFM API (HTTPS in production) | Connection → Base URL | Without query string or credentials. |
| W2 | **Authentication mechanism**: bearer token, or API key and its header name | Connection → Authentication / API key header name | Other schemes (OAuth2 client credentials, HMAC signatures, cookies) are **not implemented**. Add an adapter before using them. |
| W3 | A **least-privilege credential** for the Hub | Connection → Set credential | Scope it to the location/employee operations only. |
| W4 | A verified **health-check or read-only endpoint** (GET) and its success status | Connection → Health-check path / Expected statuses | Used by "Test connection". Activation requires a passing test. |
| W5 | **Location create and/or update operation**: method, path (including any path parameters), request body schema and success status codes | Connection → Documented operations; Integration → Destination | Choose PUT for upsert only if KP WFM documents PUT as idempotent. |
| W6 | **Employee create and/or update operation**: same details as W5 | As above | |
| W7 | **Field names and formats** expected by KP WFM, for example `locationId`, `locationName`, `status` values, date formats and number precision | Integration → Field mapping / Validation rules | The templates use the field names from the project brief as examples only. |
| W8 | Where the **created record's identifier** appears in the response (for example `id` or `data.id`), or which request field is the identifier | Integration → Destination record identifier | Needed for read-back and QA. |
| W9 | **Read-back endpoint** (GET a single location or employee) and where the record sits in its response (for example `data`) | Integration → Read-back verification | Without it, executions are reported as *"destination persistence could not be independently verified"*. |
| W10 | Whether KP WFM supports **idempotency keys**, and the header name | Integration → Execution settings → Idempotency key | Leave disabled unless it is documented. POST requests that time out after delivery are then never retried automatically. |
| W11 | **Rate limits**, maximum payload size, and the status codes used for throttling (for example 429) | Integration → Retry on HTTP status / Batch size | |
| W12 | **Network location**: public HTTPS, or private network | Server env `ALLOW_PRIVATE_DESTINATIONS`, `DESTINATION_HOST_ALLOWLIST` | Private addresses are blocked by default (SSRF protection). |

## 2. KP QA Agent (verification)

The QA adapter is generic. It sends a request built from a **request template** and reads the response using configured **field paths**. Enter the contract as JSON on a connection whose application is **KP QA Agent** (Connections → Edit → *KP QA Agent API contract*).

| Field | Meaning | Example (illustrative only — replace with the real contract) |
|---|---|---|
| `triggerPath` | Path that starts a verification | `/<documented-path>` |
| `triggerMethod` | `POST` or `PUT` | `POST` |
| `triggerSuccessStatuses` | Status codes that mean "accepted" | `[202]` |
| `requestTemplate` | JSON body that uses the Hub variables listed below | `{"externalRunId": "{{executionId}}", "expected": "{{expectedPayload}}"}` |
| `executionIdPath` | Where the QA execution ID appears in the trigger response | `id` |
| `initialStatusPath` | (optional) Status field in the trigger response | `status` |
| `statusPathTemplate` | Path used to poll status. Must contain `{{qaExecutionId}}` | `/<documented-path>/{{qaExecutionId}}` |
| `statusFieldPath` | Status field in the poll response | `status` |
| `statusValues` | QA status values mapped to Hub outcomes: `passed`, `failed`, `running`, `error` | `{"passed":["PASSED"],"failed":["FAILED"],"running":["QUEUED","RUNNING"],"error":["ERROR"]}` |
| `differencesPath` | (optional) Array of field-level differences | `result.differences` |
| `errorMessagePath` | (optional) Error detail field | `error.message` |
| `pollIntervalSeconds` / `maxPollMinutes` | Polling cadence and overall deadline | `10` / `30` |
| `contractReference` | Source of the contract (document URL and version) | `QA Agent API v1.2, docs URL` |

### Variables available in `requestTemplate`

| Variable | Value |
|---|---|
| `{{executionId}}` | Hub execution ID |
| `{{correlationId}}` | Correlation ID. It is also sent to KP WFM as `X-Correlation-ID`. |
| `{{entityType}}` | `LOCATION`, `EMPLOYEE`, … |
| `{{integrationId}}`, `{{integrationName}}` | Integration identity |
| `{{operation}}` | `{ "method": "...", "path": "..." }` — the operation performed |
| `{{operationMethod}}`, `{{operationPath}}` | The operation as separate strings |
| `{{destinationRecordId}}` | Destination record identifier (see W8) |
| `{{expectedPayload}}` | **The exact immutable transformed request body** sent to KP WFM (not the source payload) |
| `{{expectedPayloadHash}}` | SHA-256 of the expected payload |
| `{{expectedPayloadRef}}` | Signed, expiring URL (24 h) to fetch the expected payload from the Hub. Only available when `PUBLIC_API_BASE_URL` is set. |
| `{{destinationConnectionRef}}` | `{ id, name, application, baseUrl }`. **No credentials are ever sent.** |
| `{{verificationEndpoint}}` | Read-back URL or path template |
| `{{verificationOperation}}` | Free-text operation name set on the integration |
| `{{comparisonRules}}` | `{ fields: [...], mode: "EXACT" | "CASE_INSENSITIVE" }` |

A variable that the template uses but that has no value produces a QA status of `ERROR` with a clear message. The Hub never sends an empty placeholder.

### Questions to confirm with the KP QA Agent team

1. How does QA Agent authenticate callers (bearer token or API key)? Which header does it use?
2. How does QA Agent read the KP WFM record? Does it use its own KP WFM credentials (recommended), or does it need an approved connection reference? The Hub will not forward KP WFM credentials.
3. Can QA Agent call the Hub's signed `expectedPayloadRef` URL, or must the payload be sent inline?
4. What is the complete status vocabulary, and which values are final?
5. What is the shape of the field-level comparison results?
6. Does QA Agent deduplicate triggers by `executionId`? The Hub does not re-trigger a QA run whose outcome is unknown.

## 3. Activation checklist

- [ ] W1–W4 entered. Connection test passes. Connection activated (ADMIN).
- [ ] W5–W9 entered on the integration. Review step shows no errors.
- [ ] Sample record preview matches what KP WFM expects.
- [ ] One record executed. Transfer status is `SUCCESS` and read-back is `VERIFIED`.
- [ ] QA contract complete (no "missing" warning). QA status reaches `PASSED` or `FAILED` with real differences.
