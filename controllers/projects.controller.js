import { pool, query } from "../db.js";

const allowedFileTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const taskStatuses = new Set(["todo", "in_progress", "blocked", "done"]);
const milestoneStatuses = new Set(["planned", "in_progress", "completed"]);
const maxFileSize = 5 * 1024 * 1024;

function validId(value) {
  return typeof value === "string" && /^\d+$/.test(value) && BigInt(value) <= 9223372036854775807n;
}

function validText(value, minLength, maxLength) {
  return typeof value === "string" && value.trim().length >= minLength && value.length <= maxLength;
}

function parseUpload(fileData, mimeType, fileName) {
  if (
    typeof fileData !== "string" ||
    fileData.length > 7_100_000 ||
    typeof mimeType !== "string" ||
    !allowedFileTypes.has(mimeType) ||
    typeof fileName !== "string" ||
    !fileName.trim() ||
    fileName.length > 180
  ) return null;

  const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(fileData);
  if (!match || match[1] !== mimeType) return null;
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > maxFileSize || bytes.toString("base64") !== match[2]) return null;
  const validSignature = mimeType === "application/pdf"
    ? bytes.subarray(0, 5).toString() === "%PDF-"
    : mimeType === "image/jpeg"
      ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : mimeType === "image/png"
        ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
  if (!validSignature) return null;
  return {
    fileName: fileName.trim().replace(/[\\/\0]/g, "_"),
    mimeType,
    fileData,
  };
}

function projectSummary(row) {
  return {
    id: String(row.id),
    name: row.name,
    description: row.description,
    department: row.department,
    status: row.status,
    progress: Number(row.progress),
    dueAt: row.due_at,
    coordinatorName: row.coordinator_name,
    memberCount: Number(row.member_count),
    taskCount: Number(row.task_count),
    completedTaskCount: Number(row.completed_task_count),
    isMember: row.is_member,
  };
}

async function findProject(projectId, user) {
  const result = await query(
    `SELECT id, name, description, department, status, progress, due_at, coordinator_id
     FROM projects WHERE id = $1`,
    [projectId],
  );
  const project = result.rows[0];
  if (!project || (!["admin", "coordinator"].includes(user.role) && project.department !== user.department)) return null;
  return project;
}

async function isProjectMember(projectId, userId) {
  const result = await query(
    "SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2",
    [projectId, userId],
  );
  return result.rowCount > 0;
}

function canManageProjects(user) {
  return ["admin", "coordinator"].includes(user.role);
}

export async function listProjectWorkspace(request, response, next) {
  const canManage = canManageProjects(request.user);
  if (!canManage && !request.user.department) {
    response.json({ department: "", projects: [], proposals: [] });
    return;
  }
  const scope = canManage ? "" : "WHERE project.department = $1";
  const proposalScope = canManage ? "" : "WHERE proposal.department = $1";

  try {
    const [projects, proposals] = await Promise.all([
      query(
        `SELECT project.id, project.name, project.description, project.department,
                project.status, project.progress, project.due_at,
                coordinator.full_name AS coordinator_name,
                COUNT(DISTINCT member.user_id)::int AS member_count,
                COUNT(DISTINCT task.id)::int AS task_count,
                COUNT(DISTINCT task.id) FILTER (WHERE LOWER(task.status) IN ('done', 'complete', 'completed'))::int AS completed_task_count,
                BOOL_OR(member.user_id = $${canManage ? 1 : 2}) AS is_member
         FROM projects AS project
         LEFT JOIN users AS coordinator ON coordinator.id = project.coordinator_id
         LEFT JOIN project_members AS member ON member.project_id = project.id
         LEFT JOIN tasks AS task ON task.project_id = project.id
         ${scope}
         GROUP BY project.id, coordinator.full_name
         ORDER BY project.updated_at DESC, project.created_at DESC
         LIMIT 100`,
        canManage ? [request.user.id] : [request.user.department, request.user.id],
      ),
      query(
        `SELECT proposal.id, proposal.title, proposal.description, proposal.department,
                proposal.status, proposal.review_note, proposal.project_id, proposal.created_at,
                proposal.attachment_name, submitter.full_name AS submitted_by_name,
                proposal.submitted_by = $${canManage ? 1 : 2} AS submitted_by_me
         FROM project_proposals AS proposal
         JOIN users AS submitter ON submitter.id = proposal.submitted_by
         ${proposalScope}
         ORDER BY proposal.created_at DESC
         LIMIT 100`,
        canManage ? [request.user.id] : [request.user.department, request.user.id],
      ),
    ]);

    response.json({
      department: request.user.department ?? "",
      canManage: canManageProjects(request.user),
      projects: projects.rows.map(projectSummary),
      proposals: proposals.rows.map((row) => ({
        ...row,
        id: String(row.id),
        project_id: row.project_id === null ? null : String(row.project_id),
      })),
    });
  } catch (error) {
    next(error);
  }
}

