require("dotenv").config();

function intEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
function boolEnv(name, fallback = false) {
  const v = process.env[name];
  if (v == null || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}
function idsEnv(name) {
  return (process.env[name] || "").split(",").map(x => x.trim()).filter(Boolean);
}

module.exports = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.DISCORD_CLIENT_ID,
  guildId: process.env.DISCORD_GUILD_ID || "",
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  databaseUrl: process.env.DATABASE_URL || "",
  ownerIds: idsEnv("BOT_OWNER_IDS"),
  defaultLogChannelId: process.env.DEFAULT_LOG_CHANNEL_ID || "",
  defaultApplicationChannelId: process.env.DEFAULT_APPLICATION_CHANNEL_ID || "",
  defaultApplicationReviewChannelId: process.env.DEFAULT_APPLICATION_REVIEW_CHANNEL_ID || "",
  defaultModeratorRoleId: process.env.DEFAULT_MODERATOR_ROLE_ID || "",
  defaultTraineeRoleId: process.env.DEFAULT_TRAINEE_ROLE_ID || "",
  raidJoinThreshold: intEnv("RAID_JOIN_THRESHOLD", 8),
  raidWindowSeconds: intEnv("RAID_WINDOW_SECONDS", 10),
  raidLockdownMinutes: intEnv("RAID_LOCKDOWN_MINUTES", 5),
  antiSpamMaxMessages: intEnv("ANTISPAM_MAX_MESSAGES", 6),
  antiSpamWindowSeconds: intEnv("ANTISPAM_WINDOW_SECONDS", 5),
  antiSpamTimeoutSeconds: intEnv("ANTISPAM_TIMEOUT_SECONDS", 60),
  autoLockdown: boolEnv("AUTO_LOCKDOWN", false),
  aiMessageReview: boolEnv("AI_MESSAGE_REVIEW", false),
  aiIncidentAnalysis: boolEnv("AI_INCIDENT_ANALYSIS", true)
};
