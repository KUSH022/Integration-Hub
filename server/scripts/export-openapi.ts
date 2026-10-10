/**
 * Writes the OpenAPI document generated from the implemented route registry to docs/openapi.json.
 * Usage: npm run openapi --workspace server
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { buildOpenApi } from '../src/http/openapi.js';
import '../src/app.js'; // registers every implemented route

mkdirSync('../docs', { recursive: true });
writeFileSync('../docs/openapi.json', JSON.stringify(buildOpenApi(), null, 2));
console.log('Wrote docs/openapi.json');