export async function createProjectProposal(request, response, next) {
  const { title, description, fileName, mimeType, fileData } = request.body ?? {};
  const hasAttachment = fileData !== undefined || mimeType !== undefined || fileName !== undefined;
  const attachment = hasAttachment ? parseUpload(fileData, mimeType, fileName) : null;
  if (
    !validText(title, 3, 160) ||
    !validText(description, 10, 3000) ||
    !request.user.department ||
    request.user.department === "Not sure yet" ||
    (hasAttachment && !attachment)
  ) {
    response.status(400).json({
      error: "Choose a department in your profile and provide a project title, a description, and an optional valid PDF or image under 5 MB.",
    });
    return;
  }

  let client;
  let transactionStarted = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    transactionStarted = true;
    const result = await client.query(
      `INSERT INTO project_proposals
         (title, description, department, submitted_by, attachment_name, attachment_mime, attachment_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, title, description, department, status, created_at, attachment_name`,
      [
        title.trim(),
        description.trim(),
        request.user.department,
        request.user.id,
        attachment?.fileName ?? null,
        attachment?.mimeType ?? null,
        attachment?.fileData ?? null,
      ],
    );
    await client.query(
      `INSERT INTO notifications (user_id, title, body)
       SELECT id, 'New department project proposal', $1
       FROM users
       WHERE is_active = TRUE
         AND (role = 'admin' OR (role = 'coordinator' AND department = $2))`,
      [`${request.user.fullName} submitted "${title.trim()}" for review.`, request.user.department],
    );
    await client.query("COMMIT");
    transactionStarted = false;
    response.status(201).json({
      proposal: { ...result.rows[0], id: String(result.rows[0].id) },
    });
  } catch (error) {
    if (client && transactionStarted) await client.query("ROLLBACK");
    next(error);
  } finally {
    client?.release();
  }
}

export async function reviewProjectProposal(request, response, next) {
  const { id } = request.params;
  const { status, reviewNote = "" } = request.body ?? {};
  if (
    !validId(id) ||
    !["approved", "rejected"].includes(status) ||
    typeof reviewNote !== "string" ||
    reviewNote.length > 1000
  ) {
    response.status(400).json({ error: "Provide a valid proposal review decision and note." });
    return;
  }
  if (!["admin", "coordinator"].includes(request.user.role)) {
    response.status(403).json({ error: "Only administrators and department coordinators can review proposals." });
    return;
  }

  let client;
  let transactionStarted = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    transactionStarted = true;
    const proposalResult = await client.query(
      `SELECT * FROM project_proposals
       WHERE id = $1 AND ($2::boolean OR department = $3)
       FOR UPDATE`,
      [id, canManageProjects(request.user), request.user.department ?? ""],
    );
    const proposal = proposalResult.rows[0];
    if (!proposal) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      response.status(404).json({ error: "Proposal not found in your review scope." });
      return;
    }
    if (proposal.status !== "pending") {
      await client.query("ROLLBACK");
      transactionStarted = false;
      response.status(409).json({ error: "This proposal has already been reviewed." });
      return;
    }

    let projectId = null;
    if (status === "approved") {
      const projectResult = await client.query(
        `INSERT INTO projects (name, description, department, status, coordinator_id)
         VALUES ($1, $2, $3, 'planning', $4)
         RETURNING id`,
        [
          proposal.title,
          proposal.description,
          proposal.department,
          request.user.role === "coordinator" ? request.user.id : null,
        ],
      );
      projectId = projectResult.rows[0].id;
      await client.query(
        `INSERT INTO project_members (project_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (project_id, user_id) DO NOTHING`,
        [projectId, proposal.submitted_by],
      );
      if (request.user.role === "coordinator") {
        await client.query(
          `INSERT INTO project_members (project_id, user_id)
           VALUES ($1, $2)
           ON CONFLICT (project_id, user_id) DO NOTHING`,
          [projectId, request.user.id],
        );
      }
    }
    await client.query(
      `UPDATE project_proposals
       SET status = $1, review_note = $2, reviewed_by = $3, reviewed_at = NOW(), project_id = $4
       WHERE id = $5`,
      [status, reviewNote.trim(), request.user.id, projectId, id],
    );
    await client.query(
      `INSERT INTO notifications (user_id, title, body)
       VALUES ($1, 'Project proposal reviewed', $2)`,
      [
        proposal.submitted_by,
        status === "approved"
          ? `Your proposal "${proposal.title}" was approved and is now a department project.`
          : `Your proposal "${proposal.title}" was declined.${reviewNote.trim() ? ` Review note: ${reviewNote.trim()}` : ""}`,
      ],
    );
    await client.query("COMMIT");
    transactionStarted = false;
    response.json({ status, projectId: projectId === null ? null : String(projectId) });
  } catch (error) {
    if (client && transactionStarted) await client.query("ROLLBACK");
    next(error);
  } finally {
    client?.release();
  }
}

