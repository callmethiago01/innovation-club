import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import jwt from "jsonwebtoken";

const scrypt = promisify(scryptCallback);
export const SESSION_COOKIE = "innovation_session";
export const SESSION_MAX_AGE = 8 * 60 * 60 * 1000;
export const ROLES = ["admin", "treasurer", "secretary", "coordinator", "member"];

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET must be set to at least 32 characters.");
  }
  return secret;
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password, storedHash) {
  const [algorithm, salt, expectedHex] = storedHash.split("$");
  if (algorithm !== "scrypt" || !salt || !expectedHex) return false;

  const expected = Buffer.from(expectedHex, "hex");
  const actual = await scrypt(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createSessionToken(user) {
  return jwt.sign({ role: user.role }, getJwtSecret(), {
    subject: String(user.id),
    expiresIn: "8h",
    issuer: "innovate-hub",
    audience: "innovate-hub-web",
  });
}

export function readSessionToken(token) {
  return jwt.verify(token, getJwtSecret(), {
    issuer: "innovate-hub",
    audience: "innovate-hub-web",
  });
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  };
}