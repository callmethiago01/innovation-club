import { createHash, randomBytes } from "node:crypto";
import { pool, query } from "../db.js";
import {
  sendApplicationVerification,
  sendClubApplicationNotification,
} from "../services/email.service.js";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const trades = [
  "Software Development",
  "Accounting",
  "Internet and Networking",
  "Food and Beverage",
  "Tourism",
  "Building Construction",
];
const levels = ["Senior 3", "Senior 4", "Senior 5"];
const departments = [
  "Digital Transformation & Technology",
  "Research, Strategy & Innovation",
  "Entrepreneurship & Venture Development",
  "Learning, Talent & Leadership Development",
  "Innovation Projects & Program Delivery",
  "Corporate Affairs & Strategic Partnerships",
  "Not sure yet",
];

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function validText(value, minLength, maxLength) {
  return typeof value === "string" && value.trim().length >= minLength && value.length <= maxLength;
}

export async function createApplication(request, response, next) {
  const { fullName, email, trade, learningLevel, department, motivation } = request.body ?? {};
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (
    !validText(fullName, 2, 100) ||
    !emailPattern.test(normalizedEmail) || normalizedEmail.length > 254 ||
    !trades.includes(trade) ||
    !levels.includes(learningLevel) ||
    !departments.includes(department) ||
    !validText(motivation, 5, 1200)
  ) {
    response.status(400).json({ error: "Enter a valid name, real email address, and complete all application fields." });
    return;
  }

  const token = randomBytes(32).toString("base64url");
  let client;
  let transactionStarted = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    transactionStarted = true;
    const result = await client.query(
      `INSERT INTO membership_applications
         (full_name, email, trade, learning_level, department, motivation,
          verification_token_hash, verification_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() + INTERVAL '24 hours')
       RETURNING id`,
      [
        fullName.trim(),
        normalizedEmail,
        trade,
        learningLevel,
        department,
        motivation.trim(),
        hashToken(token),
      ],
    );
    const applicationId = String(result.rows[0].id);
    await client.query(
      `INSERT INTO notifications (user_id, title, body)
       SELECT id, 'New club application', $1
       FROM users
       WHERE role = 'admin' AND is_active = TRUE`,
      [`${fullName.trim()} submitted an application. Email verification is pending.`],
    );
    await client.query("COMMIT");
    transactionStarted = false;

    const [verificationEmail, clubEmail] = await Promise.all([
      sendApplicationVerification({
        fullName: fullName.trim(),
        email: normalizedEmail,
        token,
      }),
      sendClubApplicationNotification({
        fullName: fullName.trim(),
        email: normalizedEmail,
        trade,
        learningLevel,
        department,
        motivation: motivation.trim(),
      }, false),
    ]);
    response.status(201).json({
      applicationId,
      emailSent: verificationEmail.sent,
      notificationSent: clubEmail.sent,
      message: verificationEmail.sent
        ? clubEmail.sent
          ? "Application received. The club has been notified. Check your email and open the verification link to complete your application."
          : "Application received and verification email sent. The club email notification is not configured yet."
        : clubEmail.sent
          ? "Application received and the club has been notified, but we could not send your verification email. Please try again later or contact the club."
          : "Application saved, but email delivery is not configured yet. The club inbox and website notification have your application; try resending the verification email later.",
    });
  } catch (error) {
    if (client && transactionStarted) await client.query("ROLLBACK");
    next(error);
  } finally {
    client?.release();
  }
}

