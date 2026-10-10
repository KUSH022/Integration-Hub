# Set up the local QA Agent to check Hub integrations

This guide explains what runs where and how to perform one end-to-end check.

## The three applications and their jobs

| Application | Where it runs | What it does |
| --- | --- | --- |
| WFM | Deployed on Vercel, using its MongoDB database | Receives data from the Hub and provides APIs the QA Agent can read. |
| Integration Hub | Deployed on Vercel, using the Hub's MongoDB database | Holds integration configuration, runs integrations only when a user starts them, and stores their results. |
| QA Agent | Backend and web screen run on your computer | When you click its Hub check button, it asks the Hub for an eligible run, waits one minute, reads the record from WFM, compares it with the Hub's saved request, and reports the result to the Hub. |

The Hub does not start the QA Agent. The QA Agent does not start Hub integrations. Both actions are manual: first run an integration in the Hub, then click the check button in the QA Agent.

## Before you start

Have these items ready:

1. The deployed WFM URL, for example `https://your-wfm-app.vercel.app`.
2. The deployed Hub URL, for example `https://your-integration-hub.vercel.app`.
3. WFM login credentials. The Hub's inbound write requires an Administrator account; the QA Agent's read can use a Manager or Administrator account. WFM uses short-lived bearer tokens, not a permanent API key for this purpose.
4. The Hub's MongoDB connection string and database configuration, already set up in the Hub's Vercel project.
5. Node.js, Python, and Git installed on your computer. The QA Agent's backend and frontend have their own setup steps below.

The example URLs above are placeholders. Replace them with your actual deployment URLs. Keep the URL origin only in `CONN_WFM_URL` (no `/api/...` suffix).

## Step 1: Set up the Hub on Vercel

In the Vercel project for the **Integration Hub**, open **Settings → Environment Variables** and add:

| Variable | Value |
| --- | --- |
| `QA_AGENT_API_KEY` | A long, private random string. You will enter the exact same value in the local QA Agent in Step 2. |
| `CRON_SECRET` | A separate long, private random string for the Hub's scheduled recovery endpoint. Do not reuse the QA Agent key. |
| Hub database variables | Your Hub MongoDB connection settings, as required by the Hub deployment configuration. |

Do not put real secrets in source files or commit them to Git. After changing Vercel environment variables, redeploy the Hub so the running deployment receives them.

`QA_AGENT_API_KEY` protects the Hub endpoints used by the Agent to list eligible runs, claim a run, and submit its result. The Agent sends it as the `X-KP-QA-Agent-Key` header. It is separate from WFM authentication and Hub user login.

`CRON_SECRET` is for recovery of interrupted Hub work. It does not schedule or start business integrations. This flow does not configure a recurring integration.

## Step 2: Configure and start the QA Agent locally

All paths in this section are inside the extracted project folder `Ecosystem/QA tester - test/`.

### 2a. Configure its local environment

Open a terminal in `Ecosystem/QA tester - test/backend/`. Copy `.env.example` to a new file named `.env`. Edit the new `.env` and set at least:

```dotenv
CONN_WFM_URL=https://your-wfm-app.vercel.app
SECRET_WFM=your-wfm-read-api-credential
HUB_BASE_URL=https://your-integration-hub.vercel.app
HUB_QA_AGENT_API_KEY=paste-the-same-value-as-the-Hub-QA_AGENT_API_KEY
```

Replace the placeholder values with your actual values. `HUB_QA_AGENT_API_KEY` must exactly match the `QA_AGENT_API_KEY` value saved in the Hub's Vercel settings. Do not include quotes unless the value itself requires them, and do not add a trailing slash to either base URL.

`CONN_WFM_URL` names the WFM server connection called `WFM` in a profile. `SECRET_WFM` supplies the bearer token referenced by that profile. The WFM code does not provide a separate permanent integration API key: obtain a token by signing in with a WFM user account. Keep the token here; it does not need to be copied into the Hub or the QA Agent's browser screen. The token expires after 12 hours, so you will need to sign in again and replace it when that happens.

### Get a WFM bearer token

The WFM README includes demo accounts for a freshly seeded database:

| Role | Email | Password |
| --- | --- | --- |
| Administrator | `admin@kpwfm.com` | `Admin123` |
| Manager | `manager@kpwfm.com` | `Manager123` |

Outbound integration read APIs require the Manager or Administrator role. Inbound integration write APIs require the Administrator role. For a quick local/demo setup, request a token from the deployed WFM app by running this in PowerShell, replacing the URL if yours differs:

```powershell
$wfm = 'https://your-wfm-app.vercel.app'
$login = Invoke-RestMethod -Method Post -Uri "$wfm/api/auth/login" -ContentType 'application/json' -Body '{"email":"admin@kpwfm.com","password":"Admin123"}'
$login.token
```

