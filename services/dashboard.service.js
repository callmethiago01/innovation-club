import { query } from "../db.js";

async function getProjects(user) {
  let filter = "";
  const values = [];

  if (user.role === "member") {
    filter = "WHERE project.department = $1";
    values.push(user.department ?? "");
  } else if (user.role === "coordinator") {
    filter = `WHERE project.coordinator_id = $1
      OR project.id IN (SELECT project_id FROM project_members WHERE user_id = $1)`;
    values.push(user.id);
  }

  const result = await query(
    `SELECT project.id, project.name, project.status, project.progress
     FROM projects AS project
     ${filter}
     ORDER BY project.updated_at DESC, project.created_at DESC
     LIMIT 6`,
    values,
  );
  return result.rows.map((project) => ({
    id: String(project.id),
    name: project.name,
    status: project.status,
    progress: project.progress,
  }));
}

async function getTasks(user) {
  const filter = user.role === "member"
    ? "task.assigned_to = $1"
    : `(project.coordinator_id = $1
      OR project.id IN (SELECT project_id FROM project_members WHERE user_id = $1))`;
  const result = await query(
    `SELECT task.id, task.title, task.status, task.due_at, project.name AS project_name
     FROM tasks AS task
     JOIN projects AS project ON project.id = task.project_id
     WHERE ${filter}
       AND LOWER(task.status) NOT IN ('done', 'complete', 'completed')
     ORDER BY task.due_at ASC NULLS LAST, task.created_at DESC
     LIMIT 5`,
    [user.id],
  );
  return result.rows.map((task) => ({
    id: String(task.id),
    title: task.title,
    status: task.status,
    dueAt: task.due_at,
    projectName: task.project_name,
  }));
}

async function getEvents() {
  const result = await query(
    `SELECT id, title, starts_at, location
     FROM events
     WHERE starts_at >= NOW()
     ORDER BY starts_at ASC
     LIMIT 4`,
  );
  return result.rows.map((event) => ({
    id: String(event.id),
    title: event.title,
    startsAt: event.starts_at,
    location: event.location,
  }));
}

async function getAnnouncements() {
  const result = await query(
    `SELECT id, title, body, published_at
     FROM announcements
     ORDER BY published_at DESC
     LIMIT 4`,
  );
  return result.rows.map((announcement) => ({
    id: String(announcement.id),
    title: announcement.title,
    body: announcement.body,
    publishedAt: announcement.published_at,
  }));
}

async function getAchievements(user) {
  const result = await query(
    `SELECT id, title, description
     FROM achievements
     WHERE user_id = $1
     ORDER BY awarded_at DESC
     LIMIT 6`,
    [user.id],
  );
  return result.rows.map((achievement) => ({
    id: String(achievement.id),
    title: achievement.title,
    description: achievement.description,
  }));
}

