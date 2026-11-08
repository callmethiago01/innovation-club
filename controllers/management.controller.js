import { query } from "../db.js";
import { DEPARTMENTS } from "../validators/auth.validator.js";

const attendanceStatuses = ["present", "late", "absent", "excused"];
const projectStatuses = ["planning", "active", "on_hold", "completed", "cancelled"];
const eventStatuses = ["scheduled", "cancelled", "completed"];

function validText(value, minLength, maxLength) {
  return typeof value === "string"
    && value.trim().length >= minLength
    && value.length <= maxLength;
}

function validDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function invalid(response, message) {
  response.status(400).json({ error: message });
}

function notFound(response, message) {
  response.status(404).json({ error: message });
}

function projectItem(row) {
  return {
    id: String(row.id),
    name: row.name,
    description: row.description,
    department: row.department,
    status: row.status,
    progress: Number(row.progress),
    coordinatorId: row.coordinator_id === null ? "" : String(row.coordinator_id),
    coordinatorName: row.coordinator_name,
    canEdit: Boolean(row.can_edit),
    dueAt: row.due_at,
    memberCount: Number(row.member_count),
  };
}

export async function listManagementProjects(request, response, next) {
  try {
    const [projectsResult, statsResult, coordinatorsResult] = await Promise.all([
      query(
        `SELECT project.id, project.name, project.description, project.department, project.status, project.progress,
                project.coordinator_id, project.due_at, coordinator.full_name AS coordinator_name,
                COUNT(project_members.user_id)::int AS member_count,
                BOOL_OR(project.coordinator_id = $1 OR project_members.user_id = $1) AS can_edit
         FROM projects AS project
         LEFT JOIN users AS coordinator ON coordinator.id = project.coordinator_id
         LEFT JOIN project_members ON project_members.project_id = project.id
         GROUP BY project.id, coordinator.full_name
         ORDER BY project.updated_at DESC, project.created_at DESC
         LIMIT 100`,
        [request.user.id],
      ),
      query(
        `SELECT COUNT(*)::int AS count,
                COUNT(*) FILTER (WHERE LOWER(status) = 'active')::int AS active,
                COUNT(*) FILTER (WHERE LOWER(status) IN ('completed', 'complete'))::int AS completed
         FROM projects`,
      ),
      query(
        "SELECT id, full_name FROM users WHERE role = 'coordinator' AND is_active = TRUE ORDER BY full_name",
      ),
    ]);

    response.json({
      items: projectsResult.rows.map(projectItem),
      stats: statsResult.rows[0],
      coordinators: coordinatorsResult.rows.map((row) => ({
        id: String(row.id),
        fullName: row.full_name,
      })),
    });
  } catch (error) {
    next(error);
  }
}

export async function createManagementProject(request, response, next) {
  const { name, description = "", status = "planning", progress = 0, coordinatorId, dueAt } = request.body ?? {};
  const department = request.body?.department;
  const selectedCoordinator = request.user.role === "coordinator"
    ? request.user.id
    : coordinatorId || null;
  if (
    !validText(name, 2, 160) ||
    typeof description !== "string" || description.length > 2000 ||
    !projectStatuses.includes(status) ||
    !DEPARTMENTS.includes(department) || department === "Not sure yet" ||
    !Number.isInteger(progress) || progress < 0 || progress > 100 ||
    (selectedCoordinator !== null && !/^\d+$/.test(String(selectedCoordinator))) ||
    (dueAt !== undefined && dueAt !== null && dueAt !== "" && !validDate(dueAt))
  ) {
    invalid(response, "Provide valid project details.");
    return;
  }

  try {
    const result = await query(
      `INSERT INTO projects (name, description, department, status, progress, coordinator_id, due_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, description, department, status, progress, coordinator_id, due_at,
                 NULL::text AS coordinator_name, 0::int AS member_count`,
      [name.trim(), description.trim(), department || "", status, progress, selectedCoordinator, dueAt || null],
    );
    response.status(201).json({ item: projectItem(result.rows[0]) });
  } catch (error) {
    next(error);
  }
}