export async function downloadProposalFile(request, response, next) {
  const { id } = request.params;
  if (!validId(id)) {
    response.status(400).json({ error: "Invalid proposal." });
    return;
  }
  try {
    const result = await query(
      `SELECT attachment_name, attachment_mime, attachment_data, department
       FROM project_proposals WHERE id = $1`,
      [id],
    );
    const proposal = result.rows[0];
    if (!proposal || (!canManageProjects(request.user) && proposal.department !== request.user.department)) {
      response.status(404).json({ error: "Proposal file not found in your department." });
      return;
    }
    if (!proposal.attachment_data) {
      response.status(404).json({ error: "This proposal has no attachment." });
      return;
    }
    response.json({
      file: {
        file_name: proposal.attachment_name,
        mime_type: proposal.attachment_mime,
        file_data: proposal.attachment_data,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getProjectDetails(request, response, next) {
  const { projectId } = request.params;
  if (!validId(projectId)) {
    response.status(400).json({ error: "Invalid project." });
    return;
  }
  try {
    const project = await findProject(projectId, request.user);
    if (!project) {
      response.status(404).json({ error: "Project not found in your department." });
      return;
    }
    const [members, tasks, comments, milestones, files] = await Promise.all([
      query(
        `SELECT users.id, users.full_name, users.role, project_members.joined_at
         FROM project_members JOIN users ON users.id = project_members.user_id
         WHERE project_members.project_id = $1
         ORDER BY project_members.joined_at, users.full_name`,
        [projectId],
      ),
      query(
        `SELECT task.id, task.title, task.description, task.assigned_to, task.status, task.due_at,
                assignee.full_name AS assignee_name
         FROM tasks AS task
         LEFT JOIN users AS assignee ON assignee.id = task.assigned_to
         WHERE task.project_id = $1
         ORDER BY task.created_at DESC, task.id DESC`,
        [projectId],
      ),
      query(
        `SELECT comment.id, comment.body, comment.created_at, users.full_name AS author_name
         FROM project_comments AS comment JOIN users ON users.id = comment.user_id
         WHERE comment.project_id = $1
         ORDER BY comment.created_at DESC LIMIT 100`,
        [projectId],
      ),
      query(
        `SELECT milestone.id, milestone.title, milestone.due_at, milestone.status,
                milestone.created_at, users.full_name AS creator_name
         FROM project_milestones AS milestone
         LEFT JOIN users ON users.id = milestone.created_by
         WHERE milestone.project_id = $1
         ORDER BY milestone.due_at NULLS LAST, milestone.id`,
        [projectId],
      ),
      query(
        `SELECT file.id, file.file_name, file.mime_type, file.created_at, users.full_name AS uploader_name
         FROM project_files AS file LEFT JOIN users ON users.id = file.uploaded_by
         WHERE file.project_id = $1 ORDER BY file.created_at DESC`,
        [projectId],
      ),
    ]);
    response.json({
      project: {
        ...project,
        id: String(project.id),
        coordinatorId: project.coordinator_id === null ? null : String(project.coordinator_id),
        dueAt: project.due_at,
      },
      isMember: await isProjectMember(projectId, request.user.id),
      canManage: canManageProjects(request.user),
      members: members.rows.map((row) => ({ ...row, id: String(row.id) })),
      tasks: tasks.rows.map((row) => ({
        ...row,
        id: String(row.id),
        assigned_to: row.assigned_to === null ? null : String(row.assigned_to),
      })),
      comments: comments.rows.map((row) => ({ ...row, id: String(row.id) })),
      milestones: milestones.rows.map((row) => ({ ...row, id: String(row.id) })),
      files: files.rows.map((row) => ({ ...row, id: String(row.id) })),
    });
  } catch (error) {
    next(error);
  }
}

export async function updateProjectProgress(request, response, next) {
  const { projectId } = request.params;
  const { progress } = request.body ?? {};
  if (!validId(projectId) || !Number.isInteger(progress) || progress < 0 || progress > 100) {
    response.status(400).json({ error: "Set project progress to a whole-number percentage from 0 to 100." });
    return;
  }
  if (!canManageProjects(request.user)) {
    response.status(403).json({ error: "Only administrators and project coordinators can update project progress." });
    return;
  }
  try {
    const project = await findProject(projectId, request.user);
    if (!project) {
      response.status(404).json({ error: "Project not found." });
      return;
    }
    const result = await query(
      "UPDATE projects SET progress = $1, updated_at = NOW() WHERE id = $2 RETURNING progress",
      [progress, projectId],
    );
    response.json({ progress: result.rows[0].progress });
  } catch (error) {
    next(error);
  }
}

export async function joinProject(request, response, next) {
  const { projectId } = request.params;
  if (!validId(projectId)) {
    response.status(400).json({ error: "Invalid project." });
    return;
  }
  try {
    const project = await findProject(projectId, request.user);
    if (!project || ["completed", "cancelled"].includes(project.status)) {
      response.status(404).json({ error: "This project is unavailable for joining." });
      return;
    }
    await query(
      `INSERT INTO project_members (project_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (project_id, user_id) DO NOTHING`,
      [projectId, request.user.id],
    );
    response.status(201).json({ joined: true });
  } catch (error) {
    next(error);
  }
}

export async function listProjectTeamCandidates(request, response, next) {
  const { projectId } = request.params;
  if (!validId(projectId)) {
    response.status(400).json({ error: "Invalid project." });
    return;
  }
  if (!canManageProjects(request.user)) {
    response.status(403).json({ error: "Only administrators and project coordinators can manage team membership." });
    return;
  }
  try {
    const project = await findProject(projectId, request.user);
    if (!project) {
      response.status(404).json({ error: "Project not found." });
      return;
    }
    const result = await query(
      `SELECT users.id, users.full_name, users.email, users.department
       FROM users
       WHERE users.is_active = TRUE AND users.role = 'member'
         AND NOT EXISTS (
           SELECT 1 FROM project_members
           WHERE project_members.project_id = $1 AND project_members.user_id = users.id
         )
       ORDER BY users.full_name
       LIMIT 500`,
      [projectId],
    );
    response.json({
      members: result.rows.map((row) => ({ ...row, id: String(row.id) })),
    });
  } catch (error) {
    next(error);
  }
}

export async function addProjectTeamMember(request, response, next) {
  const { projectId } = request.params;
  const { userId } = request.body ?? {};
  if (!validId(projectId) || !validId(userId)) {
    response.status(400).json({ error: "Choose a valid project and active member." });
    return;
  }
  if (!canManageProjects(request.user)) {
    response.status(403).json({ error: "Only administrators and project coordinators can manage team membership." });
    return;
  }
  try {
    const project = await findProject(projectId, request.user);
    if (!project) {
      response.status(404).json({ error: "Project not found." });
      return;
    }
    const result = await query(
      `INSERT INTO project_members (project_id, user_id)
       SELECT $1, users.id FROM users
       WHERE users.id = $2 AND users.role = 'member' AND users.is_active = TRUE
       ON CONFLICT (project_id, user_id) DO NOTHING
       RETURNING project_id`,
      [projectId, userId],
    );
    if (!result.rowCount) {
      response.status(404).json({ error: "Active member not found or already on this team." });
      return;
    }
    response.status(201).json({ memberId: String(userId) });
  } catch (error) {
    next(error);
  }
}

export async function removeProjectTeamMember(request, response, next) {
  const { projectId, memberId } = request.params;
  if (!validId(projectId) || !validId(memberId)) {
    response.status(400).json({ error: "Choose a valid project and team member." });
    return;
  }
  if (!canManageProjects(request.user)) {
    response.status(403).json({ error: "Only administrators and project coordinators can manage team membership." });
    return;
  }

  let client;
  let transactionStarted = false;
  try {
    const project = await findProject(projectId, request.user);
    if (!project) {
      response.status(404).json({ error: "Project not found." });
      return;
    }
    if (project.coordinator_id !== null && String(project.coordinator_id) === String(memberId)) {
      response.status(409).json({ error: "The project coordinator cannot be removed from the project team." });
      return;
    }
    client = await pool.connect();
    await client.query("BEGIN");
    transactionStarted = true;
    const result = await client.query(
      `DELETE FROM project_members
       WHERE project_id = $1 AND user_id = $2
       RETURNING user_id`,
      [projectId, memberId],
    );
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      response.status(404).json({ error: "Team member not found." });
      return;
    }
    await client.query(
      "UPDATE tasks SET assigned_to = NULL WHERE project_id = $1 AND assigned_to = $2",
      [projectId, memberId],
    );
    await client.query("COMMIT");
    transactionStarted = false;
    response.json({ removed: true, memberId: String(memberId) });
  } catch (error) {
    if (client && transactionStarted) await client.query("ROLLBACK");
    next(error);
  } finally {
    client?.release();
  }
}

export async function createProjectTask(request, response, next) {
  const { projectId } = request.params;
  const { title, description = "", dueAt = null, assigneeId = null } = request.body ?? {};
  if (
    !validId(projectId) ||
    !validText(title, 3, 160) ||
    typeof description !== "string" || description.length > 1000 ||
    (dueAt !== null && dueAt !== "" && (typeof dueAt !== "string" || Number.isNaN(Date.parse(dueAt)))) ||
    (assigneeId !== null && assigneeId !== "" && !validId(assigneeId))
  ) {
    response.status(400).json({ error: "Provide a valid task title, description, due date, and assignee." });
    return;
  }
  try {
    const project = await findProject(projectId, request.user);
    if (!project || (!canManageProjects(request.user) && !(await isProjectMember(projectId, request.user.id)))) {
      response.status(404).json({ error: "Join this department project before adding tasks." });
      return;
    }
    const selectedAssignee = assigneeId || (canManageProjects(request.user) ? null : request.user.id);
    const result = await query(
      `INSERT INTO tasks (project_id, title, description, assigned_to, due_at)
       SELECT $1, $2, $3, $4, $5
       WHERE $4 IS NULL OR EXISTS (
         SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $4
       )
       RETURNING id, title, description, assigned_to, status, due_at`,
      [projectId, title.trim(), description.trim(), selectedAssignee, dueAt || null],
    );
    if (!result.rowCount) {
      response.status(400).json({ error: "Tasks can only be assigned to members of this project." });
      return;
    }
    response.status(201).json({
      task: {
        ...result.rows[0],
        id: String(result.rows[0].id),
        assigned_to: result.rows[0].assigned_to === null ? null : String(result.rows[0].assigned_to),
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function updateProjectTask(request, response, next) {
  const { projectId, taskId } = request.params;
  const { status } = request.body ?? {};
  if (!validId(projectId) || !validId(taskId) || !taskStatuses.has(status)) {
    response.status(400).json({ error: "Choose a valid task status." });
    return;
  }
  try {
    const project = await findProject(projectId, request.user);
    if (!project || (!canManageProjects(request.user) && !(await isProjectMember(projectId, request.user.id)))) {
      response.status(404).json({ error: "Project or task not found." });
      return;
    }
    const result = await query(
      `UPDATE tasks SET status = $1
       WHERE id = $2 AND project_id = $3
         AND ($5::boolean OR assigned_to = $4)`,
      [status, taskId, projectId, request.user.id, canManageProjects(request.user)],
    );
    if (!result.rowCount) {
      response.status(404).json({ error: "Task not found or you are not assigned to it." });
      return;
    }
    response.json({ id: String(result.rows[0].id), status });
  } catch (error) {
    next(error);
  }
}

export async function addProjectComment(request, response, next) {
  const { projectId } = request.params;
  const { body } = request.body ?? {};
  if (!validId(projectId) || !validText(body, 1, 2000)) {
    response.status(400).json({ error: "Enter a comment of up to 2,000 characters." });
    return;
  }
  try {
    const project = await findProject(projectId, request.user);
    if (!project || (!canManageProjects(request.user) && !(await isProjectMember(projectId, request.user.id)))) {
      response.status(404).json({ error: "Join this department project before commenting." });
      return;
    }
    const result = await query(
      `INSERT INTO project_comments (project_id, user_id, body)
       VALUES ($1, $2, $3)
       RETURNING id, body, created_at`,
      [projectId, request.user.id, body.trim()],
    );
    response.status(201).json({
      comment: { ...result.rows[0], id: String(result.rows[0].id), author_name: request.user.fullName },
    });
  } catch (error) {
    next(error);
  }
}

export async function createProjectMilestone(request, response, next) {
  const { projectId } = request.params;
  const { title, dueAt = null } = request.body ?? {};
  if (
    !validId(projectId) ||
    !validText(title, 3, 160) ||
    (dueAt !== null && dueAt !== "" && (typeof dueAt !== "string" || Number.isNaN(Date.parse(dueAt))))
  ) {
    response.status(400).json({ error: "Provide a valid milestone title and optional due date." });
    return;
  }
  try {
    const project = await findProject(projectId, request.user);
    if (!project || (!canManageProjects(request.user) && !(await isProjectMember(projectId, request.user.id)))) {
      response.status(404).json({ error: "Join this department project before adding milestones." });
      return;
    }
    const result = await query(
      `INSERT INTO project_milestones (project_id, title, due_at, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, title, due_at, status, created_at`,
      [projectId, title.trim(), dueAt || null, request.user.id],
    );
    response.status(201).json({ milestone: { ...result.rows[0], id: String(result.rows[0].id) } });
  } catch (error) {
    next(error);
  }
}

export async function updateProjectMilestone(request, response, next) {
  const { projectId, milestoneId } = request.params;
  const { status } = request.body ?? {};
  if (!validId(projectId) || !validId(milestoneId) || !milestoneStatuses.has(status)) {
    response.status(400).json({ error: "Choose a valid milestone status." });
    return;
  }
  try {
    const project = await findProject(projectId, request.user);
    if (!project || (!canManageProjects(request.user) && !(await isProjectMember(projectId, request.user.id)))) {
      response.status(404).json({ error: "Project or milestone not found." });
      return;
    }
    const result = await query(
      `UPDATE project_milestones SET status = $1 WHERE id = $2 AND project_id = $3 RETURNING id`,
      [status, milestoneId, projectId],
    );
    if (!result.rowCount) {
      response.status(404).json({ error: "Milestone not found." });
      return;
    }
    response.json({ id: String(result.rows[0].id), status });
  } catch (error) {
    next(error);
  }
}

export async function uploadProjectFile(request, response, next) {
  const { projectId } = request.params;
  const { fileName, mimeType, fileData } = request.body ?? {};
  const file = parseUpload(fileData, mimeType, fileName);
  if (!validId(projectId) || !file) {
    response.status(400).json({ error: "Upload a valid PDF, JPEG, PNG, or WebP file under 5 MB." });
    return;
  }
  try {
    const project = await findProject(projectId, request.user);
    if (!project || (!canManageProjects(request.user) && !(await isProjectMember(projectId, request.user.id)))) {
      response.status(404).json({ error: "Join this department project before uploading files." });
      return;
    }
    const result = await query(
      `INSERT INTO project_files (project_id, uploaded_by, file_name, mime_type, file_data)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, file_name, mime_type, created_at`,
      [projectId, request.user.id, file.fileName, file.mimeType, file.fileData],
    );
    response.status(201).json({
      file: { ...result.rows[0], id: String(result.rows[0].id), uploader_name: request.user.fullName },
    });
  } catch (error) {
    next(error);
  }
}

export async function downloadProjectFile(request, response, next) {
  const { projectId, fileId } = request.params;
  if (!validId(projectId) || !validId(fileId)) {
    response.status(400).json({ error: "Invalid project file." });
    return;
  }
  try {
    const project = await findProject(projectId, request.user);
    if (!project) {
      response.status(404).json({ error: "Project not found in your department." });
      return;
    }
    const result = await query(
      `SELECT file_name, mime_type, file_data
       FROM project_files WHERE id = $1 AND project_id = $2`,
      [fileId, projectId],
    );
    if (!result.rowCount) {
      response.status(404).json({ error: "Project file not found." });
      return;
    }
    response.json({ file: result.rows[0] });
  } catch (error) {
    next(error);
  }
}