async function getStats(user) {
  if (user.role === "admin") {
    const result = await query(
      `SELECT
        (SELECT COUNT(*) FROM users WHERE role <> 'admin' AND is_active = TRUE) AS members,
        (SELECT COUNT(*) FROM projects WHERE LOWER(status) NOT IN ('completed', 'complete', 'cancelled')) AS active_projects,
        (SELECT COUNT(*) FROM events WHERE starts_at >= NOW()) AS upcoming_events,
        (SELECT COUNT(*) FROM approval_requests WHERE LOWER(status) = 'pending') AS pending_approvals,
        (SELECT COALESCE(SUM(amount) FILTER (WHERE transaction_type = 'income'), 0) FROM financial_transactions) AS total_income,
        (SELECT COALESCE(SUM(amount) FILTER (WHERE transaction_type = 'expense'), 0) FROM financial_transactions) AS total_expenses`,
    );
    const row = result.rows[0];
    return [
      { label: "Registered members", value: row.members, detail: "Active club accounts", icon: "users" },
      { label: "Active projects", value: row.active_projects, detail: "Across the club", icon: "projects" },
      { label: "Upcoming events", value: row.upcoming_events, detail: "Scheduled activities", icon: "calendar" },
      { label: "Pending approvals", value: row.pending_approvals, detail: "Awaiting review", icon: "approvals" },
      { label: "Total income", value: row.total_income, detail: "Recorded club income", icon: "finance", format: "currency" },
      { label: "Total expenses", value: row.total_expenses, detail: "Recorded club expenses", icon: "finance", format: "currency" },
    ];
  }

  if (user.role === "treasurer") {
    const result = await query(
      `SELECT
        COALESCE(SUM(amount) FILTER (WHERE transaction_type = 'income'), 0) AS income,
        COALESCE(SUM(amount) FILTER (WHERE transaction_type = 'expense'), 0) AS expenses,
        COALESCE(SUM(amount) FILTER (
          WHERE transaction_type = 'income' AND member_id IS NOT NULL
        ), 0) AS contributions,
        (SELECT COALESCE(SUM(budget), 0) FROM projects) AS project_budgets
       FROM financial_transactions`,
    );
    const row = result.rows[0];
    const income = Number(row.income);
    const expenses = Number(row.expenses);
    return [
      { label: "Total income", value: income, detail: "All recorded income", icon: "finance", format: "currency" },
      { label: "Total expenses", value: expenses, detail: "All recorded expenses", icon: "finance", format: "currency" },
      { label: "Available balance", value: income - expenses, detail: "Income less expenses", icon: "finance", format: "currency" },
      { label: "Member contributions", value: row.contributions, detail: "Recorded contribution income", icon: "users", format: "currency" },
      { label: "Project budgets", value: row.project_budgets, detail: "Combined allocated budgets", icon: "projects", format: "currency" },
    ];
  }

  if (user.role === "secretary") {
    const result = await query(
      `SELECT
        (SELECT COUNT(*) FROM users WHERE role <> 'admin' AND is_active = TRUE) AS members,
        (SELECT COUNT(*) FROM meetings WHERE starts_at >= NOW()) AS upcoming_meetings,
        (SELECT COUNT(*) FROM attendance WHERE LOWER(status) = 'present') AS present_records,
        (SELECT COUNT(*) FROM attendance) AS attendance_records,
        (SELECT COUNT(*) FROM announcements WHERE published_at >= NOW() - INTERVAL '30 days') AS recent_announcements`,
    );
    const row = result.rows[0];
    const attendanceRate = Number(row.attendance_records)
      ? Math.round((Number(row.present_records) / Number(row.attendance_records)) * 100)
      : 0;
    return [
      { label: "Club members", value: row.members, detail: "Active club accounts", icon: "users" },
      { label: "Upcoming meetings", value: row.upcoming_meetings, detail: "Scheduled meetings", icon: "calendar" },
      { label: "Attendance rate", value: `${attendanceRate}%`, detail: "Recorded attendance", icon: "attendance" },
      { label: "Recent announcements", value: row.recent_announcements, detail: "Published in the last 30 days", icon: "approvals" },
    ];
  }

  if (user.role === "coordinator") {
    const result = await query(
      `SELECT
        COUNT(*) FILTER (WHERE LOWER(project.status) NOT IN ('completed', 'complete', 'cancelled')) AS active_projects,
        COUNT(*) FILTER (WHERE LOWER(project.status) IN ('completed', 'complete')) AS completed_projects,
        COALESCE(ROUND(AVG(project.progress)), 0) AS avg_progress,
        (SELECT COUNT(*) FROM tasks
         JOIN projects AS assigned_project ON assigned_project.id = tasks.project_id
         WHERE (assigned_project.coordinator_id = $1
           OR assigned_project.id IN (SELECT project_id FROM project_members WHERE user_id = $1))
           AND LOWER(tasks.status) NOT IN ('done', 'complete', 'completed')) AS pending_tasks,
        (SELECT COUNT(*) FROM tasks
         JOIN projects AS assigned_project ON assigned_project.id = tasks.project_id
         WHERE (assigned_project.coordinator_id = $1
           OR assigned_project.id IN (SELECT project_id FROM project_members WHERE user_id = $1))
           AND tasks.due_at >= NOW()
           AND LOWER(tasks.status) NOT IN ('done', 'complete', 'completed')) AS upcoming_deadlines
       FROM projects AS project
       WHERE project.coordinator_id = $1
          OR project.id IN (SELECT project_id FROM project_members WHERE user_id = $1)`,
      [user.id],
    );
    const row = result.rows[0];
    return [
      { label: "Active projects", value: row.active_projects, detail: "In your project teams", icon: "projects" },
      { label: "Pending tasks", value: row.pending_tasks, detail: "Across your projects", icon: "tasks" },
      { label: "Upcoming deadlines", value: row.upcoming_deadlines, detail: "Open tasks with due dates", icon: "calendar" },
      { label: "Completed projects", value: row.completed_projects, detail: "In your project teams", icon: "approvals" },
      { label: "Average progress", value: `${row.avg_progress}%`, detail: "Across your projects", icon: "progress" },
    ];
  }

  const result = await query(
    `SELECT
      (SELECT COUNT(*) FROM projects WHERE department = $2
        AND LOWER(status) NOT IN ('completed', 'complete', 'cancelled')) AS projects,
      (SELECT COUNT(*) FROM tasks WHERE assigned_to = $1
        AND LOWER(status) NOT IN ('done', 'complete', 'completed')) AS pending_tasks,
      (SELECT COUNT(*) FROM events WHERE starts_at >= NOW()) AS upcoming_events,
      (SELECT COUNT(*) FROM achievements WHERE user_id = $1) AS achievements,
      (SELECT COUNT(*) FROM attendance WHERE user_id = $1) AS attendance_records,
      (SELECT COUNT(*) FROM attendance WHERE user_id = $1 AND LOWER(status) = 'present') AS present_records`,
    [user.id, user.department ?? ""],
  );
  const row = result.rows[0];
  const attendanceRate = Number(row.attendance_records)
    ? Math.round((Number(row.present_records) / Number(row.attendance_records)) * 100)
    : 0;
  return [
    { label: "Department projects", value: row.projects, detail: "Available in your department", icon: "projects" },
    { label: "Assigned tasks", value: row.pending_tasks, detail: "Tasks still in progress", icon: "tasks" },
    { label: "Upcoming events", value: row.upcoming_events, detail: "Club activities", icon: "calendar" },
    { label: "Attendance", value: `${attendanceRate}%`, detail: "Your recorded attendance", icon: "attendance" },
    { label: "Achievements", value: row.achievements, detail: "Recognitions earned", icon: "achievements" },
  ];
}

export async function getDashboard(user) {
  const [stats, projects, tasks, events, announcements] = await Promise.all([
    getStats(user),
    getProjects(user),
    user.role === "member" || user.role === "coordinator" ? getTasks(user) : Promise.resolve([]),
    getEvents(),
    getAnnouncements(),
  ]);
  const achievements = user.role === "member" ? await getAchievements(user) : [];

  return { stats, projects, tasks, events, announcements, achievements };
}