export async function updateManagementProject(request, response, next) {
  const { name, description = "", status = "planning", progress = 0, coordinatorId, dueAt } = request.body ?? {};
  const department = request.body?.department;
  if (
    !/^\d+$/.test(request.params.id) ||
    !validText(name, 2, 160) ||
    typeof description !== "string" || description.length > 2000 ||
    !projectStatuses.includes(status) ||
    !DEPARTMENTS.includes(department) || department === "Not sure yet" ||
    !Number.isInteger(progress) || progress < 0 || progress > 100 ||
    (coordinatorId !== undefined && coordinatorId !== null && coordinatorId !== "" && !/^\d+$/.test(String(coordinatorId))) ||
    (dueAt !== undefined && dueAt !== null && dueAt !== "" && !validDate(dueAt))
  ) {
    invalid(response, "Provide valid project details and ID.");
    return;
  }

  try {
    const projectScope = request.user.role === "coordinator"
      ? "AND (coordinator_id = $9 OR EXISTS (SELECT 1 FROM project_members WHERE project_id = projects.id AND user_id = $9))"
      : "";
    const values = [
      name.trim(),
      description.trim(),
      status,
      progress,
      request.user.role === "coordinator" ? request.user.id : coordinatorId || null,
      dueAt || null,
      department || "",
      request.params.id,
    ];
    if (request.user.role === "coordinator") {
      values.push(request.user.id);
    }
    const result = await query(
      `UPDATE projects
       SET name = $1, description = $2, status = $3, progress = $4, coordinator_id = $5,
           due_at = $6, department = $7, updated_at = NOW()
       WHERE id = $8 ${projectScope}
       RETURNING id, name, description, department, status, progress, coordinator_id, due_at,
                 NULL::text AS coordinator_name, 0::int AS member_count`,
      values,
    );
    if (!result.rowCount) {
      notFound(response, "Project not found.");
      return;
    }
    response.json({ item: projectItem(result.rows[0]) });
  } catch (error) {
    next(error);
  }
}

export async function listManagementAttendance(_request, response, next) {
  try {
    const [attendanceResult, eventsResult, membersResult, statsResult] = await Promise.all([
      query(
        `SELECT attendance.id, attendance.status, attendance.note, users.full_name AS user_name,
                users.email, events.title AS event_title, events.starts_at
         FROM attendance
         JOIN users ON users.id = attendance.user_id
         JOIN events ON events.id = attendance.event_id
         WHERE attendance.event_id IS NOT NULL
         ORDER BY events.starts_at DESC, attendance.id DESC
         LIMIT 500`,
      ),
      query("SELECT id, title, starts_at FROM events ORDER BY starts_at DESC LIMIT 200"),
      query("SELECT id, full_name, email FROM users WHERE is_active = TRUE AND role <> 'admin' ORDER BY full_name"),
      query(
        `SELECT COUNT(*)::int AS count,
                COUNT(*) FILTER (WHERE LOWER(status) = 'present')::int AS present,
                COALESCE(ROUND(100.0 * COUNT(*) FILTER (WHERE LOWER(status) IN ('present', 'late'))
                  / NULLIF(COUNT(*), 0)), 0)::int AS rate
         FROM attendance WHERE event_id IS NOT NULL`,
      ),
    ]);
    response.json({
      items: attendanceResult.rows.map((row) => ({
        id: String(row.id),
        userName: row.user_name,
        email: row.email,
        eventTitle: row.event_title,
        startsAt: row.starts_at,
        status: row.status,
        note: row.note,
      })),
      events: eventsResult.rows.map((row) => ({ id: String(row.id), title: row.title, startsAt: row.starts_at })),
      members: membersResult.rows.map((row) => ({ id: String(row.id), name: row.full_name, email: row.email })),
      stats: statsResult.rows[0],
    });
  } catch (error) {
    next(error);
  }
}

