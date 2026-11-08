import { query } from "../db.js";
import { readSessionToken, SESSION_COOKIE } from "../services/auth.service.js";

export async function authenticateToken(request, response, next) {
  const authorization = request.get("authorization");
  const [scheme, token] = authorization?.split(" ") ?? [];
  const cookieHeader = request.get("cookie") ?? "";
  const sessionCookie = cookieHeader
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  const sessionToken = sessionCookie ??
    (scheme === "Bearer" ? token : undefined);

  if (!sessionToken) {
    response.status(401).json({ error: "Authentication token required." });
    return;
  }

  let payload;
  try {
    payload = readSessionToken(decodeURIComponent(sessionToken));
  } catch {
    response.status(401).json({ error: "Invalid or expired authentication token." });
    return;
  }

  if (
    typeof payload === "string" ||
    typeof payload.sub !== "string" ||
    typeof payload.role !== "string"
  ) {
    response.status(401).json({ error: "Invalid authentication token." });
    return;
  }

  const result = await query(
    "SELECT id, full_name, email, role, profile_image, department, is_active FROM users WHERE id = $1",
    [payload.sub],
  );
  const user = result.rows[0];
  if (!user || !user.is_active) {
    response.status(401).json({ error: "This account is unavailable." });
    return;
  }
  request.user = {
    id: String(user.id),
    fullName: user.full_name,
    email: user.email,
    role: user.role,
    profileImage: user.profile_image,
    department: user.department,
  };

  next();
}

export function requireRoles(...roles) {
  return (request, response, next) => {
    if (!request.user) {
      response.status(401).json({ error: "Authentication required." });
      return;
    }

    if (!roles.includes(request.user.role)) {
      response.status(403).json({ error: "You do not have permission to access this resource." });
      return;
    }

    next();
  };
}
