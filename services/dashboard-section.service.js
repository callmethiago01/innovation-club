import { query } from "../db.js";

const sectionRoles = {
  users: ["admin"],
  projects: ["admin", "secretary", "coordinator"],
  my_projects: ["member"],
  attendance: ["admin", "secretary"],
  my_attendance: ["member"],
  attendance_reports: ["secretary"],
  finance: ["admin", "treasurer"],
  contributions: ["treasurer"],
  budgets: ["treasurer"],
  finance_reports: ["treasurer"],
  messages: ["admin", "treasurer", "secretary", "coordinator", "member"],
  events: ["admin", "treasurer", "coordinator", "member"],
  meetings: ["secretary"],
  announcements: ["admin", "treasurer", "secretary", "coordinator", "member"],
  resources: ["admin", "secretary", "coordinator", "member"],
  reports: ["admin"],
  approvals: ["admin"],
  members: ["secretary", "treasurer", "member"],
  teams: ["coordinator", "member"],
  tasks: ["coordinator", "member"],
  progress: ["coordinator"],
  project_reports: ["coordinator"],
  achievements: ["member"],
  ideas: ["member"],
  notifications: ["member"],
  profile: ["admin", "treasurer", "secretary", "coordinator", "member"],
  settings: ["admin", "treasurer", "secretary", "coordinator", "member"],
};

export function canViewDashboardSection(section, role) {
  return sectionRoles[section]?.includes(role) ?? false;
}

