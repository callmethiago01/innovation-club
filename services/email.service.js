import nodemailer from "nodemailer";

function getEmailConfiguration() {
  const { SMTP_HOST, SMTP_USER, SMTP_PASSWORD, SMTP_FROM_EMAIL } = process.env;
  const port = Number(process.env.SMTP_PORT || 587);
  if (
    !SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD || !SMTP_FROM_EMAIL ||
    !Number.isInteger(port) || port < 1 || port > 65535
  ) {
    return null;
  }
  return {
    host: SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE === "true",
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
    from: SMTP_FROM_EMAIL,
    clubEmail: process.env.CLUB_APPLICATION_EMAIL_TO || "pkwizera93@gmail.com",
  };
}

async function deliverMail({ to, subject, text }) {
  const config = getEmailConfiguration();
  if (!config) {
    return { sent: false, error: "SMTP email settings are incomplete." };
  }
  try {
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.auth,
    });
    await transporter.sendMail({ from: config.from, to, subject, text });
    return { sent: true };
  } catch (error) {
    console.error("Could not send membership application email:", error);
    return { sent: false, error: "The email provider could not deliver the message." };
  }
}

export async function sendApplicationVerification({ fullName, email, token }) {
  const baseUrl = process.env.FRONTEND_URL;
  if (!baseUrl) {
    return { sent: false, error: "FRONTEND_URL is not configured." };
  }
  let verifyUrl;
  try {
    verifyUrl = new URL("/join", baseUrl);
    verifyUrl.searchParams.set("verify", token);
  } catch {
    return { sent: false, error: "FRONTEND_URL is invalid." };
  }
  return deliverMail({
    to: email,
    subject: "Verify your Innovation Club application email",
    text: `Hello ${fullName},\n\nConfirm that this is your email address by opening this link:\n${verifyUrl.href}\n\nThe link expires in 24 hours. If you did not apply to Innovation Club, you can ignore this message.`,
  });
}

export async function sendClubApplicationNotification(application, verified = true) {
  const config = getEmailConfiguration();
  if (!config) {
    return { sent: false, error: "SMTP email settings are incomplete." };
  }
  return deliverMail({
    to: config.clubEmail,
    subject: verified
      ? `Verified club application: ${application.fullName}`
      : `New club application awaiting email verification: ${application.fullName}`,
    text: [
      verified
        ? `A new membership application has been verified.`
        : `A new membership application has been submitted. The applicant has not verified their email address yet.`,
      ``,
      `Name: ${application.fullName}`,
      `Email: ${application.email}`,
      `Trade: ${application.trade}`,
      `Learning level: ${application.learningLevel}`,
      `Department: ${application.department}`,
      ``,
      `Why they want to join:`,
      application.motivation,
    ].join("\n"),
  });
}
