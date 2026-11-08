# Backend

Set either `DATABASE_URL` or `DB_HOST`, `DB_NAME`, and `DB_USER` in `.env`.
`DB_PORT` defaults to `5432`, and `DB_PASSWORD` is optional for PostgreSQL
installations that do not require one. Set `DB_SSL=true` when the database
requires verified TLS. Also set a long random `JWT_SECRET` (at least 32
characters). On startup the server verifies that the required PostgreSQL tables
and columns exist and that the users role constraint is current, then runs
`sql/schema.sql` automatically when an update is needed. This refreshes the role
constraint on existing databases so member accounts can be created.
If the database already has tables from an earlier version, rerun
`sql/schema.sql` to apply the additive compatibility updates as well.

```sh
npm install
npm run dev
```

The server checks the PostgreSQL connection before listening. `GET /health`
returns a basic health response. Run the Vite frontend with `npm run dev` from
the repository root; its development proxy forwards `/api` requests to port
3000. Create the first administrator from a trusted terminal. Set `ADMIN_NAME`,
`ADMIN_EMAIL`, and `ADMIN_PASSWORD` in the environment, then run
`npm run create-admin` from `backend/`. Never put these credentials in source
control. Further privileged accounts can only be created by an authenticated
administrator; public membership enquiries do not create accounts or allow
users to choose privileged roles.

Authentication uses an HTTP-only session cookie. `POST /api/auth/login` verifies
the account and password, `GET /api/auth/me` restores the current session, and
`POST /api/auth/logout` clears it. `GET /api/dashboard` requires an active
session and returns role-specific summary data; financial totals are only
included for administrators and treasurers, project coordinators see projects
across departments, and members see projects and the member directory scoped to
their department.
Dashboard sidebar sections load their records from
`GET /api/dashboard/sections/:section`; the endpoint requires an active session
and checks that the signed-in role is allowed to view the requested section.
ChatHub uses authenticated conversation endpoints under `/api/messages`, and
account settings let users update their own name/email with `PUT /api/auth/me`
or change their password with `PUT /api/auth/password`. A profile photo can
also be uploaded or removed from My Profile (JPEG, PNG, or WebP, up to 512 KB);
the user's avatar uses a profile icon when no photo is set.
Users select their department in My Profile. The authenticated project workspace
at `/api/projects/workspace` scopes proposals and projects to that department.
Members can submit project proposals with an optional PDF or image attachment;
administrators and coordinators review proposals, and approval creates a
department project. Department teams can join projects, assign tasks, track
milestones, post updates, and share PDF/image files up to 5 MB.
ChatHub messages report delivery and read receipts per conversation member and
support recorded voice notes (up to 2 minutes and 5 MB); an audio-file attachment
is also available when browser microphone recording is unavailable. Senders can
edit text messages and delete their own text or voice messages; deleted messages
are replaced with a deletion notice for everyone in the conversation. Treasurers can review
member contributions, project budget utilization, and monthly financial reports
from their dashboard.
Members can share JPEG, PNG, WebP, MP4, or WebM stories (up to 8 MB, visible
for 24 hours) and MP4/WebM reels (up to 8 MB). Stories and reels are stored in
the application database and require an authenticated club account to view.
One-to-one voice and video calls use browser WebRTC with authenticated,
database-backed signaling. Calls require camera/microphone permission and a
secure browser context (HTTPS or localhost); the configured public STUN server
does not provide a TURN relay, so some restrictive networks may not connect.
Learning Resources are available to signed-in members through `/api/resources`;
administrators, secretaries, and coordinators can add shared HTTP(S) links.
Administrators can manage gallery content and the team directory from the
dashboard through `/api/admin/content` and `/api/admin/offices`. Published
gallery content is available at `/api/content`, and the team directory is
available at `/api/team`. Authenticated members can read announcements at
`/api/announcements`; only administrators can publish or delete them. Rerun
`sql/schema.sql` to create the content table and apply the team-directory
compatibility update.
Gallery image and video uploads use the administrator-only
`POST /api/admin/cloudinary-signature` endpoint. Set `CLOUDINARY_CLOUD_NAME`,
`CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` in the backend `.env` file
and restart the backend; the API secret must remain server-side.
Administrators can list user accounts through `GET /api/admin/users`; the
existing `GET /api/users` endpoint remains available for compatibility.
Administrators can view the management reports dashboard at
`GET /api/management/reports`. The management API also provides the dashboard
sections for projects, attendance, finance, events, and approvals. Coordinators
have no account department, can view projects across all departments in Project
Management, choose a department for each project they create, and can create
and update club events and competitions. Coordinators can also manage project
teams, assign and track tasks, maintain milestones, share project files and
updates, and review portfolio progress and project reports across departments.
After
updating the backend, restart it; startup applies the additive project
collaboration schema when the new tables are missing. Existing users should
choose their department in My Profile before submitting proposals or joining
department projects.

Public membership applications are submitted to `POST /api/applications`.
Applicants must verify control of their email from the 24-hour link before
their application can be reviewed. New applications appear in the administrator
dashboard under User Management; administrators can approve or decline verified
applications. Email verification and club notifications use SMTP settings from
the backend `.env` file. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`,
`SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`, and `FRONTEND_URL`.
`CLUB_APPLICATION_EMAIL_TO` defaults to `pkwizera93@gmail.com`. Until SMTP is
configured, applications are retained and appear in the admin portal, but no
email is sent. Never commit real SMTP credentials.
