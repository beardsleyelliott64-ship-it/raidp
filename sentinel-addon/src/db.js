const { Pool } = require("pg");
const config = require("./config");

let pool;

async function initDb() {
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required. Add a Railway PostgreSQL service and set DATABASE_URL.");
  }
  pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      log_channel_id TEXT,
      application_channel_id TEXT,
      review_channel_id TEXT,
      moderator_role_id TEXT,
      trainee_role_id TEXT,
      raid_threshold INTEGER,
      auto_lockdown BOOLEAN NOT NULL DEFAULT FALSE,
      applications_open BOOLEAN NOT NULL DEFAULT TRUE,
      lockdown_active BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS warnings (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      moderator_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS incidents (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      severity TEXT NOT NULL,
      summary TEXT NOT NULL,
      ai_analysis JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved BOOLEAN NOT NULL DEFAULT FALSE
    );
    CREATE TABLE IF NOT EXISTS applications (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      answers JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      reviewer_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS warnings_lookup_idx ON warnings(guild_id, user_id);
    CREATE INDEX IF NOT EXISTS applications_lookup_idx ON applications(guild_id, status);
    CREATE INDEX IF NOT EXISTS incidents_lookup_idx ON incidents(guild_id, created_at DESC);
  `);
  return pool;
}

function db() {
  if (!pool) throw new Error("Database not initialized");
  return pool;
}

async function getSettings(guildId) {
  const result = await db().query("SELECT * FROM guild_settings WHERE guild_id=$1", [guildId]);
  return result.rows[0] || null;
}

async function ensureSettings(guildId) {
  await db().query("INSERT INTO guild_settings (guild_id) VALUES ($1) ON CONFLICT (guild_id) DO NOTHING", [guildId]);
  return getSettings(guildId);
}

module.exports = { initDb, db, getSettings, ensureSettings };
