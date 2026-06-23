-- Channels owned per-user
CREATE TABLE IF NOT EXISTS channels (
  id SERIAL PRIMARY KEY,
  name VARCHAR(64) UNIQUE NOT NULL,
  owner_email VARCHAR(255),
  status VARCHAR(20) DEFAULT 'disconnected',
  auto_mod BOOLEAN DEFAULT true,
  mem_window_seconds INTEGER DEFAULT 120,
  detect_threshold INTEGER DEFAULT 70,
  auto_mute_threshold INTEGER DEFAULT 90,
  trigger_after_n INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_profiles (
  id SERIAL PRIMARY KEY,
  username VARCHAR(64) NOT NULL,
  channel_name VARCHAR(64) NOT NULL,
  spam_score INTEGER DEFAULT 0,
  message_count INTEGER DEFAULT 0,
  flagged_count INTEGER DEFAULT 0,
  mute_count INTEGER DEFAULT 0,
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(username, channel_name)
);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  channel_name VARCHAR(64) NOT NULL,
  username VARCHAR(64) NOT NULL,
  message TEXT NOT NULL,
  spam_score INTEGER DEFAULT 0,
  reasons TEXT[],
  role VARCHAR(20) DEFAULT 'Viewer',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS moderation_logs (
  id SERIAL PRIMARY KEY,
  channel_name VARCHAR(64) NOT NULL,
  username VARCHAR(64) NOT NULL,
  message TEXT,
  spam_score INTEGER DEFAULT 0,
  reasons TEXT[],
  action VARCHAR(20) NOT NULL,
  duration_seconds INTEGER,
  performed_by VARCHAR(64),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  id SERIAL PRIMARY KEY,
  key VARCHAR(64) UNIQUE NOT NULL,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auth tables
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  picture TEXT,
  google_id VARCHAR(64),
  role VARCHAR(16) NOT NULL DEFAULT 'user',
  enabled BOOLEAN NOT NULL DEFAULT true,
  twitch_username VARCHAR(64),
  twitch_oauth TEXT,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS whitelist (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  added_by VARCHAR(255),
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  token VARCHAR(128) PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

INSERT INTO settings (key, value) VALUES
  ('detect_threshold', '70'),
  ('auto_mute_threshold', '90'),
  ('similarity_threshold', '75'),
  ('burst_limit', '6'),
  ('mem_window_seconds', '120'),
  ('link_detection', 'true'),
  ('auto_mode', 'true'),
  ('default_mute_duration', '60'),
  ('mute_reason', ''),
  ('ignored_roles', '[]')
ON CONFLICT (key) DO NOTHING;

-- Bootstrap: first admin email is configured via env. Add a row only if env-based bootstrap is used.
-- The backend will insert ADMIN_EMAIL on startup automatically into whitelist + users table as admin.

CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_name);
CREATE INDEX IF NOT EXISTS idx_messages_username ON messages(username);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_logs_channel ON moderation_logs(channel_name);
CREATE INDEX IF NOT EXISTS idx_logs_created ON moderation_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_channels_owner ON channels(owner_email);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- Per-channel whitelist of phrases not to flag as spam
CREATE TABLE IF NOT EXISTS channel_whitelist (
  id SERIAL PRIMARY KEY,
  channel_name VARCHAR(64) NOT NULL,
  phrase TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(channel_name, phrase)
);
CREATE INDEX IF NOT EXISTS idx_whitelist_channel ON channel_whitelist(channel_name);

-- Cache of Twitch user metadata (for bot profiling)
CREATE TABLE IF NOT EXISTS twitch_user_meta (
  username VARCHAR(64) PRIMARY KEY,
  twitch_id VARCHAR(32),
  display_name VARCHAR(64),
  profile_image_url TEXT,
  account_created_at TIMESTAMPTZ,
  description TEXT,
  fetched_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_twitch_meta_created ON twitch_user_meta(account_created_at);