export async function createManagementAttendance(request, response, next) {
  const { eventId, userId, status = "present", note = "" } = request.body ?? {};
  if (
    !/^\d+$/.test(String(eventId ?? "")) ||
    !/^\d+$/.test(String(userId ?? "")) ||
    !attendanceStatuses.includes(status) ||
    typeof note !== "string" || note.length > 500
  ) {
    invalid(response, "Provide a valid event, member, attendance status, and note.");
    return;
  }
  try {
    const result = await query(
      `INSERT INTO attendance (event_id, user_id, status, note, recorded_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (event_id, user_id) WHERE event_id IS NOT NULL
       DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note,
                     recorded_by = EXCLUDED.recorded_by, recorded_at = NOW()
       RETURNING id`,
      [eventId, userId, status, note.trim(), request.user.id],
    );
    response.status(201).json({ id: String(result.rows[0].id) });
  } catch (error) {
    next(error);
  }
}

export async function updateManagementAttendance(request, response, next) {
  const { status, note = "" } = request.body ?? {};
  if (
    !/^\d+$/.test(request.params.id) ||
    !attendanceStatuses.includes(status) ||
    typeof note !== "string" || note.length > 500
  ) {
    invalid(response, "Provide a valid attendance ID, status, and note.");
    return;
  }
  try {
    const result = await query(
      `UPDATE attendance SET status = $1, note = $2, recorded_by = $3, recorded_at = NOW()
       WHERE id = $4 RETURNING id`,
      [status, note.trim(), request.user.id, request.params.id],
    );
    if (!result.rowCount) {
      notFound(response, "Attendance record not found.");
      return;
    }
    response.json({ id: String(result.rows[0].id) });
  } catch (error) {
    next(error);
  }
}

