import { query } from "../db.js";
import {
	createSessionToken,
	hashPassword,
	ROLES,
	SESSION_COOKIE,
	sessionCookieOptions,
	verifyPassword,
} from "../services/auth.service.js";

function publicUser(user) {
	return {
		id: String(user.id),
		fullName: user.full_name,
		email: user.email,
		role: user.role,
		profileImage: user.profile_image ?? null,
		department: user.department ?? "",
	};
}

export async function login(request, response) {
	const email = request.body.email.trim().toLowerCase();
	const { password } = request.body;
	const result = await query(
		"SELECT id, full_name, email, password_hash, role, profile_image, department, is_active FROM users WHERE LOWER(email) = $1",
		[email],
	);
	const user = result.rows[0];

	if (!user || !user.is_active || !(await verifyPassword(password, user.password_hash))) {
		response.status(401).json({ error: "Email or password is incorrect." });
		return;
	}

	response.cookie(SESSION_COOKIE, createSessionToken(user), sessionCookieOptions());
	response.json({ user: publicUser(user) });
}

export function currentUser(request, response) {
	response.json({ user: request.user });
}

export async function updateCurrentUser(request, response, next) {
	const { fullName, email } = request.body;
	if (
		request.body.department !== undefined &&
		request.body.department !== (request.user.department ?? "")
	) {
		response.status(403).json({ error: "Contact an administrator if your department needs to be changed." });
		return;
	}
	try {
		const result = await query(
			`UPDATE users
			 SET full_name = $1, email = $2, profile_image = $3, updated_at = NOW()
			 WHERE id = $4 AND is_active = TRUE
			 RETURNING id, full_name, email, role, profile_image, department`,
			[
				fullName.trim(),
				email.trim().toLowerCase(),
				request.body.profileImage === undefined
					? request.user.profileImage ?? null
					: request.body.profileImage,
				request.user.id,
			],
		);
		if (!result.rowCount) {
			response.status(404).json({ error: "This account is unavailable." });
			return;
		}
		response.json({ user: publicUser(result.rows[0]) });
	} catch (error) {
		if (error.code === "23505") {
			response.status(409).json({ error: "An account with that email already exists." });
			return;
		}
		next(error);
	}
}

export async function updatePassword(request, response, next) {
	try {
		const { currentPassword, newPassword } = request.body;
		const result = await query(
			"SELECT password_hash FROM users WHERE id = $1 AND is_active = TRUE",
			[request.user.id],
		);
		if (!result.rowCount || !(await verifyPassword(currentPassword, result.rows[0].password_hash))) {
			response.status(400).json({ error: "Your current password is incorrect." });
			return;
		}
		const passwordHash = await hashPassword(newPassword);
		await query(
			"UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2",
			[passwordHash, request.user.id],
		);
		response.json({ message: "Your password was updated." });
	} catch (error) {
		next(error);
	}
}

export function logout(_request, response) {
	response.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: "lax", path: "/" });
	response.status(204).end();
}

export async function createUser(request, response, next) {
	const { fullName, email, password, role, department } = request.body;
	if (!ROLES.includes(role)) {
		response.status(400).json({ error: "Choose a valid account role." });
		return;
	}
	const assignedDepartment = role === "member" && typeof department === "string"
		? department.trim()
		: "";
	if (
		typeof fullName !== "string" ||
		fullName.trim().length < 2 ||
		typeof email !== "string" ||
		!email.trim() ||
		typeof password !== "string" ||
		password.length < 10 ||
		(role === "member" && !assignedDepartment)
	) {
		response.status(400).json({ error: "Provide a valid name, email, password, and a department for member accounts." });
		return;
	}

	const passwordHash = await hashPassword(password);
	try {
		const result = await query(
			`INSERT INTO users (full_name, email, password_hash, role, department)
			 VALUES ($1, $2, $3, $4, $5)
			 RETURNING id, full_name, email, role, department, is_active, created_at`,
			[fullName.trim(), email.trim().toLowerCase(), passwordHash, role, assignedDepartment],
		);
		response.status(201).json({ user: publicUser(result.rows[0]) });
	} catch (error) {
		if (error.code === "23505") {
			response.status(409).json({ error: "An account with that email already exists." });
			return;
		}
		next(error);
	}
}
