import os
import json
from dotenv import load_dotenv

load_dotenv()

BOT_TOKEN        = os.getenv("BOT_TOKEN")
GEMINI_KEY       = os.getenv("GEMINI_KEY")
GUILD_ID         = int(os.getenv("GUILD_ID", 0))

PANEL_CHANNEL_ID  = int(os.getenv("PANEL_CHANNEL_ID",  0))
FREE_CHANNEL_ID   = int(os.getenv("FREE_CHANNEL_ID",   0))
LOG_CHANNEL_ID    = int(os.getenv("LOG_CHANNEL_ID",    0))
VERIFY_CHANNEL_ID = int(os.getenv("VERIFY_CHANNEL_ID", 0))

# SQLite path — on Render paid with disk mounted at /data, set DB_PATH=/data/senai.db
DB_PATH = os.getenv("DB_PATH", "senai.db")

# Load Gemini model fallback chain
_model_file = os.path.join(os.path.dirname(__file__), "aiModelsRanking.json")
with open(_model_file) as _f:
    GEMINI_MODELS: list[str] = json.load(_f)

# Colours
BLUE  = 0x2563eb
GREY  = 0x2b2d31
GREEN = 0x22c55e
RED   = 0xef4444
GOLD  = 0xf59e0b

# Platforms
PLATFORMS = {
    "Sparx Maths":   "sparx_maths",
    "Sparx Science":  "sparx_science",
    "Sparx Reader":   "sparx_reader",
    "Seneca":         "seneca",
    "Educake":        "educake",
    "Bedrock":        "bedrock",
    "LanguageNut":    "languagenut",
    "Tassomai":       "tassomai",
    "Century Tech":   "century",
    "Kerboodle":      "kerboodle",
    "GCSEPod":        "gcse_pod",
    "Dr Frost":       "dr_frost",
    "Isaac Physics":  "isaac",
}

FREE_DAILY_LIMIT = 3
PREM_DAILY_LIMIT = 9999