Copy the printed token into `SECRET_WFM` in the QA Agent's `backend/.env`, then restart the backend. Use an Administrator account token for the Hub's WFM connection because the Hub writes locations; the local QA Agent can use either the Manager or Administrator token. Each token expires after 12 hours. The credentials above are demo credentials from the project seed; use dedicated accounts with strong passwords for any non-demo deployment, and do not use these seeded defaults on a publicly accessible production app. Never share or commit tokens.

`GROQ_API_KEY` and `GROQ_MODEL` are only for the separate optional AI browser-testing features. The Hub check and its comparison do not use Groq, so these can be left as example values for this task.

### 2b. Start the backend

In a terminal, run these commands from `Ecosystem/QA tester - test/backend/`:

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
```

If you already created `.env` in step 2a, do not run the `copy` command again because it could overwrite your settings. Start the backend with:

```powershell
uvicorn app.main:app --reload --reload-dir app --port 8000
```

Leave this terminal running. The local backend is the part that calls both the Hub and WFM. Do not expose it publicly for this setup.

### 2c. Start the web screen

Open a second terminal in `Ecosystem/QA tester - test/frontend/` and run:

```powershell
npm install
npm run dev
```

Open the local address printed by Vite, normally `http://localhost:5173`. The frontend talks to the local backend on port `8000`.

## Step 3: Create a matching QA profile

The QA Agent needs a local profile to know which WFM read endpoint and response field to use. In the local QA Agent web screen:

1. Open **Integration Testing → Profiles**.
2. Choose to create a profile.
3. Give it a recognizable name, such as `Hub locations check`.
4. Set **Integration ID** to the exact Integration ID shown for the Hub integration. It must match exactly; the integration name alone is not used to match it.
5. Set the entity type if the form asks for one, then save the profile as enabled.
6. Configure the profile's JSON using the actual WFM read API route, authentication, and response format.

For this included WFM application, the Hub location template sends `POST /api/integrations/inbound/locations` with a one-record `records` array. WFM requires `code`, `name`, and `costCenter`. The QA Agent then reads that same location from `GET /api/integrations/outbound/locations?code=<code>`; the Hub passes the WFM business `code` as `recordId`. The outbound API returns a `records` array and the QA profile selects its first item with `responsePath: "records.0"`.

```json
{
  "target": {
    "connection": "WFM",
    "endpoint": "/api/integrations/outbound/locations",
    "method": "GET",
    "headers": {},
    "query": {
      "code": "{recordId}",
      "page": 1,
      "limit": 1
    },
    "timeout": 15,
    "expectedStatus": [200],
    "responsePath": "records.0"
  },
  "auth": {
    "type": "bearer",
    "ref": "WFM"
  },
  "compare": {
    "mode": "exact",
    "fields": [],
    "ignore": [],
    "required": [],
    "normalize": {
      "trim": false,
      "caseInsensitive": false,
      "numericStrings": false,
      "nullEqualsMissing": false
    },
    "reportUnexpected": false,
    "ignoreArrayOrder": false
  },
  "polling": {
    "intervalSeconds": 10,
    "maxAttempts": 12,
    "deadlineSeconds": 120,
    "retryOnMismatch": false
  }
}
```

Important profile details:

- `connection: "WFM"` uses `CONN_WFM_URL` from the Agent's local `.env`.
- `auth.ref: "WFM"` uses `SECRET_WFM`. `type` and any auth header settings must match how the WFM API expects credentials.
- `{recordId}` is replaced with the location `code` from the Hub run. The `code` query filter must be kept so the Agent reads just that location.
- `responsePath` points to the record inside the WFM response. For a response shaped like `{ "records": [ { ... } ] }`, `records.0` selects the first record.
- The Hub's Integration ID must match the profile's Integration ID exactly, and the profile must be enabled.
- For a non-locations integration, use its documented WFM endpoint, record filter, and response path. Do not copy the locations example unchanged.
- The Hub sends WFM the shape `{ "records": [ { "code": "...", "name": "...", "costCenter": "..." } ] }`. The Hub QA endpoint unwraps that one record before sending the expected data to the Agent, so comparison is location fields against the matching WFM location—not the wrapper or every location.
- The Hub supplies comparison fields and mode for the run. The profile still supplies the WFM target and credential reference.

For an employee integration using the included WFM application, use the employee business ID as the lookup filter:

```json
{
  "target": {
    "connection": "WFM",
    "endpoint": "/api/integrations/outbound/employees",
    "method": "GET",
    "headers": {},
    "query": { "employeeId": "{recordId}", "page": 1, "limit": 1 },
    "timeout": 15,
    "expectedStatus": [200],
    "responsePath": "records.0"
  },
  "auth": { "type": "bearer", "ref": "WFM" },
  "compare": { "mode": "exact", "fields": [], "ignore": [], "required": [], "normalize": {}, "reportUnexpected": false, "ignoreArrayOrder": false },
  "polling": { "intervalSeconds": 10, "maxAttempts": 12, "deadlineSeconds": 120, "retryOnMismatch": false }
}
```

The employee being imported must refer to a location, department, and job title that already exist in WFM. The Hub's built-in employee template uses sample values from the seeded demo data; replace them with values that exist in your WFM database.

## Step 4: Allow QA verification in the Hub integration

In the Hub web screen:

1. Open the integration you want to check, or create/configure it first.
2. In the integration setup, configure the WFM destination connection with an Administrator bearer token, then confirm the template's write endpoint and field mapping.
3. Open the execution/QA settings step and turn on **Allow manual QA Agent verification after a successful transfer**.
4. Configure the comparison fields and rules for this integration.
5. Save the integration.

The Hub must retain a JSON request snapshot for the successful transfer and a record ID the WFM read profile can query. The QA Agent requires the Hub run's destination record ID or a source record key that is also the WFM record's lookup key. If the WFM create/update response returns the destination ID, configure the Hub to capture it. If the integration has no usable record ID, the Agent cannot know which WFM record to fetch.

## Step 5: Run one integration and check it

1. In the Hub, manually start the integration for a record. The Hub sends the mapped data to WFM and saves the run.
2. Wait for the Hub run to show a successful transfer.
3. In the local QA Agent, open **Integration Testing → Hub check**.
4. Click **Get latest Hub run and compare**. This is the point when the Agent contacts the Hub; it does not continuously poll.
5. The Agent fetches the newest successful Hub run that is enabled for manual QA and has a matching enabled profile. It claims the run so another Agent does not check it at the same time.
6. The Agent waits 60 seconds, then calls the WFM read API with the record ID and compares the result with the Hub's saved request data.
7. View the local result in **Integration Testing → Executions**. The Hub run also shows the QA status and any reported differences.

The check may take longer than one minute because the Agent waits for WFM to finish processing and can poll for the record. The Hub integration itself only runs when a user starts it in the Hub.

## Common setup errors

| What you see | Check this |
| --- | --- |
| Hub check says no successful run is waiting | Run the Hub integration manually; make sure its transfer succeeded and manual QA verification is enabled. A run already claimed/checked is no longer pending. |
| No matching profile / no eligible run | The local profile is enabled and its Integration ID exactly matches the Hub integration ID. |
| Hub says QA Agent is not configured | Set `QA_AGENT_API_KEY` in the Hub Vercel project and redeploy it. |
| Hub rejects the QA Agent key | `HUB_QA_AGENT_API_KEY` in local `backend/.env` must exactly match Hub `QA_AGENT_API_KEY`; restart the local backend after editing `.env`. |
| Agent cannot connect to Hub | Check `HUB_BASE_URL`, use the deployed HTTPS URL without a trailing slash, and confirm the Hub deployment is live. |
| Agent cannot connect to WFM | Check `CONN_WFM_URL`, `SECRET_WFM`, credential permissions, and the WFM API route. Restart the backend after changing `.env`. |
| Hub run has no destination record ID | Configure the Hub/WFM response mapping to capture the created record ID, or ensure the source record key is the same key accepted by the WFM lookup endpoint. |
| WFM returns 401 or 403 | The WFM credential is missing, expired, or lacks read permission for that endpoint. |
| WFM returns an empty result | Confirm the lookup query key uses the right record ID and that the response path matches the actual response JSON. |
| Comparison reports differences | Open the execution in the local Agent to see the expected value, actual WFM value, field path, and mismatch category. Adjust mapping/comparison rules only if the WFM contract says the values are equivalent. |

## Manual operation and deployment notes

- No Hub integration is scheduled or automatically started by this flow.
- The QA Agent calls the Hub only after you click its button. It does not run as a background poller.
- The Hub may have a scheduled recovery endpoint for interrupted work; that endpoint is separate from starting integrations and requires `CRON_SECRET`.
- Keep the QA Agent backend running locally while using its web screen. It is not deployed with the Hub.
- Hub and WFM each use their own database and credentials. The local QA Agent needs read access to WFM and the shared QA key for Hub-to-Agent verification APIs.
- The software in this flow is designed to use free/self-hostable components, but third-party free-tier limits and terms can change. Check current Vercel and MongoDB plan limits before relying on a no-cost deployment.
