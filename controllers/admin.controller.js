import { createHash } from "node:crypto";
import { query } from "../db.js";

export function createCloudinarySignature(request, response) {
  const { resourceType } = request.body ?? {};
  if (!["image", "video"].includes(resourceType)) {
    response.status(400).json({ error: "Choose a valid image or video upload." });
    return;
  }

  const { CLOUDINARY_CLOUD_NAME: cloudName, CLOUDINARY_API_KEY: apiKey, CLOUDINARY_API_SECRET: apiSecret } = process.env;
  if (!cloudName || !apiKey || !apiSecret) {
    response.status(503).json({ error: "Cloudinary uploads are not configured on the backend." });
    return;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = "innovation-club";
  const parameters = `folder=${folder}&timestamp=${timestamp}`;
  const signature = createHash("sha1").update(`${parameters}${apiSecret}`).digest("hex");

  response.json({ cloudName, apiKey, timestamp, folder, signature });
}

function validText(value, minLength, maxLength) {
  return typeof value === "string"
    && value.trim().length >= minLength
    && value.length <= maxLength;
}

function safeMediaUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function contentItem(row) {
  return {
    id: String(row.id),
    type: row.type,
    title: row.title,
    body: row.body,
    mediaUrl: row.media_url,
  };
}

function officeEntry(row) {
  return {
    id: String(row.id),
    group: row.directory_group,
    title: row.position,
    department: row.department,
    name: row.full_name,
    imageUrl: row.image_data,
    description: row.description,
  };
}

export async function listAdminContent(_request, response, next) {
  try {
    const result = await query(
      `SELECT id, type, title, body, media_url
       FROM club_content
       ORDER BY created_at DESC, id DESC
       LIMIT 100`,
    );
    response.json({ content: result.rows.map(contentItem) });
  } catch (error) {
    next(error);
  }
}

export async function createAdminContent(request, response, next) {
  const { type, title, body, mediaUrl } = request.body ?? {};
  const media = typeof mediaUrl === "string" && mediaUrl.trim()
    ? safeMediaUrl(mediaUrl.trim())
    : null;
  if (
    !["image", "video", "text"].includes(type) ||
    !validText(title, 3, 160) ||
    (body !== undefined && (typeof body !== "string" || body.length > 5000)) ||
    (type === "text" && !validText(body, 1, 5000)) ||
    (type !== "text" && (!media || mediaUrl.length > 2000))
  ) {
    response.status(400).json({ error: "Provide a valid content type, title, caption, and media URL when required." });
    return;
  }

  try {
    const result = await query(
      `INSERT INTO club_content (type, title, body, media_url, published_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, type, title, body, media_url`,
      [type, title.trim(), body?.trim() || "", media, request.user.id],
    );
    response.status(201).json({ item: contentItem(result.rows[0]) });
  } catch (error) {
    next(error);
  }
}

export async function deleteAdminContent(request, response, next) {
  if (!/^\d+$/.test(request.params.id)) {
    response.status(400).json({ error: "Invalid content ID." });
    return;
  }
  try {
    const result = await query("DELETE FROM club_content WHERE id = $1 RETURNING id", [request.params.id]);
    if (!result.rowCount) {
      response.status(404).json({ error: "Content not found." });
      return;
    }
    response.status(204).end();
  } catch (error) {
    next(error);
  }
}

export async function listOffices(_request, response, next) {
  try {
    const result = await query(
      `SELECT id, directory_group, position, department, full_name, image_data, description
       FROM club_leadership
       ORDER BY display_order, department, position, full_name, id`,
    );
    response.json({ offices: result.rows.map(officeEntry) });
  } catch (error) {
    next(error);
  }
}

export async function saveOffice(request, response, next) {
  const { id, group, title, department, name, imageUrl, description } = request.body ?? {};
  const image = typeof imageUrl === "string" && imageUrl.trim()
    ? safeMediaUrl(imageUrl.trim())
    : null;
  if (
    (id !== undefined && (typeof id !== "string" || !/^\d+$/.test(id))) ||
    !["officer", "department"].includes(group) ||
    !validText(title, 2, 160) ||
    !validText(name, 2, 120) ||
    (department !== undefined && (typeof department !== "string" || department.length > 160)) ||
    (description !== undefined && (typeof description !== "string" || description.length > 1000)) ||
    (imageUrl !== undefined && imageUrl !== "" && (!image || imageUrl.length > 2000))
  ) {
    response.status(400).json({ error: "Provide a valid group, title, name, and optional directory details." });
    return;
  }

  try {
    const values = [
      group,
      title.trim(),
      department?.trim() || "",
      name.trim(),
      image,
      description?.trim() || "",
    ];
    const result = id
      ? await query(
          `UPDATE club_leadership
           SET directory_group = $1, position = $2, department = $3, full_name = $4,
               image_data = $5, description = $6
           WHERE id = $7
           RETURNING id, directory_group, position, department, full_name, image_data, description`,
          [...values, id],
        )
      : await query(
          `INSERT INTO club_leadership
             (directory_group, position, department, full_name, image_data, description)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, directory_group, position, department, full_name, image_data, description`,
          values,
        );

    if (!result.rowCount) {
      response.status(404).json({ error: "Directory entry not found." });
      return;
    }
    response.status(id ? 200 : 201).json({ office: officeEntry(result.rows[0]) });
  } catch (error) {
    next(error);
  }
}

export async function deleteOffice(request, response, next) {
  if (!/^\d+$/.test(request.params.id)) {
    response.status(400).json({ error: "Invalid directory entry ID." });
    return;
  }
  try {
    const result = await query("DELETE FROM club_leadership WHERE id = $1 RETURNING id", [request.params.id]);
    if (!result.rowCount) {
      response.status(404).json({ error: "Directory entry not found." });
      return;
    }
    response.status(204).end();
  } catch (error) {
    next(error);
  }
}