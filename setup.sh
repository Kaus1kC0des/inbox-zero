#!/bin/bash
set -e

ENV_FILE="apps/web/.env"

GREEN="\033[0;32m"
YELLOW="\033[1;33m"
CYAN="\033[0;36m"
BOLD="\033[1m"
RESET="\033[0m"

echo -e "${BOLD}${CYAN}"
echo "  ╔══════════════════════════════════════╗"
echo "  ║   QikOffice Email Service — Setup   ║"
echo "  ╚══════════════════════════════════════╝"
echo -e "${RESET}"

# ─── Helper: prompt with optional default ────────────────────────────────────
prompt() {
  local var="$1"
  local label="$2"
  local default="$3"
  local secret="$4"

  if [ -n "$default" ]; then
    printf "  ${CYAN}%s${RESET} [%s]: " "$label" "$default"
  else
    printf "  ${CYAN}%s${RESET}: " "$label"
  fi

  if [ "$secret" = "true" ]; then
    IFS= read -rs value
    echo
  else
    IFS= read -r value
  fi

  if [ -z "$value" ] && [ -n "$default" ]; then
    value="$default"
  fi

  eval "$var=\"\$value\""
}

# ─── Helper: prompt only if key not already in .env ─────────────────────────
prompt_if_missing() {
  local key="$1"
  local label="$2"
  local default="$3"
  local secret="$4"

  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    return
  fi

  local value
  prompt value "$label" "$default" "$secret"
  echo "${key}=${value}" >> "$ENV_FILE"
}

# ─── Create .env if not exists ───────────────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
  echo -e "${YELLOW}Creating ${ENV_FILE}...${RESET}"
  touch "$ENV_FILE"
fi

echo
echo -e "${BOLD}── Required Settings ──────────────────────────────────${RESET}"

prompt_if_missing "NEXT_PUBLIC_BASE_URL"  "Service URL (e.g. http://localhost:4949)"  "http://localhost:4949"
prompt_if_missing "WEB_PORT"              "Port"                                       "4949"
prompt_if_missing "DATABASE_URL"          "MySQL DATABASE_URL"                         "mysql://root:root@127.0.0.1:3306/qikdb"

echo
echo -e "${BOLD}── Google OAuth ────────────────────────────────────────${RESET}"
prompt_if_missing "GOOGLE_CLIENT_ID"     "Google Client ID"     "" ""
prompt_if_missing "GOOGLE_CLIENT_SECRET" "Google Client Secret" "" "true"

echo
echo -e "${BOLD}── Redis (Upstash) ─────────────────────────────────────${RESET}"
prompt_if_missing "UPSTASH_REDIS_URL"   "Upstash Redis URL"   "" ""
prompt_if_missing "UPSTASH_REDIS_TOKEN" "Upstash Redis Token" "" "true"
prompt_if_missing "REDIS_URL"           "Redis URL (redis://...)" "" ""

echo
echo -e "${BOLD}── Outlook / Microsoft OAuth (optional, press Enter to skip) ──${RESET}"
prompt_if_missing "MICROSOFT_CLIENT_ID"            "Microsoft Client ID"            "" ""
prompt_if_missing "MICROSOFT_CLIENT_SECRET"        "Microsoft Client Secret"        "" "true"
prompt_if_missing "MICROSOFT_TENANT_ID"            "Microsoft Tenant ID"            "common" ""
prompt_if_missing "MICROSOFT_WEBHOOK_CLIENT_STATE" "Microsoft Webhook Client State" "" "true"

echo
echo -e "${BOLD}── Security Secrets ────────────────────────────────────${RESET}"

gen_secret() {
  local key="$1"
  local label="$2"
  local len="${3:-64}"
  if ! grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    if command -v openssl &>/dev/null; then
      local val
      val=$(openssl rand -hex "$len")
      echo "${key}=${val}" >> "$ENV_FILE"
      echo -e "  ${GREEN}✔ ${label} auto-generated${RESET}"
    else
      prompt_if_missing "$key" "$label" "" "true"
    fi
  else
    echo -e "  ${GREEN}✔ ${label} already set${RESET}"
  fi
}

gen_secret "AUTH_SECRET"          "AUTH_SECRET"          32
gen_secret "EMAIL_ENCRYPT_SECRET" "EMAIL_ENCRYPT_SECRET" 32
gen_secret "EMAIL_ENCRYPT_SALT"   "EMAIL_ENCRYPT_SALT"   16
gen_secret "INTERNAL_API_KEY"     "INTERNAL_API_KEY"     32
gen_secret "API_KEY_SALT"         "API_KEY_SALT"         32
gen_secret "CRON_SECRET"          "CRON_SECRET"          32

echo
echo -e "${BOLD}── AI / LLM (optional) ─────────────────────────────────${RESET}"
prompt_if_missing "LLM_API_KEY"          "OpenAI API Key"   "" "true"
prompt_if_missing "DEFAULT_LLM_PROVIDER" "LLM Provider"     "openai" ""
prompt_if_missing "DEFAULT_LLM_MODEL"    "LLM Model"        "gpt-4o-mini" ""

echo
echo -e "${BOLD}── Installing dependencies ─────────────────────────────${RESET}"
pnpm install

echo
echo -e "${BOLD}── Generating Prisma client ────────────────────────────${RESET}"
cd apps/web
npx prisma generate --schema=prisma/schema.prisma
cd ../..

echo
echo -e "${GREEN}${BOLD}✔ Setup complete!${RESET}"
echo
echo -e "  Start the service with:  ${CYAN}cd apps/web && pnpm dev${RESET}"
echo
