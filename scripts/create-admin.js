import "dotenv/config";
import process from "node:process";
import { closeDatabase, query } from "../db.js";
import { hashPassword } from "../services/auth.service.js";

async function createInitialAdmin() {
  const fullName = process.env.ADMIN_NAME?.trim();
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (!fullName || fullName.length < 2 || fullName.length > 100) {
    throw new Error("Set ADMIN_NAME to the administrator's full name.");
  }
  if (!email || email.length > 254 || !email.includes("@")) {
    throw new Error("Set ADMIN_EMAIL to a valid email address.");
  }
  if (!password || password.length < 10 || password.length > 256) {
    throw new Error("Set ADMIN_PASSWORD to a password between 10 and 256 characters.");
  }

  const existing = await query("SELECT 1 FROM users WHERE LOWER(email) = $1", [email]);
  if (existing.rowCount > 0) {
    throw new Error("An account with that email already exists.");
  }

  const passwordHash = await hashPassword(password);
  const result = await query(
    `INSERT INTO users (full_name, email, password_hash, role)
     VALUES ($1, $2, $3, 'admin')
     RETURNING id, email`,
    [fullName, email, passwordHash],
  );
  console.log(`Created initial administrator account ${result.rows[0].email}.`);
}

try {
  await createInitialAdmin();
} catch (error) {
  console.error("Could not create the administrator account:", error.message);
  process.exitCode = 1;
} finally {
  try {
    await closeDatabase();
  } catch (error) {
    console.error("Could not close the database connection:", error.message);
    process.exitCode = 1;
  }
}