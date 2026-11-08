
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { query } from "./db.js";
import { hashPassword } from "./services/auth.service.js";

const rl = createInterface({ input: stdin, output: stdout });

try {
  const email = (await rl.question("Admin email: "))
    .trim()
    .toLowerCase();

  const password = await rl.question(
    "Enter your new password (minimum 10 characters): "
  );

  if (password.length < 10 || password.length > 256) {
    throw new Error("Password must contain 10 to 256 characters.");
  }

  const result = await query(
    `UPDATE users
     SET password_hash = $1
     WHERE LOWER(email) = $2 AND role = 'admin'
     RETURNING id, email, role`,
    [await hashPassword(password), email]
  );

  if (result.rowCount === 0) {
    console.log("No admin account found with that email.");
  } else {
    console.log("Admin password reset successfully.");
    console.log("Account:", result.rows[0].email);
    console.log("You can now log in with your new password.");
  }
} catch (error) {
  console.error("Password reset failed:", error.message);
  process.exitCode = 1;
} finally {
  rl.close();
}
