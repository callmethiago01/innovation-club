import "dotenv/config";
import express from "express";
import { closeDatabase, connectDatabase } from "./db.js";
import adminRoutes from "./routes/admin.routes.js";
import applicationRoutes from "./routes/applications.routes.js";
import adminApplicationRoutes from "./routes/admin-applications.routes.js";
import announcementsRoutes from "./routes/announcements.routes.js";
import attendanceRoutes from "./routes/attendance.routes.js";
import authRoutes from "./routes/auth.routes.js";
import contentRoutes from "./routes/content.routes.js";
import dashboardRoutes from "./routes/dashboard.routes.js";
import financeRoutes from "./routes/finance.routes.js";
import managementRoutes from "./routes/management.routes.js";
import messagesRoutes from "./routes/messages.routes.js";
import projectsRoutes from "./routes/projects.routes.js";
import resourcesRoutes from "./routes/resources.routes.js";
import tasksRoutes from "./routes/tasks.routes.js";
import teamRoutes from "./routes/team.routes.js";
import usersRoutes from "./routes/users.routes.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(express.json({ limit: "12mb" }));

app.get("/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.use("/api/auth", authRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/content", contentRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin/users", usersRoutes);
app.use("/api/admin/applications", adminApplicationRoutes);
app.use("/api/applications", applicationRoutes);
app.use("/api/projects", projectsRoutes);
app.use("/api/resources", resourcesRoutes);
app.use("/api/tasks", tasksRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/finance", financeRoutes);
app.use("/api/management", managementRoutes);
app.use("/api/messages", messagesRoutes);
app.use("/api/announcements", announcementsRoutes);
app.use("/api/team", teamRoutes);
app.use("/api/users", usersRoutes);

app.use((error, _request, response, _next) => {
  void _next;
  if (error.type === "entity.too.large") {
    response.status(413).json({ error: "The upload is too large. Keep voice messages at 5 MB or less." });
    return;
  }
  console.error("API request failed:", error);
  response.status(500).json({ error: "An unexpected server error occurred." });
});

async function startServer() {
  await connectDatabase();

  const server = app.listen(port, () => {
    console.log(`Backend listening on port ${port}`);
  });

  const shutdown = () => {
    server.close(async (error) => {
      try {
        await closeDatabase();
      } catch (databaseError) {
        console.error("Failed to close the database pool:", databaseError);
        process.exitCode = 1;
      }

      if (error) {
        console.error("Failed to stop the HTTP server:", error);
        process.exitCode = 1;
      }
    });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

startServer().catch((error) => {
  console.error("Failed to start the backend:", error);
  process.exitCode = 1;
});
