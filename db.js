import "dotenv/config";
import { readFile } from "node:fs/promises";
import pg from "pg";

const { Pool } = pg;

const databaseUrl = process.env.DATABASE_URL;
const databasePort = Number(process.env.DB_PORT ?? 5432);

if (!databaseUrl && (!process.env.DB_HOST || !process.env.DB_NAME || !process.env.DB_USER)) {
  throw new Error(
    "Set DATABASE_URL or provide DB_HOST, DB_NAME, and DB_USER in the backend .env file.",
  );
}

if (!Number.isInteger(databasePort) || databasePort < 1 || databasePort > 65535) {
  throw new Error("DB_PORT must be a valid port number.");
}

const poolConfig = databaseUrl
  ? { connectionString: databaseUrl }
  : {
      host: process.env.DB_HOST,
      port: databasePort,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    };

if (process.env.DB_SSL === "true") {
  poolConfig.ssl = { rejectUnauthorized: true };
}

export const pool = new Pool(poolConfig);

export function query(text, values) {
  return pool.query(text, values);
}

async function ensureSchema() {
  const requiredTables = [
    "users",
    "projects",
    "project_members",
    "project_proposals",
    "project_comments",
    "project_milestones",
    "project_files",
    "tasks",
    "events",
    "meetings",
    "attendance",
    "financial_transactions",
    "announcements",
    "club_news",
    "gallery_items",
    "club_leadership",
    "club_content",
    "achievements",
    "approval_requests",
    "resources",
    "conversations",
    "conversation_members",
    "messages",
    "message_receipts",
    "chat_media",
    "calls",
    "call_signals",
    "notifications",
    "membership_applications",
  ];

  const { rows } = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name IN (${requiredTables.map((table) => `'${table}'`).join(", ")})
  `);
  const { rows: columnRows } = await pool.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND ((table_name = 'users' AND column_name IN ('department', 'updated_at'))
        OR (table_name = 'projects' AND column_name = 'department')
        OR (table_name = 'messages' AND column_name IN ('message_type', 'media_mime', 'media_data', 'media_duration', 'edited_at', 'deleted_at')))
  `);
  const { rows: roleConstraints } = await pool.query(`
    SELECT pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid = to_regclass('users')
      AND conname = 'users_role_check'
  `);

  const existingTables = new Set(rows.map((row) => row.table_name));
  const existingColumns = new Set(columnRows.map((row) => `${row.table_name}.${row.column_name}`));
  const requiredColumns = [
    "users.department",
    "users.updated_at",
    "projects.department",
    "messages.message_type",
    "messages.media_mime",
    "messages.media_data",
    "messages.media_duration",
    "messages.edited_at",
    "messages.deleted_at",
  ];
  const hasNonMemberDepartment = existingColumns.has("users.department")
    ? (await pool.query(`
        SELECT EXISTS (
          SELECT 1 FROM users
          WHERE role IN ('admin', 'treasurer', 'secretary', 'coordinator')
            AND department IS DISTINCT FROM ''
        ) AS present
      `)).rows[0].present
    : false;
  const acceptsMemberRole = roleConstraints.some((row) => row.definition.includes("'member'"));
  const isSchemaReady = requiredTables.every((table) => existingTables.has(table))
    && requiredColumns.every((column) => existingColumns.has(column))
    && acceptsMemberRole
    && !hasNonMemberDepartment;
  if (isSchemaReady) {
    return;
  }

  const schemaSql = await readFile(new URL("./sql/schema.sql", import.meta.url), "utf8");
  await pool.query(schemaSql);
}

export async function connectDatabase() {
  await pool.query("SELECT 1");
  await ensureSchema();
}

export function closeDatabase() {
  return pool.end();
}
