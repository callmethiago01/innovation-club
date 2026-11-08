import { getDashboard } from "../services/dashboard.service.js";
import {
  canViewDashboardSection,
  getDashboardSection,
} from "../services/dashboard-section.service.js";

export async function dashboard(request, response, next) {
  try {
    response.json(await getDashboard(request.user));
  } catch (error) {
    next(error);
  }
}

export async function dashboardSection(request, response, next) {
  const { section } = request.params;

  if (!canViewDashboardSection(section, request.user.role)) {
    response.status(403).json({ error: "You do not have permission to view this section." });
    return;
  }

  try {
    response.json(await getDashboardSection(section, request.user));
  } catch (error) {
    next(error);
  }
}