export async function getDashboardSection(section, user) {
  const projectScope = user.role === "member"
    ? "project.id IN (SELECT project_id FROM project_members WHERE user_id = $1)"
    : "TRUE";
  const projectValues = user.role === "member" ? [user.id] : [];
  let text;
  let values = [];

  switch (section) {
    case "users":
      text = `SELECT full_name AS "Name", email AS "Email", role AS "Role",
                     department AS "Department", is_active AS "Active", created_at AS "Joined"
              FROM users
              ORDER BY full_name, id
              LIMIT 100`;
      break;
    case "members": {
      const memberScope = user.role === "member"
        ? "WHERE role = 'member' AND is_active = TRUE AND department = $1"
        : "WHERE role <> 'admin' AND is_active = TRUE";
      text = `SELECT id AS "Member ID", full_name AS "Name", email AS "Email", role AS "Role",
                     department AS "Department", is_active AS "Active", created_at AS "Joined"
              FROM users
              ${memberScope}
              ORDER BY full_name, id
              LIMIT 200`;
      values = user.role === "member" ? [user.department ?? ""] : [];
      break;
    }
    case "projects":
    case "my_projects":
      text = `SELECT project.name AS "Project", project.status AS "Status",
                     project.progress AS "Progress", project.budget AS "Budget",
                     project.created_at AS "Created"
              FROM projects AS project
              WHERE ${projectScope}
              ORDER BY project.updated_at DESC, project.created_at DESC
              LIMIT 100`;
      values = projectValues;
      text = text.replace(', project.budget AS "Budget"', "");
      text = text.replace(', project.progress AS "Progress"', "");
      break;
    case "progress":
      text = `SELECT project.id AS "Project ID", project.name AS "Project",
                     project.department AS "Department", project.status AS "Status",
                     project.progress AS "Progress", project.due_at AS "Target date",
                     (SELECT COUNT(*) FROM tasks WHERE project_id = project.id) AS "Tasks",
                     (SELECT COUNT(*) FROM tasks WHERE project_id = project.id
                       AND LOWER(status) IN ('done', 'complete', 'completed')) AS "Completed tasks",
                     (SELECT COUNT(*) FROM project_milestones WHERE project_id = project.id) AS "Milestones",
                     (SELECT COUNT(*) FROM project_milestones WHERE project_id = project.id
                       AND LOWER(status) = 'completed') AS "Completed milestones",
                     (SELECT COUNT(*) FROM tasks WHERE project_id = project.id
                       AND due_at < NOW()
                       AND LOWER(status) NOT IN ('done', 'complete', 'completed')) AS "Overdue tasks"
              FROM projects AS project
              WHERE ${projectScope}
              ORDER BY project.updated_at DESC, project.name
              LIMIT 100`;
      values = projectValues;
      break;
    case "attendance":
    case "my_attendance":
      text = `SELECT COALESCE(meeting.title, event.title) AS "Activity",
                     COALESCE(meeting.starts_at, event.starts_at) AS "Activity date",
                     attendance.status AS "Status", attendance.note AS "Note",
                     attendance.recorded_at AS "Recorded"
              FROM attendance
              LEFT JOIN meetings AS meeting ON meeting.id = attendance.meeting_id
              LEFT JOIN events AS event ON event.id = attendance.event_id
              WHERE (meeting.id IS NOT NULL OR event.id IS NOT NULL)
              ${section === "my_attendance" ? "AND attendance.user_id = $1" : ""}
              ORDER BY COALESCE(meeting.starts_at, event.starts_at) DESC, attendance.id DESC
              LIMIT 100`;
      values = section === "my_attendance" ? [user.id] : [];
      break;
    case "attendance_reports":
      text = `SELECT activity_type AS "Activity type", title AS "Activity",
                     starts_at AS "Activity date", records AS "Recorded attendees",
                     present AS "Present", late AS "Late", absent AS "Absent",
                     excused AS "Excused",
                     CASE WHEN records = 0 THEN 0
                          ELSE ROUND(100.0 * (present + late) / records)::int
                     END AS "Attendance rate (%)"
              FROM (
                SELECT 'Event' AS activity_type, events.title, events.starts_at,
                       COUNT(attendance.id)::int AS records,
                       COUNT(attendance.id) FILTER (WHERE LOWER(attendance.status) = 'present')::int AS present,
                       COUNT(attendance.id) FILTER (WHERE LOWER(attendance.status) = 'late')::int AS late,
                       COUNT(attendance.id) FILTER (WHERE LOWER(attendance.status) = 'absent')::int AS absent,
                       COUNT(attendance.id) FILTER (WHERE LOWER(attendance.status) = 'excused')::int AS excused
                FROM events
                LEFT JOIN attendance ON attendance.event_id = events.id
                GROUP BY events.id
                UNION ALL
                SELECT 'Meeting' AS activity_type, meetings.title, meetings.starts_at,
                       COUNT(attendance.id)::int AS records,
                       COUNT(attendance.id) FILTER (WHERE LOWER(attendance.status) = 'present')::int AS present,
                       COUNT(attendance.id) FILTER (WHERE LOWER(attendance.status) = 'late')::int AS late,
                       COUNT(attendance.id) FILTER (WHERE LOWER(attendance.status) = 'absent')::int AS absent,
                       COUNT(attendance.id) FILTER (WHERE LOWER(attendance.status) = 'excused')::int AS excused
                FROM meetings
                LEFT JOIN attendance ON attendance.meeting_id = meetings.id
                GROUP BY meetings.id
              ) AS activity_attendance
              ORDER BY starts_at DESC
              LIMIT 100`;
      break;
    case "contributions":
      text = `SELECT financial_transactions.transaction_type AS "Type",
                     financial_transactions.id AS "Transaction ID",
                     financial_transactions.amount AS "Amount",
                     financial_transactions.category AS "Category",
                     financial_transactions.description AS "Description",
                     member.id AS "Member ID", member.full_name AS "Member",
                     member.department AS "Department", project.id AS "Project ID",
                     project.name AS "Project",
                     financial_transactions.created_at AS "Recorded"
              FROM financial_transactions
              LEFT JOIN users AS member ON member.id = financial_transactions.member_id
              LEFT JOIN projects AS project ON project.id = financial_transactions.project_id
              WHERE financial_transactions.transaction_type = 'income'
                AND financial_transactions.member_id IS NOT NULL
              ORDER BY financial_transactions.created_at DESC
              LIMIT 500`;
      break;
    case "budgets":
      text = `SELECT project.id AS "Project ID", project.name AS "Project",
                     project.department AS "Department", project.status AS "Status",
                     project.budget AS "Allocated budget",
                     COALESCE(SUM(finance.amount) FILTER (WHERE finance.transaction_type = 'expense'), 0) AS "Spent",
                     project.budget - COALESCE(SUM(finance.amount) FILTER (WHERE finance.transaction_type = 'expense'), 0) AS "Remaining",
                     CASE WHEN project.budget > 0
                       THEN ROUND(100.0 * COALESCE(SUM(finance.amount) FILTER (WHERE finance.transaction_type = 'expense'), 0) / project.budget)::int
                       ELSE 0 END AS "Budget used (%)"
              FROM projects AS project
              LEFT JOIN financial_transactions AS finance ON finance.project_id = project.id
              GROUP BY project.id
              ORDER BY project.department, project.name
              LIMIT 200`;
      break;
    case "finance_reports":
      text = `WITH months AS (
                SELECT generate_series(
                  DATE_TRUNC('month', NOW()) - INTERVAL '11 months',
                  DATE_TRUNC('month', NOW()),
                  INTERVAL '1 month'
                ) AS month
              )
              SELECT months.month::date AS "Month",
                     COALESCE(SUM(finance.amount) FILTER (WHERE finance.transaction_type = 'income'), 0) AS "Income",
                     COALESCE(SUM(finance.amount) FILTER (WHERE finance.transaction_type = 'expense'), 0) AS "Expenses",
                     COALESCE(SUM(finance.amount) FILTER (WHERE finance.transaction_type = 'income'), 0)
                       - COALESCE(SUM(finance.amount) FILTER (WHERE finance.transaction_type = 'expense'), 0) AS "Net",
                     COUNT(finance.id)::int AS "Transactions"
              FROM months
              LEFT JOIN financial_transactions AS finance
                ON DATE_TRUNC('month', finance.created_at) = months.month
              GROUP BY months.month
              ORDER BY months.month`;
      break;
    case "messages":
      text = `SELECT conversation.name AS "Conversation",
                     sender.full_name AS "From", message.body AS "Message",
                     message.sent_at AS "Sent"
              FROM messages AS message
              JOIN conversations AS conversation ON conversation.id = message.conversation_id
              JOIN users AS sender ON sender.id = message.sender_id
              WHERE EXISTS (
                SELECT 1 FROM conversation_members
                WHERE conversation_members.conversation_id = message.conversation_id
                  AND conversation_members.user_id = $1
              )
              ORDER BY message.sent_at DESC
              LIMIT 100`;
      values = [user.id];
      break;
    case "events":
    case "meetings":
      text = `SELECT title AS "Title", starts_at AS "Date", location AS "Location",
                     description AS "Details", 'Event' AS "Type"
              FROM events
              ${section === "meetings" ? "WHERE FALSE" : ""}
              UNION ALL
              SELECT title AS "Title", starts_at AS "Date", '' AS "Location",
                     minutes AS "Details", 'Meeting' AS "Type"
              FROM meetings
              ${section === "events" ? "WHERE FALSE" : ""}
              ORDER BY "Date" DESC
              LIMIT 100`;
      break;
    case "announcements":
      text = `SELECT title AS "Title", body AS "Announcement",
                     published_at AS "Published"
              FROM announcements
              ORDER BY published_at DESC
              LIMIT 100`;
      break;
    case "resources":
      text = `SELECT title AS "Title", description AS "Description",
                     category AS "Category", url AS "URL",
                     created_at AS "Added"
              FROM resources
              ORDER BY created_at DESC
              LIMIT 100`;
      break;
    case "reports":
      text = `SELECT 'Active members' AS "Metric",
                     COUNT(*)::text AS "Value"
              FROM users WHERE is_active = TRUE AND role <> 'admin'
              UNION ALL
              SELECT 'Active projects', COUNT(*)::text
              FROM projects WHERE LOWER(status) NOT IN ('completed', 'complete', 'cancelled')
              UNION ALL
              SELECT 'Upcoming events', COUNT(*)::text
              FROM events WHERE starts_at >= NOW()
              UNION ALL
              SELECT 'Pending approvals', COUNT(*)::text
              FROM approval_requests WHERE LOWER(status) = 'pending'
              UNION ALL
              SELECT 'Income recorded', COALESCE(SUM(amount), 0)::text
              FROM financial_transactions WHERE transaction_type = 'income'
              UNION ALL
              SELECT 'Expenses recorded', COALESCE(SUM(amount), 0)::text
              FROM financial_transactions WHERE transaction_type = 'expense'`;
      break;
    case "approvals":
      text = `SELECT request_type AS "Type", title AS "Request",
                     status AS "Status", users.full_name AS "Submitted by",
                     approval_requests.created_at AS "Submitted"
              FROM approval_requests
              LEFT JOIN users ON users.id = approval_requests.submitted_by
              ORDER BY approval_requests.created_at DESC
              LIMIT 100`;
      break;
    case "teams":
      text = `SELECT project.id AS "Project ID", project.name AS "Project",
                     project.department AS "Department", project.status AS "Project status",
                     users.id AS "Member ID", users.full_name AS "Team member",
                     users.email AS "Email", users.role AS "Role",
                     project_members.joined_at AS "Joined",
                     COUNT(project_members.user_id) OVER (PARTITION BY project.id) AS "Team size"
              FROM projects AS project
              LEFT JOIN project_members ON project_members.project_id = project.id
              LEFT JOIN users ON users.id = project_members.user_id
              WHERE ${projectScope}
              ORDER BY project.name, users.full_name NULLS LAST
              LIMIT 500`;
      values = projectValues;
      break;
    case "tasks": {
      const taskScope = user.role === "member"
        ? "task.assigned_to = $1"
        : projectScope;
      text = `SELECT task.id AS "Task ID", task.title AS "Task",
                     task.description AS "Description", project.id AS "Project ID",
                     project.name AS "Project", project.department AS "Department",
                     project.status AS "Project status", task.status AS "Status",
                     assignee.id AS "Assignee ID", assignee.full_name AS "Assigned to",
                     task.due_at AS "Due",
                     (task.due_at < NOW() AND LOWER(task.status) NOT IN ('done', 'complete', 'completed')) AS "Overdue"
              FROM tasks AS task
              JOIN projects AS project ON project.id = task.project_id
              LEFT JOIN users AS assignee ON assignee.id = task.assigned_to
              WHERE ${taskScope}
              ORDER BY task.due_at ASC NULLS LAST, task.created_at DESC
              LIMIT 100`;
      values = user.role === "member" ? [user.id] : projectValues;
      break;
    }
    case "project_reports":
      text = `SELECT project.id AS "Project ID", project.name AS "Project",
                     project.department AS "Department", project.status AS "Status",
                     project.progress AS "Progress", project.due_at AS "Target date",
                     coordinator.full_name AS "Coordinator",
                     (SELECT COUNT(*) FROM tasks WHERE project_id = project.id) AS "Tasks",
                     (SELECT COUNT(*) FROM tasks WHERE project_id = project.id
                       AND LOWER(status) IN ('done', 'complete', 'completed')) AS "Completed tasks",
                     (SELECT COUNT(*) FROM project_milestones WHERE project_id = project.id) AS "Milestones",
                     (SELECT COUNT(*) FROM project_milestones WHERE project_id = project.id
                       AND LOWER(status) = 'completed') AS "Completed milestones",
                     (SELECT COUNT(*) FROM project_members WHERE project_id = project.id) AS "Team members",
                     (SELECT COUNT(*) FROM tasks WHERE project_id = project.id
                       AND due_at < NOW()
                       AND LOWER(status) NOT IN ('done', 'complete', 'completed')) AS "Overdue tasks"
              FROM projects AS project
              LEFT JOIN users AS coordinator ON coordinator.id = project.coordinator_id
              WHERE ${projectScope}
              ORDER BY project.name
              LIMIT 100`;
      values = projectValues;
      break;
    case "achievements":
      text = `SELECT title AS "Achievement", description AS "Description",
                     awarded_at AS "Awarded"
              FROM achievements
              WHERE user_id = $1
              ORDER BY awarded_at DESC
              LIMIT 100`;
      values = [user.id];
      break;
    case "ideas":
      text = `SELECT title AS "Idea", status AS "Status",
                     created_at AS "Submitted"
              FROM approval_requests
              WHERE submitted_by = $1 AND LOWER(request_type) IN ('idea', 'suggestion')
              ORDER BY created_at DESC
              LIMIT 100`;
      values = [user.id];
      break;
    case "notifications":
      text = `SELECT title AS "Notification", body AS "Details",
                     read_at AS "Read", created_at AS "Received"
              FROM notifications
              WHERE user_id = $1
              ORDER BY created_at DESC
              LIMIT 100`;
      values = [user.id];
      break;
    case "profile":
      text = `SELECT full_name AS "Name", email AS "Email", role AS "Role",
                     is_active AS "Active account", created_at AS "Member since"
              FROM users WHERE id = $1`;
      values = [user.id];
      break;
    case "settings":
      text = `SELECT 'Account role' AS "Setting", role AS "Value"
              FROM users WHERE id = $1
              UNION ALL
              SELECT 'Session lifetime', '8 hours'
              UNION ALL
              SELECT 'Sign-in protection', 'Password-protected account'
              UNION ALL
              SELECT 'Preferences', 'No saved preferences yet'`;
      values = [user.id];
      break;
    default:
      return null;
  }

  const result = await query(text, values);
  if (section === "contributions") {
    const summary = await query(
      `SELECT COUNT(*)::int AS count,
              COALESCE(SUM(amount), 0) AS total,
              COUNT(DISTINCT member_id)::int AS contributors
       FROM financial_transactions
       WHERE transaction_type = 'income' AND member_id IS NOT NULL`,
    );
    return { rows: result.rows, stats: summary.rows[0] };
  }
  if (section === "finance_reports") {
    const categories = await query(
      `SELECT category AS "Category", transaction_type AS "Type", SUM(amount) AS "Total"
       FROM financial_transactions
       WHERE created_at >= DATE_TRUNC('month', NOW()) - INTERVAL '11 months'
       GROUP BY category, transaction_type
       ORDER BY SUM(amount) DESC
       LIMIT 20`,
    );
    return { rows: result.rows, categories: categories.rows };
  }
  if (section === "tasks" && user.role === "coordinator") {
    const milestones = await query(
      `SELECT milestone.id AS "Milestone ID", milestone.title AS "Milestone",
                     project.id AS "Project ID", project.name AS "Project",
                     project.department AS "Department", milestone.status AS "Status",
                     milestone.due_at AS "Due",
                     (milestone.due_at < CURRENT_DATE AND milestone.status <> 'completed') AS "Overdue"
              FROM project_milestones AS milestone
              JOIN projects AS project ON project.id = milestone.project_id
              WHERE ${projectScope}
              ORDER BY milestone.due_at ASC NULLS LAST, milestone.id DESC
              LIMIT 100`,
      projectValues,
    );
    return { rows: result.rows, milestones: milestones.rows };
  }
  return { rows: result.rows };
}
