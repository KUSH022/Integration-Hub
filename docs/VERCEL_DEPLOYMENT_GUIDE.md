# Deploy the KP Integration Hub to Vercel + MongoDB Atlas

This guide deploys **only the Integration Hub**. WFM is already deployed separately, and the QA Agent remains on your computer.

## What you are deploying

The Hub ZIP contains one application with two Vercel services:

- **Web:** React/Vite interface, served at `/`.
- **API:** Express API, served under `/api`.
- **Database:** MongoDB Atlas, in a database named `kp_integration_hub`.

The supplied `vercel.json` routes `/api/...` requests to the API service and other requests to the web service. It explicitly points the API service to `server/api/index.ts`, the Hub's Vercel request handler. Vercel currently documents Services as a beta feature available on all plans. The Vercel project must use the **Services** framework preset for this configuration to take effect. [Vercel Services guide](https://vercel.com/docs/services)

## Before deploying

Have these ready:

- A Vercel account. The Hobby plan is free for personal, non-commercial projects; usage is subject to plan limits. If this Hub is for commercial use, check Vercel's plan terms before using Hobby. [Vercel Hobby plan](https://vercel.com/docs/plans/hobby)
- A MongoDB Atlas account and a free Atlas cluster. You can use the same Atlas cluster as WFM, but create a **separate Hub database and database user**. Atlas Free currently has a 0.5 GB storage limit, no managed backups, and may pause after 30 days with no connections. [Atlas Free limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/)
- Your production WFM URL and a WFM **Administrator** bearer token. The Hub writes through WFM's inbound integration API, which requires an Administrator. WFM's JWT tokens expire after 12 hours, so its saved Hub connection token must be refreshed when it expires.
- Node.js 20.11 or later and Git, if you will upload this ZIP to GitHub using the command line.

## Step 1: Download and extract the Hub ZIP

1. Download `KP_Integration_Hub_Vercel_Deployment.zip` from the same delivery as this guide.
2. Extract it to a simple path, for example `C:\Projects\KP-Integration-Hub`.
3. Check that the extracted folder's top level contains `vercel.json`, `package.json`, and the `server`, `web`, `api`, and `docs` folders. Do not deploy a parent folder that adds another `Integration Hub` directory layer.
4. The archive intentionally excludes the stale root `.env.example`. The current environment template is `server/.env.example`; do not upload real `.env` files or secrets.

## Step 2: Create or prepare the Hub database in Atlas

You may use the Atlas cluster that WFM already uses. Keep the Hub in its own database.

