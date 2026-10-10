/**
 * MongoDB access for the Hub's dedicated database. Never connects to KP WFM or KP QA Agent databases.
 * Schema setup is additive and idempotent: it never drops collections or deletes data.
 */
import { MongoClient, type Db, type Collection, type Document } from 'mongodb';
import type { AppConfig } from '../config/env.js';

export const COLLECTIONS = {
  users: 'users',
  sessions: 'sessions',
  integrations: 'integrations',
  integrationVersions: 'integration_versions',
  connections: 'connections',
  sourceRecords: 'source_records',
  runs: 'integration_runs',
  auditLogs: 'audit_logs',
  idempotency: 'idempotency_records',
} as const;

const str = { bsonType: 'string' };
const date = { bsonType: 'date' };
const obj = { bsonType: 'object' };

const VALIDATORS: Record<string, Document> = {
  [COLLECTIONS.users]: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'email', 'passwordHash', 'role', 'active', 'createdAt', 'updatedAt'],
      properties: { _id: str, email: str, name: str, passwordHash: str, role: { enum: ['ADMIN', 'OPERATOR', 'VIEWER'] }, active: { bsonType: 'bool' }, createdAt: date, updatedAt: date },
    },
  },
  [COLLECTIONS.sessions]: {
    $jsonSchema: { bsonType: 'object', required: ['_id', 'userId', 'expiresAt', 'createdAt'], properties: { _id: str, userId: str, expiresAt: date, createdAt: date } },
  },
  [COLLECTIONS.connections]: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'name', 'application', 'baseUrl', 'authType', 'active', 'version', 'createdAt', 'updatedAt'],
      properties: {
        _id: str, name: str, application: { enum: ['KP_WFM', 'KP_QA_AGENT', 'REST_API'] }, baseUrl: str, authType: { enum: ['NONE', 'BEARER', 'API_KEY'] },
        active: { bsonType: 'bool' }, version: { bsonType: ['int', 'long', 'double'] }, createdAt: date, updatedAt: date,
        secret: { bsonType: ['object', 'null'], properties: { v: { bsonType: ['int', 'double'] }, iv: str, tag: str, data: str } },
      },
    },
  },
  [COLLECTIONS.integrations]: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'name', 'entityType', 'source', 'destination', 'mappings', 'validationRules', 'execution', 'qa', 'active', 'version', 'createdAt', 'updatedAt'],
      properties: { _id: str, name: str, entityType: str, source: obj, destination: obj, mappings: { bsonType: 'array' }, validationRules: { bsonType: 'array' }, execution: obj, qa: obj, active: { bsonType: 'bool' }, createdAt: date, updatedAt: date },
    },
  },
  [COLLECTIONS.integrationVersions]: {
    $jsonSchema: { bsonType: 'object', required: ['_id', 'integrationId', 'version', 'config', 'changeType', 'createdAt'], properties: { _id: str, integrationId: str, config: obj, changeType: str, createdAt: date } },
  },
  [COLLECTIONS.sourceRecords]: {
    $jsonSchema: { bsonType: 'object', required: ['_id', 'submissionId', 'sourceType', 'payload', 'payloadHash', 'createdAt'], properties: { _id: str, submissionId: str, sourceType: str, payload: obj, payloadHash: str, createdAt: date } },
  },
  [COLLECTIONS.runs]: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'correlationId', 'integrationId', 'entityType', 'sourceSnapshot', 'sourceSnapshotHash', 'transferStatus', 'qa', 'verification', 'createdAt', 'updatedAt'],
      properties: {
        _id: str, correlationId: str, integrationId: str, entityType: str, sourceSnapshot: obj, sourceSnapshotHash: str,
        transferStatus: { enum: ['PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'RETRYING', 'TIMEOUT', 'CANCELLED'] },
        qa: { bsonType: 'object', required: ['status'], properties: { status: { enum: ['NOT_REQUESTED', 'NOT_STARTED', 'PENDING', 'RUNNING', 'PASSED', 'FAILED', 'ERROR'] } } },
        verification: obj, createdAt: date, updatedAt: date,
      },
    },
  },
  [COLLECTIONS.auditLogs]: {
    $jsonSchema: { bsonType: 'object', required: ['_id', 'timestamp', 'action', 'result'], properties: { _id: str, timestamp: date, action: str, resourceType: str, resourceId: str, result: { enum: ['SUCCESS', 'FAILURE'] } } },
  },
  [COLLECTIONS.idempotency]: {
    $jsonSchema: { bsonType: 'object', required: ['_id', 'integrationId', 'runId', 'status', 'createdAt'], properties: { _id: str, integrationId: str, runId: str, status: str, createdAt: date } },
  },
};

