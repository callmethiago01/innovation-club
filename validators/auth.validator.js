import { ROLES } from "../services/auth.service.js";

export const DEPARTMENTS = [
	"Digital Transformation & Technology",
	"Research, Strategy & Innovation",
	"Entrepreneurship & Venture Development",
	"Learning, Talent & Leadership Development",
	"Innovation Projects & Program Delivery",
	"Corporate Affairs & Strategic Partnerships",
];

export function validateLogin(request, response, next) {
	const { email, password } = request.body ?? {};
	if (
		typeof email !== "string" || email.trim().length > 254 ||
		!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
		typeof password !== "string" || password.length < 1 || password.length > 256
	) {
		response.status(400).json({ error: "Enter a valid email and password." });
		return;
	}
	next();
}

export function validateAccount(request, response, next) {
	const { fullName, email, password, role } = request.body ?? {};
	const department = request.body?.department;
	const memberDepartmentIsValid = role === "member" && DEPARTMENTS.includes(department);
	const leadershipDepartmentIsEmpty = role !== "member"
		&& (department === undefined || department === null || department === "");
	if (
		typeof fullName !== "string" || fullName.trim().length < 2 || fullName.length > 100 ||
		typeof email !== "string" || email.trim().length > 254 ||
		!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
		typeof password !== "string" || password.length < 10 || password.length > 256 ||
		!ROLES.includes(role) ||
		(role === "member" ? !memberDepartmentIsValid : !leadershipDepartmentIsEmpty)
	) {
		response.status(400).json({
			error: "Provide a name, valid email, password of at least 10 characters, valid role, and a department for member accounts only.",
		});
		return;
	}
	next();
}

export function validateProfile(request, response, next) {
	const { fullName, email } = request.body ?? {};
	const profileImage = request.body?.profileImage;
	const department = request.body?.department;
	const imageMatch = typeof profileImage === "string"
		? /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(profileImage)
		: null;
	let validImage = profileImage === undefined || profileImage === null;
	if (imageMatch) {
		const image = Buffer.from(imageMatch[2], "base64");
		const isCanonicalBase64 = image.toString("base64") === imageMatch[2];
		const isSupportedImage = imageMatch[1] === "png"
			? image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
			: imageMatch[1] === "jpeg"
				? image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff
				: image.subarray(0, 4).toString() === "RIFF"
					&& image.subarray(8, 12).toString() === "WEBP";
		validImage = image.length > 0
			&& image.length <= 512 * 1024
			&& isCanonicalBase64
			&& isSupportedImage;
	}
	if (
		typeof fullName !== "string" || fullName.trim().length < 2 || fullName.length > 100 ||
		typeof email !== "string" || email.trim().length > 254 ||
		!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
		!validImage ||
		(department !== undefined && department !== "" && !DEPARTMENTS.includes(department))
	) {
		response.status(400).json({
			error: "Enter a valid name and email address, and choose a JPEG, PNG, or WebP photo under 512 KB.",
		});
		return;
	}
	next();
}

export function validatePasswordChange(request, response, next) {
	const { currentPassword, newPassword } = request.body ?? {};
	if (
		typeof currentPassword !== "string" || currentPassword.length < 1 || currentPassword.length > 256 ||
		typeof newPassword !== "string" || newPassword.length < 10 || newPassword.length > 256
	) {
		response.status(400).json({
			error: "Enter your current password and a new password of at least 10 characters.",
		});
		return;
	}
	next();
}