export async function verifyApplicationEmail(request, response, next) {
  const token = typeof request.query.token === "string" ? request.query.token : "";
  if (!/^[A-Za-z0-9_-]{40,50}$/.test(token)) {
    response.status(400).json({ error: "This verification link is invalid." });
    return;
  }
  try {
    const result = await query(
      `UPDATE membership_applications
       SET status = 'pending', email_verified_at = NOW()
       WHERE verification_token_hash = $1
         AND verification_expires_at > NOW()
         AND status = 'pending_verification'
       RETURNING id, full_name, email, trade, learning_level, department, motivation`,
      [hashToken(token)],
    );
    if (!result.rowCount) {
      const alreadyVerified = await query(
        `SELECT 1 FROM membership_applications
         WHERE verification_token_hash = $1
           AND email_verified_at IS NOT NULL
           AND verification_expires_at > NOW()`,
        [hashToken(token)],
      );
      if (!alreadyVerified.rowCount) {
        response.status(400).json({ error: "This verification link has expired or has already been used." });
        return;
      }
      response.json({
        verified: true,
        clubEmailSent: null,
        message: "Your email address has already been verified.",
      });
      return;
    }
    const application = result.rows[0];
    const emailResult = await sendClubApplicationNotification({
      fullName: application.full_name,
      email: application.email,
      trade: application.trade,
      learningLevel: application.learning_level,
      department: application.department,
      motivation: application.motivation,
    });
    response.json({
      verified: true,
      clubEmailSent: emailResult.sent,
      message: emailResult.sent
        ? "Your email is verified and your application has been sent to the club."
        : "Your email is verified and your application is in the club inbox. The club email notification is not configured yet.",
    });
  } catch (error) {
    next(error);
  }
}

export async function resendApplicationVerification(request, response, next) {
  const { applicationId, email } = request.body ?? {};
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!/^\d+$/.test(String(applicationId ?? "")) || !emailPattern.test(normalizedEmail)) {
    response.status(400).json({ error: "Enter the application number and the email address used to apply." });
    return;
  }
  const token = randomBytes(32).toString("base64url");
  try {
    const result = await query(
      `UPDATE membership_applications
       SET verification_token_hash = $1,
           verification_expires_at = NOW() + INTERVAL '24 hours'
       WHERE id = $2 AND email = $3 AND status = 'pending_verification'
       RETURNING full_name, email`,
      [hashToken(token), applicationId, normalizedEmail],
    );
    if (!result.rowCount) {
      response.status(404).json({ error: "No unverified application matches those details." });
      return;
    }
    const emailResult = await sendApplicationVerification({
      fullName: result.rows[0].full_name,
      email: result.rows[0].email,
      token,
    });
    response.json({
      emailSent: emailResult.sent,
      message: emailResult.sent
        ? "A new verification link has been sent to your email."
        : "Your application is saved, but email delivery is not configured yet.",
    });
  } catch (error) {
    next(error);
  }
}

export async function listApplications(_request, response, next) {
  try {
    const result = await query(
      `SELECT id, full_name, email, trade, learning_level, department,
              motivation, status, email_verified_at, created_at, reviewed_at
       FROM membership_applications
       ORDER BY created_at DESC
       LIMIT 500`,
    );
    response.json({
      applications: result.rows.map((application) => ({
        ...application,
        id: String(application.id),
      })),
    });
  } catch (error) {
    next(error);
  }
}

export async function reviewApplication(request, response, next) {
  const { id } = request.params;
  const { status } = request.body ?? {};
  if (!/^\d+$/.test(id) || !["approved", "rejected"].includes(status)) {
    response.status(400).json({ error: "Choose a valid application and review decision." });
    return;
  }
  try {
    const result = await query(
      `UPDATE membership_applications
       SET status = $1, reviewed_by = $2, reviewed_at = NOW()
       WHERE id = $3 AND status = 'pending'
       RETURNING id, full_name, email, status`,
      [status, request.user.id, id],
    );
    if (!result.rowCount) {
      response.status(404).json({ error: "Application not found, not verified, or already reviewed." });
      return;
    }
    const application = result.rows[0];
    await query(
      `INSERT INTO notifications (user_id, title, body)
       SELECT id, 'Application reviewed', $1
       FROM users
       WHERE id = $2`,
      [`${application.full_name}'s club application was ${status}.`, request.user.id],
    );
    response.json({
      application: { ...application, id: String(application.id) },
    });
  } catch (error) {
    next(error);
  }
}