type IndexSpec = { key: Document; options?: Document };
const INDEXES: Record<string, IndexSpec[]> = {
  [COLLECTIONS.users]: [{ key: { email: 1 }, options: { unique: true, name: 'email_unique' } }],
  [COLLECTIONS.sessions]: [{ key: { expiresAt: 1 }, options: { expireAfterSeconds: 0, name: 'session_ttl' } }, { key: { userId: 1 } }],
  [COLLECTIONS.connections]: [{ key: { name: 1 }, options: { unique: true, name: 'name_unique' } }, { key: { application: 1, active: 1 } }],
  [COLLECTIONS.integrations]: [{ key: { name: 1 }, options: { unique: true, name: 'name_unique' } }, { key: { active: 1, entityType: 1 } }, { key: { updatedAt: -1 } }],
  [COLLECTIONS.integrationVersions]: [{ key: { integrationId: 1, version: -1 }, options: { unique: true, name: 'integration_version_unique' } }],
  [COLLECTIONS.sourceRecords]: [{ key: { submissionId: 1, recordIndex: 1 } }, { key: { createdAt: -1 } }, { key: { integrationId: 1, createdAt: -1 } }, { key: { retainUntil: 1 }, options: { expireAfterSeconds: 0, name: 'retention_ttl' } }],
  [COLLECTIONS.runs]: [
    { key: { transferStatus: 1, createdAt: 1 }, options: { name: 'worker_queue' } },
    { key: { 'qa.status': 1, 'qa.nextPollAt': 1 }, options: { name: 'qa_queue' } },
    { key: { createdAt: -1 } },
    { key: { integrationId: 1, createdAt: -1 } },
    { key: { correlationId: 1 } },
    { key: { batchId: 1 } },
    { key: { entityType: 1, createdAt: -1 } },
    { key: { integrationId: 1, transferStatus: 1, sourceRecordKey: 1 } },
    { key: { retainUntil: 1 }, options: { expireAfterSeconds: 0, name: 'retention_ttl' } },
  ],
  [COLLECTIONS.auditLogs]: [{ key: { timestamp: -1 } }, { key: { resourceId: 1, timestamp: -1 } }, { key: { action: 1, timestamp: -1 } }, { key: { retainUntil: 1 }, options: { expireAfterSeconds: 0, name: 'retention_ttl' } }],
  [COLLECTIONS.idempotency]: [{ key: { integrationId: 1, createdAt: -1 } }],
};

export async function connectMongo(config: Pick<AppConfig, 'MONGODB_URI' | 'MONGODB_DB_NAME'>) {
  const client = new MongoClient(config.MONGODB_URI, { maxPoolSize: 10, appName: 'kp-integration-hub', serverSelectionTimeoutMS: 15000 });
  await client.connect();
  const db = client.db(config.MONGODB_DB_NAME);
  return { client, db };
}

/** Creates missing collections, (re)applies validators with collMod and creates indexes. Never deletes data. */
export async function ensureSchema(db: Db, log: (m: string) => void = () => {}): Promise<void> {
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  for (const [name, validator] of Object.entries(VALIDATORS)) {
    if (!existing.has(name)) {
      await db.createCollection(name, { validator, validationLevel: 'moderate', validationAction: 'error' });
      log(`created collection ${name}`);
    } else {
      await db.command({ collMod: name, validator, validationLevel: 'moderate', validationAction: 'error' });
    }
    for (const idx of INDEXES[name] ?? []) {
      await db.collection(name).createIndex(idx.key, idx.options ?? {});
    }
  }
  log('schema and indexes are up to date');
}

export type Collections = ReturnType<typeof getCollections>;

export function getCollections(db: Db) {
  const c = <T extends Document>(n: string) => db.collection<T>(n) as Collection<T>;
  return {
    users: c<Document>(COLLECTIONS.users),
    sessions: c<Document>(COLLECTIONS.sessions),
    integrations: c<Document>(COLLECTIONS.integrations),
    integrationVersions: c<Document>(COLLECTIONS.integrationVersions),
    connections: c<Document>(COLLECTIONS.connections),
    sourceRecords: c<Document>(COLLECTIONS.sourceRecords),
    runs: c<Document>(COLLECTIONS.runs),
    auditLogs: c<Document>(COLLECTIONS.auditLogs),
    idempotency: c<Document>(COLLECTIONS.idempotency),
  };
}

export function retentionDate(days: number, from = new Date()): Date | null {
  return days > 0 ? new Date(from.getTime() + days * 86_400_000) : null;
}