1. In Atlas, open the project containing the cluster and select **Browse Collections**. The Hub database will be created automatically on its first successful connection; set its name to `kp_integration_hub` in the Vercel environment variables later.
2. Open **Database Access** and add a database user just for the Hub. Give it the built-in `readWrite` role scoped to the `kp_integration_hub` database. Use a new strong password; do not reuse the WFM user's password.
3. Open **Network Access** and allow the Hub's Vercel functions to connect. Vercel's default outbound IPs are dynamic. Vercel static egress IPs are a paid Pro feature, so the no-cost setup may require adding `0.0.0.0/0` in Atlas. If you do this, protect the database with the dedicated strong database password and database-scoped user, and do not reuse that user elsewhere. [Vercel egress IP guidance](https://vercel.com/kb/guide/can-i-get-a-fixed-ip-address)
4. In Atlas, choose **Connect → Drivers** and copy the Node.js connection string. Replace its username and password with the new Hub database user's credentials. URL-encode special characters in the password if required by the connection URI.
5. Keep this connection string private. You will paste it into the Vercel environment variable `MONGODB_URI` in Step 5.

## Step 3: Put the extracted Hub folder in a private GitHub repository

Vercel's multi-service deployment expects a repository containing the Hub's root `vercel.json` and the `server` and `web` folders.

1. Create a **private** empty repository on GitHub, such as `kp-integration-hub`.
2. Open PowerShell in the extracted Hub folder (the one containing `vercel.json`) and run these commands, replacing the repository URL with your own:

   ```powershell
   git init
   git add .
   git commit -m "Initial Integration Hub deployment"
   git branch -M main
   git remote add origin https://github.com/YOUR-ACCOUNT/kp-integration-hub.git
   git push -u origin main
   ```

3. Confirm in GitHub that the repository root shows `vercel.json`, `package.json`, `server`, and `web` directly.
4. Confirm there is no `.env` file in the repository. The ZIP does not contain one, and `server/.env.example` contains placeholders only.

## Step 4: Create the Vercel project

1. In Vercel, select **Add New → Project** and import your private `kp-integration-hub` GitHub repository.
2. Set the project **Root Directory** to the repository root (`./`), not `server` or `web`.
3. Set **Framework Preset** to **Services**. This is required because the repository defines the `server` and `web` services in its root `vercel.json`.
4. Leave the service definitions and rewrites as provided. They build `server` as Express and `web` as Vite, send `/api/...` to the server, and send the remaining paths to the web UI.
5. Before the first deployment, add the production environment variables from Step 5. Vercel will make project environment variables available to both services.

If **Services** is not available in the Framework Preset list, stop before deploying. Do not change the Root Directory to `server` or `web`; that would deploy only one half of the Hub. Check Vercel's current Services availability and project settings first.

## Step 5: Add Vercel production environment variables

In the Vercel project, open **Settings → Environment Variables**. Add the following for **Production**. Use Vercel's secret/value fields; do not paste secrets into code or GitHub.

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `MONGODB_URI` | The private Atlas connection string from Step 2. |
| `MONGODB_DB_NAME` | `kp_integration_hub` |
| `SESSION_SECRET` | A newly generated private random string, at least 32 characters. |
| `SECRETS_ENCRYPTION_KEY` | A newly generated 32-byte Base64 key. Back it up securely: changing or losing it makes saved Hub connection credentials unreadable. |
| `REFERENCE_SIGNING_SECRET` | A different newly generated private random string, at least 32 characters. |
| `QA_AGENT_API_KEY` | A newly generated private random string. You will copy this same value into the local QA Agent as `HUB_QA_AGENT_API_KEY`. |
| `CRON_SECRET` | Another newly generated private random string. Do not reuse any other secret. |
| `COOKIE_SECURE` | `true` |
| `CORS_ORIGINS` | The Hub's exact HTTPS origin, for example `https://kp-integration-hub.vercel.app`; no trailing slash. |
| `BOOTSTRAP_ADMIN_EMAIL` | The email address you will use for your first Hub administrator account. |
| `BOOTSTRAP_ADMIN_PASSWORD` | A new strong password of at least 12 characters. Save it privately for first sign-in. |
| `PUBLIC_API_BASE_URL` | The Hub's HTTPS origin, for example `https://kp-integration-hub.vercel.app`; no trailing slash. This may be set after the first deployment if you do not know the final URL yet. |

Generate the random values on your computer with Node.js. Run this command separately for each secret so every value is different:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Use the output for `SECRETS_ENCRYPTION_KEY` as-is. For the other secrets, the same output format is fine. Do not use the sample values from any old root `.env.example` file.

Leave other settings at their production defaults unless you have a specific need to change them. In particular, keep `ALLOW_PRIVATE_DESTINATIONS=false`; WFM is a public HTTPS deployment.

### If you do not know the final Vercel URL yet

1. Add all required variables except `CORS_ORIGINS` and `PUBLIC_API_BASE_URL`.
2. Deploy once to receive the Vercel production URL.
3. Add that exact URL to both variables (no trailing slash), then redeploy.

The Hub warns and rejects browser write requests when `CORS_ORIGINS` is empty or does not match the browser's origin.

## Step 6: Deploy and verify the Hub

1. Start the deployment from Vercel. Wait for both services to finish building.
2. Open the deployment URL in a browser. The Hub login screen should load.
3. Check the public health endpoints in a browser:

   - `https://YOUR-HUB-URL/api/health` should return JSON with `status: "ok"`.
   - `https://YOUR-HUB-URL/api/ready` should return JSON with `status: "ready"` and `database: "ok"`.

4. Sign in using `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD`.
5. Once you have successfully signed in and confirmed that the admin account exists, remove `BOOTSTRAP_ADMIN_PASSWORD` from Vercel's environment variables and redeploy. Do not remove it before the first admin account is created.
6. Keep a secure copy of `SECRETS_ENCRYPTION_KEY` and `QA_AGENT_API_KEY`. If the encryption key changes, saved integration credentials must be entered again. If the QA key changes, update the local Agent's matching value too.

## Step 7: Add the production WFM connection in the Hub

1. Use the WFM demo Administrator account to request a bearer token:
   - Email: `admin@kpwfm.com`
   - Password: `Admin123`
   - These are the demo credentials seeded by the WFM application. They work only if the WFM database has its demo account and the credentials have not been changed.
2. You do not need to sign in to Vercel again to get this token. Open **PowerShell on your computer** and run the following, replacing the example URL with your deployed WFM URL:

   ```powershell
   $wfm = 'https://your-wfm.vercel.app'
   $login = Invoke-RestMethod -Method Post -Uri "$wfm/api/auth/login" -ContentType 'application/json' -Body '{"email":"admin@kpwfm.com","password":"Admin123"}'
   $login.token
   ```

   PowerShell prints the token. Copy the printed token value. If the login request fails, verify the WFM URL and that the WFM demo Administrator account is still available.
3. In the Hub, sign in with the Hub administrator account you configured in Step 5. Open **Connections**, select the WFM connection, and choose **Edit** (or create the connection if you have not added it yet).
4. Enter a name such as `KP WFM Production`, choose the WFM/application type, and set the base URL to the WFM origin only, for example `https://your-wfm.vercel.app` (no `/api` suffix).
5. Choose **Bearer** authentication and paste the token into the credential/secret field. Paste only the token; do not add `Bearer ` unless the Hub form explicitly asks for a full header value.
6. Set the health-check path to `/api/health` with expected status `200`. The WFM health route is public and confirms network reachability; the protected integration operation still checks the saved token.
7. Save, test the connection, and activate it after the test succeeds.

WFM JWT tokens expire after 12 hours. When the token expires and a connection test or integration returns `401`, repeat the PowerShell login request above and replace the saved token in **Hub → Connections → WFM connection → Edit**. Save and retest the connection. This credential update is made in the Hub; it does not require changing Vercel environment variables or redeploying the Hub. The demo credentials do not make the token permanent, and a longer-lived service credential is not currently implemented in the WFM code.

## Step 8: Configure a manual location integration

1. Open **Templates** and select **Location inbound integration**.
2. Create an integration from the template. Select the WFM connection you just created. The template fills in WFM's `POST /api/integrations/inbound/locations` route and maps one source location into WFM's required `records` array.
3. Supply source records with at least `code`, `name`, and `costCenter`. WFM uses `code` as the upsert key: an existing code updates that location; a new code creates a location.
4. Review the mapping preview and validation. WFM accepts the location business field names, including `code`, `name`, `costCenter`, `region`, `address`, `city`, `phone`, `status`, `weeklyLaborBudget`, and `operatingHours`.
5. In the execution/QA step, turn on **Allow manual QA Agent verification after a successful transfer**. Choose the fields to compare.
6. Save and activate the integration. Activating only enables it; it does not start it.
7. Start an execution only when you click the integration's **Execute** action and confirm the selected records.

The Employee template follows the same one-record `records` array pattern. Its source record must refer to a WFM location, department, job title, and optional manager that already exist in WFM.

## Step 9: Connect the local QA Agent

1. In Vercel, copy the value of `QA_AGENT_API_KEY` from the Hub's Production environment variables.
2. In the local QA Agent's `backend/.env`, set:

   ```dotenv
   HUB_BASE_URL=https://YOUR-HUB-URL
   HUB_QA_AGENT_API_KEY=the-exact-QA_AGENT_API_KEY-value
   ```

3. Keep the `HUB_BASE_URL` origin free of a trailing slash. Restart the local QA Agent backend after changing `.env`.
4. Create an enabled QA profile whose **Integration ID** exactly matches the Hub integration ID. For locations, its WFM query must use `code: "{recordId}"`; for employees, use `employeeId: "{recordId}"`. The local WFM read token may be a Manager or Administrator token and is configured in the Agent's local environment.
5. Run the Hub integration manually. After it succeeds, open the local Agent's **Integration Testing → Hub check** and click **Get latest Hub run and compare**. The Agent waits 60 seconds, fetches the specific record from WFM, compares it, and reports its result to the Hub.

## Manual-only behavior

- The Hub does not have an integration schedule configured. Integrations start only when a Hub user manually clicks **Execute**.
- The Hub's `/api/worker/tick` cron is scheduled once a day. It only recovers interrupted work and processes runs that were already queued by a user action; it does not create or schedule new integration runs.
- A successful Hub transfer and a QA check are separate actions. The QA Agent makes a Hub request only after you click its local check button.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Vercel deploys only the web app or says no matching framework | Confirm **Framework Preset = Services**, project root is the repository root, and the root `vercel.json` was included. |
| `/` loads but `/api/health` fails | Check the `server` service build and Vercel runtime logs. If the log mentions `Cannot use import statement outside a module` or `/var/task/src/app.js`, confirm the deployed `vercel.json` includes `"entrypoint": "api/index.ts"` for the server service, then redeploy the latest code. Also confirm `MONGODB_URI` and all required secrets exist in the Production environment. |
| `/api/ready` says database unavailable | Verify Atlas cluster is running, the URI/password is correct, the Hub database user has `readWrite` on `kp_integration_hub`, and Atlas Network Access permits Vercel. |
| Browser requests show `CORS_REJECTED` | Set `CORS_ORIGINS` to the exact Hub URL including `https://` and without a trailing slash, then redeploy. |
| First admin login fails | Confirm `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` were set before the first request and that the users collection was empty. Check server logs for bootstrap errors. |
| Hub-to-WFM returns 401/403 | Get a fresh WFM token using the PowerShell login steps in Step 7, update the saved token under **Hub → Connections → WFM connection → Edit**, save, and retest. The inbound write routes require an Administrator account. |
| QA Agent says invalid key | Compare the Hub `QA_AGENT_API_KEY` with local `HUB_QA_AGENT_API_KEY` exactly, then restart the local Agent backend. |
| A location/employee transfer returns per-record errors | Read the WFM response details. Check required fields, location codes, departments, job titles, employee IDs, and other referenced values against WFM. |
| QA Agent finds no matching profile | Ensure the profile is enabled and its Integration ID exactly matches the Hub integration ID. |

## Cost and plan notes

This setup uses Vercel and MongoDB Atlas free tiers when usage stays within their limits and the Vercel use complies with Hobby terms. “Free” does not mean unlimited or guaranteed indefinitely: both providers can change plan limits and terms. Vercel Hobby is for personal, non-commercial use; Atlas Free has finite storage, throughput, transfer, and backup limitations. Review the current [Vercel Hobby details](https://vercel.com/docs/plans/hobby) and [Atlas Free limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/) before using the Hub for business-critical or commercial traffic.
