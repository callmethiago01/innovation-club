import { query } from "../db.js";

const imagePattern = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

function isValidImage(value, required = false) {
  if (value === undefined || value === null || value === "") return !required;
  if (typeof value !== "string" || value.length > 700_000) return false;
  const match = imagePattern.exec(value);
  if (!match) return false;

  const image = Buffer.from(match[2], "base64");
  if (!image.length || image.length > 512 * 1024 || image.toString("base64") !== match[2]) {
    return false;
  }
  if (match[1] === "png") {
    return image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (match[1] === "jpeg") {
    return image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff;
  }
  return image.subarray(0, 4).toString() === "RIFF"
    && image.subarray(8, 12).toString() === "WEBP";
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

export async function getPublicContent(_request, response, next) {
  try {
    const [news, gallery, leadership] = await Promise.all([
      query(
        `SELECT id, title, body, category, image_data, video_url, published_at
         FROM club_news
         ORDER BY published_at DESC, id DESC
         LIMIT 50`,
      ),
      query(
        `SELECT id, title, description, category, image_data, created_at
         FROM gallery_items
         ORDER BY created_at DESC, id DESC
         LIMIT 100`,
      ),
      query(
        `SELECT id, full_name, position, department, description, image_data
         FROM club_leadership
         ORDER BY display_order, department, position, full_name
         LIMIT 100`,
      ),
    ]);

    response.json({
      news: news.rows.map((item) => ({ ...item, id: String(item.id) })),
      gallery: gallery.rows.map((item) => ({ ...item, id: String(item.id) })),
      leadership: leadership.rows.map((person) => ({ ...person, id: String(person.id) })),
    });
  } catch (error) {
    next(error);
  }
}

export async function listPublicContentItems(_request, response, next) {
  try {
    const result = await query(
      `SELECT id, type, title, body, media_url
       FROM club_content
       ORDER BY created_at DESC, id DESC
       LIMIT 100`,
    );
    response.json({
      content: result.rows.map((item) => ({
        id: String(item.id),
        type: item.type,
        title: item.title,
        body: item.body,
        mediaUrl: item.media_url,
      })),
    });
  } catch (error) {
    next(error);
  }
}

export async function listAnnouncements(_request, response, next) {
  try {
    const result = await query(
      `SELECT announcement.id, announcement.title, announcement.body,
              announcement.published_at, users.full_name AS author
       FROM announcements AS announcement
       LEFT JOIN users ON users.id = announcement.published_by
       ORDER BY announcement.published_at DESC, announcement.id DESC
       LIMIT 100`,
    );
    response.json({
      announcements: result.rows.map((item) => ({
        id: String(item.id),
        title: item.title,
        body: item.body,
        author: item.author || "Club administrator",
        publishedAt: item.published_at,
      })),
    });
  } catch (error) {
    next(error);
  }
}

export async function createAnnouncement(request, response, next) {
  const { title, body } = request.body ?? {};
  if (!validText(title, 3, 160) || !validText(body, 3, 5000)) {
    response.status(400).json({ error: "Enter an announcement title and message (up to 5,000 characters)." });
    return;
  }

  try {
    const result = await query(
      `INSERT INTO announcements (title, body, published_by)
       VALUES ($1, $2, $3)
       RETURNING id, title, body, published_at`,
      [title.trim(), body.trim(), request.user.id],
    );
    response.status(201).json({
      announcement: {
        id: String(result.rows[0].id),
        title: result.rows[0].title,
        body: result.rows[0].body,
        author: request.user.fullName,
        publishedAt: result.rows[0].published_at,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteAnnouncement(request, response, next) {
  if (!/^\d+$/.test(request.params.id)) {
    response.status(400).json({ error: "Invalid announcement ID." });
    return;
  }
  try {
    const result = await query("DELETE FROM announcements WHERE id = $1 RETURNING id", [request.params.id]);
    if (!result.rowCount) {
      response.status(404).json({ error: "Announcement not found." });
      return;
    }
    response.status(204).end();
  } catch (error) {
    next(error);
  }
}

export async function createNews(request, response, next) {
  const { title, body, category, imageData, videoUrl } = request.body ?? {};
  const video = typeof videoUrl === "string" && videoUrl.trim()
    ? safeMediaUrl(videoUrl.trim())
    : null;
  if (
    !validText(title, 3, 160) ||
    !validText(body, 3, 5000) ||
    (category !== undefined && !validText(category, 1, 60)) ||
    (videoUrl !== undefined && videoUrl !== "" && typeof videoUrl !== "string") ||
    !isValidImage(imageData) ||
    (videoUrl && !video) ||
    (!imageData && !video)
  ) {
    response.status(400).json({
      error: "Add a title, story, and at least one valid image or video link. Images must be JPEG, PNG, or WebP up to 512 KB.",
    });
    return;
  }

  try {
    const result = await query(
      `INSERT INTO club_news (title, body, category, image_data, video_url, published_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, title, body, category, image_data, video_url, published_at`,
      [title.trim(), body.trim(), category?.trim() || "Club news", imageData || null, video, request.user.id],
    );
    response.status(201).json({ news: { ...result.rows[0], id: String(result.rows[0].id) } });
  } catch (error) {
    next(error);
  }
}

export async function createGalleryItem(request, response, next) {
  const { title, description, category, imageData } = request.body ?? {};
  if (
    !validText(title, 2, 120) ||
    (description !== undefined && (typeof description !== "string" || description.length > 500)) ||
    (category !== undefined && !validText(category, 1, 60)) ||
    !isValidImage(imageData, true)
  ) {
    response.status(400).json({
      error: "Add a title and JPEG, PNG, or WebP image up to 512 KB. Descriptions can be up to 500 characters.",
    });
    return;
  }

  try {
    const result = await query(
      `INSERT INTO gallery_items (title, description, category, image_data, uploaded_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, title, description, category, image_data, created_at`,
      [title.trim(), description?.trim() || "", category?.trim() || "Club life", imageData, request.user.id],
    );
    response.status(201).json({ galleryItem: { ...result.rows[0], id: String(result.rows[0].id) } });
  } catch (error) {
    next(error);
  }
}

export async function createLeader(request, response, next) {
  const { fullName, position, department, description, imageData, displayOrder } = request.body ?? {};
  if (
    !validText(fullName, 2, 100) ||
    !validText(position, 2, 120) ||
    !validText(department, 2, 120) ||
    (description !== undefined && (typeof description !== "string" || description.length > 500)) ||
    !isValidImage(imageData) ||
    (displayOrder !== undefined && (!Number.isInteger(displayOrder) || displayOrder < 0 || displayOrder > 999))
  ) {
    response.status(400).json({
      error: "Provide a name, role, department, and optional JPEG, PNG, or WebP portrait up to 512 KB.",
    });
    return;
  }

  try {
    const result = await query(
      `INSERT INTO club_leadership
         (full_name, position, department, description, image_data, display_order)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, full_name, position, department, description, image_data`,
      [
        fullName.trim(),
        position.trim(),
        department.trim(),
        description?.trim() || "",
        imageData || null,
        displayOrder ?? 0,
      ],
    );
    response.status(201).json({ leader: { ...result.rows[0], id: String(result.rows[0].id) } });
  } catch (error) {
    next(error);
  }
}