export async function listManagementFinance(_request, response, next) {
  try {
    const [itemsResult, statsResult] = await Promise.all([
      query(
        `SELECT financial_transactions.id, financial_transactions.transaction_type,
                financial_transactions.amount, financial_transactions.category,
                financial_transactions.description, financial_transactions.created_at,
                users.full_name AS created_by_name
         FROM financial_transactions
         LEFT JOIN users ON users.id = financial_transactions.entered_by
         ORDER BY financial_transactions.created_at DESC, financial_transactions.id DESC
         LIMIT 500`,
      ),
      query(
        `SELECT COUNT(*)::int AS count,
                COALESCE(SUM(amount) FILTER (WHERE transaction_type = 'income'), 0) AS income,
                COALESCE(SUM(amount) FILTER (WHERE transaction_type = 'expense'), 0) AS expenses,
                COALESCE(SUM(amount) FILTER (WHERE transaction_type = 'income'), 0)
                  - COALESCE(SUM(amount) FILTER (WHERE transaction_type = 'expense'), 0) AS balance
         FROM financial_transactions`,
      ),
    ]);
    response.json({
      items: itemsResult.rows.map((row) => ({
        id: String(row.id),
        type: row.transaction_type,
        amount: Number(row.amount),
        category: row.category,
        description: row.description,
        occurredOn: row.created_at,
        createdByName: row.created_by_name,
      })),
      stats: {
        ...statsResult.rows[0],
        income: Number(statsResult.rows[0].income),
        expenses: Number(statsResult.rows[0].expenses),
        balance: Number(statsResult.rows[0].balance),
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function createManagementFinance(request, response, next) {
  const { type, category, amount, description, occurredOn, memberId, projectId } = request.body ?? {};
  if (
    !["income", "expense"].includes(type) ||
    !validText(category, 2, 80) ||
    typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 ||
    !validText(description, 1, 500) ||
    !validDate(occurredOn) ||
    (memberId !== undefined && memberId !== null && memberId !== "" && !/^\d+$/.test(String(memberId))) ||
    (projectId !== undefined && projectId !== null && projectId !== "" && !/^\d+$/.test(String(projectId)))
  ) {
    invalid(response, "Provide a valid transaction type, category, amount, description, and date.");
    return;
  }
  try {
    const result = await query(
      `INSERT INTO financial_transactions
         (transaction_type, amount, category, description, member_id, project_id, entered_by, created_at)
       SELECT $1, $2, $3, $4, $5, $6, $7, $8::date
       WHERE ($5::bigint IS NULL OR EXISTS (
         SELECT 1 FROM users WHERE id = $5 AND role = 'member' AND is_active = TRUE
       ))
         AND ($6::bigint IS NULL OR EXISTS (
           SELECT 1 FROM projects WHERE id = $6
         ))
       RETURNING id`,
      [
        type,
        amount,
        category.trim(),
        description.trim(),
        memberId || null,
        projectId || null,
        request.user.id,
        occurredOn,
      ],
    );
    if (!result.rowCount) {
      response.status(400).json({ error: "Choose an active member and a valid project for this transaction." });
      return;
    }
    response.status(201).json({ id: String(result.rows[0].id) });
  } catch (error) {
    next(error);
  }
}

export async function updateManagementFinance(request, response, next) {
  const { type, category, amount, description, occurredOn } = request.body ?? {};
  if (
    !/^\d+$/.test(request.params.id) ||
    !["income", "expense"].includes(type) ||
    !validText(category, 2, 80) ||
    typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 ||
    !validText(description, 1, 500) ||
    !validDate(occurredOn)
  ) {
    invalid(response, "Provide a valid transaction ID and transaction details.");
    return;
  }
  try {
    const result = await query(
      `UPDATE financial_transactions
       SET transaction_type = $1, category = $2, amount = $3, description = $4, created_at = $5::date
       WHERE id = $6 RETURNING id`,
      [type, category.trim(), amount, description.trim(), occurredOn, request.params.id],
    );
    if (!result.rowCount) {
      notFound(response, "Transaction not found.");
      return;
    }
    response.json({ id: String(result.rows[0].id) });
  } catch (error) {
    next(error);
  }
}

export async function deleteManagementFinance(request, response, next) {
  if (!/^\d+$/.test(request.params.id)) {
    invalid(response, "Invalid transaction ID.");
    return;
  }
  try {
    const result = await query("DELETE FROM financial_transactions WHERE id = $1 RETURNING id", [request.params.id]);
    if (!result.rowCount) {
      notFound(response, "Transaction not found.");
      return;
    }
    response.status(204).end();
  } catch (error) {
    next(error);
  }
}

export async function listManagementEvents(_request, response, next) {
  try {
    const result = await query(
      `SELECT id, title, starts_at, location, description, category, status
       FROM events
       ORDER BY CASE WHEN starts_at >= NOW() AND status <> 'cancelled' THEN 0 ELSE 1 END,
                CASE WHEN starts_at >= NOW() AND status <> 'cancelled' THEN starts_at END ASC,
                starts_at DESC
       LIMIT 500`,
    );
    response.json({
      items: result.rows.map((row) => ({
        id: String(row.id),
        title: row.title,
        startsAt: row.starts_at,
        location: row.location,
        description: row.description,
        category: row.category,
        status: row.status,
      })),
    });
  } catch (error) {
    next(error);
  }
}

export async function createManagementEvent(request, response, next) {
  const { title, startsAt, location = "", description = "", category = "Meeting", status = "scheduled" } = request.body ?? {};
  if (
    !validText(title, 2, 160) || !validDate(startsAt) ||
    typeof location !== "string" || location.length > 200 ||
    typeof description !== "string" || description.length > 2000 ||
    typeof category !== "string" || category.length > 80 ||
    !eventStatuses.includes(status)
  ) {
    invalid(response, "Provide valid event details.");
    return;
  }
  try {
    const result = await query(
      `INSERT INTO events (title, starts_at, location, description, category, status)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [title.trim(), startsAt, location.trim(), description.trim(), category.trim(), status],
    );
    response.status(201).json({ id: String(result.rows[0].id) });
  } catch (error) {
    next(error);
  }
}

export async function updateManagementEvent(request, response, next) {
  const { title, startsAt, location = "", description = "", category = "Meeting", status = "scheduled" } = request.body ?? {};
  if (
    !/^\d+$/.test(request.params.id) ||
    !validText(title, 2, 160) || !validDate(startsAt) ||
    typeof location !== "string" || location.length > 200 ||
    typeof description !== "string" || description.length > 2000 ||
    typeof category !== "string" || category.length > 80 ||
    !eventStatuses.includes(status)
  ) {
    invalid(response, "Provide a valid event ID and event details.");
    return;
  }
  try {
    const result = await query(
      `UPDATE events
       SET title = $1, starts_at = $2, location = $3, description = $4, category = $5, status = $6
       WHERE id = $7 RETURNING id`,
      [title.trim(), startsAt, location.trim(), description.trim(), category.trim(), status, request.params.id],
    );
    if (!result.rowCount) {
      notFound(response, "Event not found.");
      return;
    }
    response.json({ id: String(result.rows[0].id) });
  } catch (error) {
    next(error);
  }
}

export async function listManagementApprovals(request, response, next) {
  const isAdmin = request.user.role === "admin";
  const whereClause = isAdmin ? "" : "WHERE approval_requests.submitted_by = $1";
  const values = isAdmin ? [] : [request.user.id];
  try {
    const [itemsResult, statsResult] = await Promise.all([
      query(
        `SELECT approval_requests.id, request_type, title, description, status, review_note,
                approval_requests.created_at, users.full_name AS requested_by_name
         FROM approval_requests
         LEFT JOIN users ON users.id = approval_requests.submitted_by
         ${whereClause}
         ORDER BY approval_requests.created_at DESC LIMIT 500`,
        values,
      ),
      query(
        `SELECT COUNT(*) FILTER (WHERE LOWER(status) = 'pending')::int AS pending,
                COUNT(*) FILTER (WHERE LOWER(status) = 'approved')::int AS approved,
                COUNT(*) FILTER (WHERE LOWER(status) = 'rejected')::int AS rejected
         FROM approval_requests ${isAdmin ? "" : "WHERE submitted_by = $1"}`,
        values,
      ),
    ]);
    response.json({
      items: itemsResult.rows.map((row) => ({
        id: String(row.id),
        type: row.request_type,
        title: row.title,
        description: row.description,
        status: row.status,
        reviewNote: row.review_note,
        createdAt: row.created_at,
        requestedByName: row.requested_by_name,
      })),
      stats: statsResult.rows[0],
    });
  } catch (error) {
    next(error);
  }
}

export async function createManagementApproval(request, response, next) {
  const { title, type, description } = request.body ?? {};
  if (!validText(title, 3, 160) || !validText(type, 1, 80) || !validText(description, 5, 2000)) {
    invalid(response, "Provide a valid request title, type, and description.");
    return;
  }
  try {
    const result = await query(
      `INSERT INTO approval_requests (request_type, title, description, submitted_by)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [type.trim(), title.trim(), description.trim(), request.user.id],
    );
    response.status(201).json({ id: String(result.rows[0].id) });
  } catch (error) {
    next(error);
  }
}

export async function updateManagementApproval(request, response, next) {
  const { status, reviewNote = "" } = request.body ?? {};
  if (
    !/^\d+$/.test(request.params.id) ||
    !["approved", "rejected"].includes(status) ||
    typeof reviewNote !== "string" || reviewNote.length > 1000
  ) {
    invalid(response, "Provide a valid approval ID, decision, and review note.");
    return;
  }
  try {
    const result = await query(
      `UPDATE approval_requests SET status = $1, review_note = $2
       WHERE id = $3 RETURNING id`,
      [status, reviewNote.trim(), request.params.id],
    );
    if (!result.rowCount) {
      notFound(response, "Approval request not found.");
      return;
    }
    response.json({ id: String(result.rows[0].id) });
  } catch (error) {
    next(error);
  }
}

export async function managementReports(request, response, next) {
  try {
    const [statsResult, monthlyFinanceResult, projectStatusResult, attendanceResult, attendanceReportsResult] = await Promise.all([
      query(
        `SELECT
           (SELECT COUNT(*) FROM projects
            WHERE LOWER(status) NOT IN ('completed', 'complete', 'cancelled')) AS "activeProjects",
           (SELECT COUNT(*) FROM projects
            WHERE LOWER(status) IN ('completed', 'complete')) AS "completedProjects",
           (SELECT COUNT(*) FROM events WHERE starts_at >= NOW()) AS "upcomingEvents",
           (SELECT COUNT(*) FROM attendance) AS "attendanceTotal",
           (SELECT COUNT(*) FROM attendance WHERE LOWER(status) = 'present') AS "presentAttendance",
           (SELECT COALESCE(SUM(amount) FILTER (WHERE transaction_type = 'income'), 0)
              - COALESCE(SUM(amount) FILTER (WHERE transaction_type = 'expense'), 0)
            FROM financial_transactions) AS balance`,
      ),
      query(
        `SELECT TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM-DD') AS month,
                COALESCE(SUM(amount) FILTER (WHERE transaction_type = 'income'), 0) AS income,
                COALESCE(SUM(amount) FILTER (WHERE transaction_type = 'expense'), 0) AS expenses
         FROM financial_transactions
         WHERE created_at >= DATE_TRUNC('month', NOW()) - INTERVAL '5 months'
         GROUP BY DATE_TRUNC('month', created_at)
         ORDER BY DATE_TRUNC('month', created_at)`,
      ),
      query(
        `SELECT status, COUNT(*) AS count
         FROM projects
         GROUP BY status
         ORDER BY status`,
      ),
      query(
        `SELECT LOWER(status) AS status, COUNT(*) AS count
         FROM attendance
         GROUP BY LOWER(status)
         ORDER BY LOWER(status)`,
      ),
      query(
        `SELECT activity_type AS "activityType", activity_id AS "activityId", title,
                starts_at AS "startsAt", records, present, late, absent, excused,
                CASE WHEN records = 0 THEN 0
                     ELSE ROUND(100.0 * (present + late) / records)::int
                END AS "attendanceRate"
         FROM (
           SELECT 'event' AS activity_type, events.id AS activity_id, events.title,
                  events.starts_at, COUNT(attendance.id)::int AS records,
                  COUNT(attendance.id) FILTER (WHERE LOWER(attendance.status) = 'present')::int AS present,
                  COUNT(attendance.id) FILTER (WHERE LOWER(attendance.status) = 'late')::int AS late,
                  COUNT(attendance.id) FILTER (WHERE LOWER(attendance.status) = 'absent')::int AS absent,
                  COUNT(attendance.id) FILTER (WHERE LOWER(attendance.status) = 'excused')::int AS excused
           FROM events
           LEFT JOIN attendance ON attendance.event_id = events.id
           GROUP BY events.id
           UNION ALL
           SELECT 'meeting' AS activity_type, meetings.id AS activity_id, meetings.title,
                  meetings.starts_at, COUNT(attendance.id)::int AS records,
                  COUNT(attendance.id) FILTER (WHERE LOWER(attendance.status) = 'present')::int AS present,
                  COUNT(attendance.id) FILTER (WHERE LOWER(attendance.status) = 'late')::int AS late,
                  COUNT(attendance.id) FILTER (WHERE LOWER(attendance.status) = 'absent')::int AS absent,
                  COUNT(attendance.id) FILTER (WHERE LOWER(attendance.status) = 'excused')::int AS excused
           FROM meetings
           LEFT JOIN attendance ON attendance.meeting_id = meetings.id
           GROUP BY meetings.id
         ) AS activity_attendance
         ORDER BY "startsAt" DESC, activity_type, activity_id
         LIMIT 100`,
      ),
    ]);

    const stats = statsResult.rows[0];
    const attendanceTotal = Number(stats.attendanceTotal);
    const financeAvailable = ["admin", "treasurer"].includes(request.user.role);
    const attendanceSummary = {
      total: attendanceTotal,
      byStatus: Object.fromEntries(
        attendanceResult.rows.map((row) => [row.status, Number(row.count)]),
      ),
    };

    response.json({
      financeAvailable,
      stats: {
        activeProjects: Number(stats.activeProjects),
        completedProjects: Number(stats.completedProjects),
        upcomingEvents: Number(stats.upcomingEvents),
        attendanceRate: attendanceTotal
          ? Math.round((Number(stats.presentAttendance) / attendanceTotal) * 100)
          : 0,
        balance: financeAvailable ? Number(stats.balance) : 0,
      },
      monthlyFinance: financeAvailable ? monthlyFinanceResult.rows.map((row) => ({
        ...row,
        income: Number(row.income),
        expenses: Number(row.expenses),
      })) : [],
      projectStatus: projectStatusResult.rows.map((row) => ({
        ...row,
        count: Number(row.count),
      })),
      attendanceSummary,
      attendanceReports: attendanceReportsResult.rows,
    });
  } catch (error) {
    next(error);
  }
}
