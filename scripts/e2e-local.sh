#!/usr/bin/env bash
# Reset the local Supabase DB, bootstrap the admin, and run the browser tests against `next start` on :3000.
set -euo pipefail
cd "$(dirname "$0")/.."
npx supabase db reset >/dev/null
set -a; . ./.env.local; set +a
BOOTSTRAP_NAME=Kartik BOOTSTRAP_USERNAME=kartik BOOTSTRAP_PIN=111 node scripts/bootstrap-admin.mjs
npx playwright test "$@"
