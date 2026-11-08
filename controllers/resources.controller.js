import { query } from "../db.js";

export async function listResources(_request, response, next) {
  try {
    const result = await query(
      `SELECT resource.id, resource.title, resource.description,
              resource.category, resource.url, resource.created_at,
              uploader.full_name AS uploaded_by
       FROM resources AS resource
       LEFT JOIN users AS uploader ON uploader.id = resource.uploaded_by
       ORDER BY resource.created_at DESC, resource.id DESC
       LIMIT 500`,
    );
    response.json({
      resources: result.rows.map((resource) => ({
        ...resource,
        id: String(resource.id),
      })),
    });
  } catch (error) {
    next(error);
  }
}

export async function createResource(request, response, next) {
  const { title, description, category, url } = request.body ?? {};
  const normalizedTitle = typeof title === "string" ? title.trim() : "";
  const normalizedDescription = typeof description === "string" ? description.trim() : "";
  const normalizedCategory = typeof category === "string" ? category.trim() : "";
  let parsedUrl;

  try {
    parsedUrl = new URL(url);
  } catch {
    parsedUrl = null;
  }

  if (
    normalizedTitle.length < 3 || normalizedTitle.length > 120 ||
    normalizedDescription.length > 1000 ||
    normalizedCategory.length > 60 ||
    !parsedUrl || !["http:", "https:"].includes(parsedUrl.protocol)
  ) {
    response.status(400).json({
      error: "Provide a title, an HTTP(S) link, and a description and category within their length limits.",
    });
    return;
  }

  try {
    const result = await query(
      `INSERT INTO resources (title, description, category, url, uploaded_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, title, description, category, url, created_at`,
      [
        normalizedTitle,
        normalizedDescription,
        normalizedCategory || "General",
        parsedUrl.href,
        request.user.id,
      ],
    );
    response.status(201).json({
      resource: {
        ...result.rows[0],
        id: String(result.rows[0].id),
        uploaded_by: request.user.fullName,
      },
    });
  } catch (error) {
    next(error);
  }
}
