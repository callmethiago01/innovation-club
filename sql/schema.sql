CREATE TABLE IF NOT EXISTS users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  profile_image TEXT,
  role TEXT NOT NULL DEFAULT 'member'
    CHECK (role IN ('admin', 'treasurer', 'secretary', 'coordinator', 'member')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS department TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
UPDATE users
SET department = ''
WHERE role IN ('admin', 'treasurer', 'secretary', 'coordinator')
  AND department IS DISTINCT FROM '';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'treasurer', 'secretary', 'coordinator', 'member')) NOT VALID;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (LOWER(email));

CREATE TABLE IF NOT EXISTS projects (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planning',
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  budget NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (budget >= 0),
  coordinator_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS budget NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (budget >= 0),
  ADD COLUMN IF NOT EXISTS coordinator_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS department TEXT NOT NULL DEFAULT '';

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'projects'
      AND column_name = 'title'
  ) THEN
    EXECUTE 'UPDATE projects SET name = title WHERE name IS NULL OR name = $1' USING '';
  END IF;
END
$migration$;

UPDATE projects SET name = '' WHERE name IS NULL;
ALTER TABLE projects ALTER COLUMN name SET DEFAULT '';
ALTER TABLE projects ALTER COLUMN name SET NOT NULL;
UPDATE projects SET updated_at = created_at WHERE updated_at IS NULL;
ALTER TABLE projects ALTER COLUMN updated_at SET DEFAULT NOW();
ALTER TABLE projects ALTER COLUMN updated_at SET NOT NULL;

CREATE TABLE IF NOT EXISTS project_members (
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  assigned_to BIGINT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'todo',
  due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_proposals (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  department TEXT NOT NULL,
  submitted_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  review_note TEXT NOT NULL DEFAULT '',
  reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  project_id BIGINT REFERENCES projects(id) ON DELETE SET NULL,
  attachment_name TEXT,
  attachment_mime TEXT,
  attachment_data TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS project_proposals_department_status_idx
  ON project_proposals (department, status, created_at DESC);

CREATE TABLE IF NOT EXISTS project_comments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS project_comments_project_idx
  ON project_comments (project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS project_milestones (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  due_at DATE,
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'in_progress', 'completed')),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_files (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  uploaded_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_data TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS project_files_project_idx
  ON project_files (project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  starts_at TIMESTAMPTZ NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'Meeting',
  status TEXT NOT NULL DEFAULT 'scheduled',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'Meeting',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'scheduled';

CREATE TABLE IF NOT EXISTS meetings (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  minutes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS attendance (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  meeting_id BIGINT REFERENCES meetings(id) ON DELETE CASCADE,
  event_id BIGINT REFERENCES events(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'present',
  note TEXT NOT NULL DEFAULT '',
  recorded_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (meeting_id, user_id)
);

ALTER TABLE attendance
  ALTER COLUMN meeting_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS event_id BIGINT REFERENCES events(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS attendance_event_user_idx
  ON attendance (event_id, user_id)
  WHERE event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS financial_transactions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('income', 'expense')),
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  category TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  project_id BIGINT REFERENCES projects(id) ON DELETE SET NULL,
  member_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  entered_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS announcements (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  published_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS club_news (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Club news',
  image_data TEXT,
  video_url TEXT,
  published_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gallery_items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'Club life',
  image_data TEXT NOT NULL,
  uploaded_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS club_leadership (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  full_name TEXT NOT NULL,
  position TEXT NOT NULL,
  department TEXT NOT NULL DEFAULT 'Club officers',
  directory_group TEXT NOT NULL DEFAULT 'officer'
    CHECK (directory_group IN ('officer', 'department')),
  description TEXT NOT NULL DEFAULT '',
  image_data TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE club_leadership
  ADD COLUMN IF NOT EXISTS directory_group TEXT NOT NULL DEFAULT 'officer'
    CHECK (directory_group IN ('officer', 'department'));

CREATE TABLE IF NOT EXISTS club_content (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('image', 'video', 'text')),
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  media_url TEXT,
  published_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (type = 'text' AND media_url IS NULL) OR
    (type IN ('image', 'video') AND media_url IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS achievements (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  awarded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS approval_requests (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  review_note TEXT NOT NULL DEFAULT '',
  submitted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE approval_requests
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS review_note TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS resources (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  uploaded_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'voice_note')),
  media_mime TEXT,
  media_data TEXT,
  media_duration INTEGER,
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS media_mime TEXT,
  ADD COLUMN IF NOT EXISTS media_data TEXT,
  ADD COLUMN IF NOT EXISTS media_duration INTEGER,
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS message_receipts (
  message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  PRIMARY KEY (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS message_receipts_user_idx
  ON message_receipts (user_id, delivered_at, read_at);

CREATE TABLE IF NOT EXISTS chat_media (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL CHECK (media_type IN ('story', 'reel')),
  mime_type TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  media_data TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS chat_media_active_idx
  ON chat_media (media_type, created_at DESC);

CREATE TABLE IF NOT EXISTS calls (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  caller_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  call_type TEXT NOT NULL CHECK (call_type IN ('audio', 'video')),
  status TEXT NOT NULL DEFAULT 'ringing'
    CHECK (status IN ('ringing', 'active', 'declined', 'ended', 'missed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS calls_participants_idx
  ON calls (caller_id, recipient_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS call_signals (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  call_id BIGINT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  sender_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  signal_type TEXT NOT NULL CHECK (signal_type IN ('offer', 'answer', 'ice-candidate')),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS call_signals_recipient_idx
  ON call_signals (call_id, recipient_id, id);

CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS membership_applications (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  trade TEXT NOT NULL,
  learning_level TEXT NOT NULL,
  department TEXT NOT NULL,
  motivation TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_verification'
    CHECK (status IN ('pending_verification', 'pending', 'approved', 'rejected')),
  verification_token_hash TEXT NOT NULL,
  verification_expires_at TIMESTAMPTZ NOT NULL,
  email_verified_at TIMESTAMPTZ,
  reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS membership_applications_status_idx
  ON membership_applications (status, created_at DESC);
CREATE INDEX IF NOT EXISTS membership_applications_email_idx
  ON membership_applications (LOWER(email), created_at DESC);

ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (LOWER(email));
