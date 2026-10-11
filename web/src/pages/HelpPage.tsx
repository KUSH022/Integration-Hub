import { Link as RouterLink } from 'react-router-dom';
import type { ReactNode } from 'react';
import {
    Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Paper, Stack, Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CableOutlinedIcon from '@mui/icons-material/CableOutlined';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import HubOutlinedIcon from '@mui/icons-material/HubOutlined';
import StorageOutlinedIcon from '@mui/icons-material/StorageOutlined';
import { PageHeader } from '../components/common';

function Code({ children }: { children: string }) {
    return <Paper variant="outlined" component="pre" sx={{ p: 2, my: 1, overflowX: 'auto', bgcolor: 'grey.50', fontSize: 13, lineHeight: 1.6, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}>{children}</Paper>;
}

function HelpSection({ number, title, children, expanded = false }: { number: string; title: string; children: ReactNode; expanded?: boolean }) {
    return <Accordion defaultExpanded={expanded} disableGutters>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}><Typography fontWeight={700}>{number}. {title}</Typography></AccordionSummary>
        <AccordionDetails><Stack spacing={1.25} sx={{ '& p': { m: 0 }, '& ol, & ul': { mt: 0, mb: 0, pl: 3 }, '& li': { mb: 0.75 } }}>{children}</Stack></AccordionDetails>
    </Accordion>;
}

export default function HelpPage() {
    return <>
        <PageHeader title="Integration Hub Help" subtitle="A detailed walkthrough for creating, safely checking, and manually running an integration." />
        <Stack spacing={2}>
            <Alert severity="info">
                <strong>Integrations only run when a user starts them.</strong> Saving or activating an integration does not send data. The transfer starts when an authorized user reviews source data and clicks the Execute button.
            </Alert>

            <Paper sx={{ p: 2 }}>
                <Typography variant="h6" gutterBottom>Quick links</Typography>
                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                    <Button startIcon={<CableOutlinedIcon />} component={RouterLink} to="/connections">Connections</Button>
                    <Button startIcon={<ContentCopyOutlinedIcon />} component={RouterLink} to="/templates">Templates</Button>
                    <Button startIcon={<HubOutlinedIcon />} component={RouterLink} to="/integrations/new">New integration</Button>
                    <Button startIcon={<StorageOutlinedIcon />} component={RouterLink} to="/source-data">Source Data</Button>
                </Stack>
            </Paper>

            <HelpSection number="1" title="Prepare the information you need" expanded>
                <Typography>Before creating an integration, confirm what the source record looks like and what the destination API accepts. For an API that is not included with this project, use that system’s own API documentation; a template is only a starting configuration.</Typography>
                <ul>
                    <li><strong>Destination base URL:</strong> the public HTTPS address of the target application, with no API path appended.</li>
                    <li><strong>Endpoint and method:</strong> the documented write path and HTTP method, such as <code>POST /api/integrations/inbound/locations</code>.</li>
                    <li><strong>Authentication:</strong> the credential type and permissions required by the destination. For the included WFM location and employee inbound APIs, use an Administrator bearer token.</li>
                    <li><strong>Fields and identifiers:</strong> required fields, accepted values, and a stable unique key for each record.</li>
                    <li><strong>Success response:</strong> the HTTP status codes that mean the destination accepted the request.</li>
                </ul>
                <Alert severity="warning">Do not guess an endpoint, field mapping, or success status. Confirm them from the destination API contract before saving and activating the integration.</Alert>
            </HelpSection>

            <HelpSection number="2" title="Create and test the destination connection">
                <ol>
                    <li>Open <strong>Connections</strong> and choose <strong>New connection</strong>. You need an Administrator role to create connections and manage their credentials.</li>
                    <li>Enter a clear name, such as <code>WFM Production</code>. Select <strong>KP WFM</strong> for the included WFM app, or <strong>REST API</strong> for another destination.</li>
                    <li>Enter the destination’s base URL only. For example, use <code>https://your-wfm-app.vercel.app</code>, not a URL ending in <code>/api/...</code>.</li>
                    <li>Select <strong>Bearer token</strong> authentication. Enter a health-check path documented by the app. For the included WFM app, use <code>/api/health</code> and expected status <code>200</code>.</li>
                    <li>Save the connection. On its card, choose <strong>Set credential</strong> and paste the secret value. The Hub stores it server-side; do not put credentials in request headers, mappings, or sample data.</li>
                    <li>Choose <strong>Test connection</strong>. Resolve any URL, authentication, or health-check error before continuing.</li>
                    <li>After a successful test, choose <strong>Activate</strong>. An integration cannot send through an inactive connection.</li>
                </ol>
                <Alert severity="info">The Hub stores credentials separately from the integration and encrypts them. A connection test checks the configured health endpoint; it does not send a sample integration record.</Alert>
            </HelpSection>

            <HelpSection number="3" title="Start a new integration from a template">
                <ol>
                    <li>Open <strong>Templates</strong>. For this WFM app, choose <strong>Location inbound integration</strong> or <strong>Employee inbound integration</strong>, then click <strong>Use template</strong>.</li>
                    <li>The template pre-fills example mappings and validation rules. It does not select your connection, activate the integration, or send data.</li>
                    <li>For a different API, use <strong>Generic REST API integration</strong> only after you have its API contract, and replace the example settings with the documented request shape.</li>
                </ol>
                <Button component={RouterLink} to="/templates" variant="outlined" sx={{ alignSelf: 'flex-start' }}>Browse templates</Button>
            </HelpSection>

            <HelpSection number="4" title="Complete the seven setup steps">
                <ol>
                    <li><strong>Basic details:</strong> give the integration a clear name and purpose. Choose the correct entity, such as Location or Employee. Leave it inactive while configuring. Only an Administrator can activate it.</li>
                    <li><strong>Source:</strong> choose how you will provide records. For manual entry, keep <strong>Manually entered JSON records</strong>. Set the source record identifier field to the unique key (for example, <code>code</code> for locations or <code>employeeId</code> for employees). The sample is for mapping preview only; it is not a real submission.</li>
                    <li><strong>Destination:</strong> select the active connection, then confirm the HTTP method, endpoint path, and success statuses against the API documentation. For included WFM locations, the template uses <code>POST /api/integrations/inbound/locations</code> and status <code>200</code>. For employees, it uses <code>POST /api/integrations/inbound/employees</code>.</li>
                    <li><strong>Destination record identifier:</strong> configure where the WFM business key is captured. The included location template uses the transformed request’s <code>records.0.code</code>; employees use <code>records.0.employeeId</code>. This key lets the QA Agent read the same record later.</li>
                    <li><strong>Field mapping:</strong> each row maps a source field to the destination request field. Templates map a single source record into WFM’s one-record <code>records</code> array. Check the preview to confirm names and values land in the right fields.</li>
                    <li><strong>Validation rules:</strong> keep rules that reflect destination requirements. WFM locations require <code>code</code>, <code>name</code>, and <code>costCenter</code>. WFM employees require <code>employeeId</code>, <code>firstName</code>, <code>lastName</code>, <code>email</code>, <code>locationCode</code>, <code>department</code>, <code>jobTitle</code>, and <code>hourlyRate</code>. Employee references such as location, department, job title, or manager must already exist in WFM.</li>
                    <li><strong>Execution settings:</strong> choose a record batch limit and retry behavior suitable for the API. Leave idempotency off unless the destination explicitly documents support. Optionally enable manual QA Agent verification and choose the fields to compare. This does not start QA automatically.</li>
                    <li><strong>Review and save:</strong> read every validation error and warning, confirm the connection and transformed sample, then save. Saving creates or updates the configuration only; it does not run it.</li>
                </ol>
            </HelpSection>

            <HelpSection number="5" title="Activate only when the configuration is ready">
                <ol>
                    <li>Save the integration, then open its detail page from <strong>Integrations</strong>.</li>
                    <li>Review the integration ID, destination, mappings, success statuses, and whether manual QA is enabled.</li>
                    <li>An Administrator can click <strong>Activate</strong> after the destination connection is active. Activation makes the integration eligible to run; it does not send data by itself.</li>
                </ol>
            </HelpSection>

            <HelpSection number="6" title="Enter a source record, preview it, and run it manually">
                <ol>
                    <li>Open <strong>Source Data</strong>, choose the integration, and select <strong>Enter JSON record</strong> for one object. Use <strong>JSON payload (array)</strong> when pasting an array of objects.</li>
                    <li>Paste a source-shaped record. For one WFM location, for example:</li>
                </ol>
                <Code>{`{
  "code": "KP101",
  "name": "KP Downtown Store",
  "costCenter": "CC-101",
  "region": "North Region",
  "address": "1 Main Street",
  "city": "Milwaukee, WI",
  "status": "Active"
}`}</Code>
                <ol start={3}>
                    <li>Click <strong>Validate &amp; Preview</strong>. This parses the data, applies mappings, and shows validation errors. It does not save the source record or send anything to WFM.</li>
                    <li>Correct any invalid fields and preview again. For WFM, <code>code</code> is the location upsert key: a new code creates a location; sending an existing code updates that location.</li>
                    <li>To save a source snapshot without sending it, choose <strong>Store records only</strong>. This stores it in the Hub for later execution.</li>
                    <li>To transfer the data, click <strong>Execute … record(s)</strong>. This is the manual start. If some records are invalid, the Hub requires you to review and acknowledge the errors before executing the valid records.</li>
                </ol>
                <Alert severity="warning">Use a test record/code first. Clicking Execute sends a real request to the configured destination and may create or update records there.</Alert>
            </HelpSection>

            <HelpSection number="7" title="Review the result">
                <ol>
                    <li>Open <strong>Execution History</strong> or the integration’s <strong>Execution history</strong> tab.</li>
                    <li>Open the run to see the transfer status, HTTP response, errors, transformed request, and response details available for that run.</li>
                    <li>A successful HTTP transfer means the destination accepted the request. It is separate from the QA Agent’s later comparison result.</li>
                    <li>For included WFM, confirm a location by looking it up with the same <code>code</code> in WFM. For employees, use <code>employeeId</code>.</li>
                </ol>
                <Button component={RouterLink} to="/executions" variant="outlined" sx={{ alignSelf: 'flex-start' }}>Open Execution History</Button>
            </HelpSection>

            <HelpSection number="8" title="Optionally run the local QA Agent check">
                <ol>
                    <li>In the integration’s <strong>Execution settings</strong>, enable <strong>Allow manual QA Agent verification after a successful transfer</strong>, set comparison fields, and save the integration.</li>
                    <li>Start the QA Agent backend and frontend on your computer, then open its local web page.</li>
                    <li>In the Agent, open <strong>Integration Testing → Profiles</strong> and choose <strong>+ New profile</strong>.</li>
                    <li>Fill in the profile fields. <strong>Profile ID</strong> is a name you choose for this Agent profile; <strong>Hub integration ID</strong> is copied from the Hub integration detail page and must match exactly. For a location profile, use a unique Profile ID (for example <code>wfm-locations</code>), a clear Name, <code>Location</code> as Entity type, <code>Integration Hub</code> as Source system, and <code>WFM</code> as Target system.</li>
                    <li>For <strong>Verification config (JSON)</strong>, use the location configuration below. It tells the Agent to query WFM by the location code it receives from the Hub as <code>recordId</code>.</li>
                </ol>
                <Code>{`{
  "target": {
    "connection": "WFM",
    "endpoint": "/api/integrations/outbound/locations",
    "method": "GET",
    "headers": {},
    "query": { "code": "{recordId}", "page": 1, "limit": 1 },
    "timeout": 15,
    "expectedStatus": [200],
    "responsePath": "records.0"
  },
  "auth": { "type": "bearer", "ref": "WFM" }
}`}</Code>
                <Typography variant="subtitle2">For an employee integration instead</Typography>
                <Typography>Use <code>Employee</code> as Entity type and replace the target endpoint and query with the employee lookup shown here. Keep the WFM connection and bearer authentication reference.</Typography>
                <Code>{`{
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
  "auth": { "type": "bearer", "ref": "WFM" }
}`}</Code>
                <ol start={6}>
                    <li>In the Agent’s local <code>backend/.env</code>, set <code>CONN_WFM_URL</code> to the WFM base URL and <code>SECRET_WFM</code> to a WFM Manager or Administrator bearer token. Paste only the token value—do not add <code>Bearer </code>. Set <code>HUB_BASE_URL</code> to the Hub URL and make <code>HUB_QA_AGENT_API_KEY</code> match <code>QA_AGENT_API_KEY</code> in the Hub’s Vercel environment.</li>
                    <li>Save the profile. New profiles are enabled by default; return to the profile list and confirm its <strong>Enabled</strong> value is <strong>Yes</strong>. Restart the local backend after changing its <code>.env</code> file.</li>
                    <li>Run the integration manually in the Hub and wait for a successful transfer. In the local Agent, open <strong>Integration Testing → Hub check</strong> and click <strong>Get latest Hub run and compare</strong>.</li>
                    <li>The Agent waits about one minute, reads only the matching WFM record, compares the Hub’s expected values, and displays PASS/FAIL with any differences. View the details under <strong>Integration Testing → Executions</strong>.</li>
                </ol>
                <Alert severity="info">The Hub does not start the local QA Agent. Enabling this option only makes successful runs available for a manual check; you still click the check button in the Agent.</Alert>
            </HelpSection>

            <HelpSection number="9" title="Common problems and what to check">
                <ul>
                    <li><strong>Test connection fails:</strong> verify the base URL, health-check path, current credential, and required account role.</li>
                    <li><strong>Preview shows missing required fields:</strong> confirm the source JSON field names and mapping rows. Errors are checked against the transformed destination payload.</li>
                    <li><strong>Execute is unavailable:</strong> verify the integration is active, its connection is active, your role can execute, and at least one record passed validation.</li>
                    <li><strong>WFM returns 401 or 403:</strong> the Hub’s stored write credential may be missing, expired, or lack Administrator permissions. Update it under Connections and test again.</li>
                    <li><strong>Location already exists:</strong> WFM uses <code>code</code> as its upsert key, so the same code updates the existing location rather than creating a second one.</li>
                    <li><strong>“No source records stored” after preview:</strong> this is expected until you click <strong>Store records only</strong> or <strong>Execute</strong>.</li>
                    <li><strong>QA Agent has no run to check:</strong> confirm the transfer succeeded, manual QA is enabled, and the Agent profile is enabled with the exact Integration ID.</li>
                    <li><strong>QA lookup returns no WFM record:</strong> verify the Hub run has the correct record ID and the profile filters by the same WFM key (<code>code</code> for locations or <code>employeeId</code> for employees).</li>
                </ul>
            </HelpSection>
        </Stack>
    </>;
}
