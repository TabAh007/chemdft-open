#!/bin/bash
# Phase A3: initialise the existing Better Auth schema in Neon (first run only) and create ONE
# invitation-only account. Run it in YOUR terminal: the password is typed at a hidden prompt.
#
#   tools/create_invited_user.sh researcher@example.org "Researcher Name"
#
# Reads the private files in ~/.config/chemdft-web (direct Neon URL, Better Auth secret). Nothing is
# printed except the result. Neon Auth is NOT used; signup stays closed. The account is stored in the
# Better Auth tables of the chemdft_auth database; ChemDFT's own user rows are provisioned by the API
# on the person's first sign-in.
set -euo pipefail
email=${1:-}; name=${2:-}
[[ "$email" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ && -n "$name" ]] || {
  echo "usage: tools/create_invited_user.sh <email> \"<display name>\"" >&2; exit 2; }
dir="$HOME/.config/chemdft-web"
for f in neon-direct-url better-auth-secret; do
  [[ -f "$dir/$f" && ! -L "$dir/$f" && "$(stat -f '%Lp' "$dir/$f")" == 600 ]] || {
    echo "missing or unsafe: $dir/$f (must be a regular 0600 file)" >&2; exit 1; }
done
# A password already present in the environment is used as is (automation); otherwise prompt hidden.
if [[ -z "${CHEMDFT_NEW_USER_PASSWORD:-}" ]]; then
  read -rs -p "Password for $email (12+ characters, typed hidden): " CHEMDFT_NEW_USER_PASSWORD; echo
fi
(( ${#CHEMDFT_NEW_USER_PASSWORD} >= 12 )) || { echo "password too short" >&2; exit 1; }
export CHEMDFT_NEW_USER_PASSWORD
cd "$(dirname "$0")/../apps/web"
# node-postgres ignores/does not need libpq's channel_binding parameter; drop it, keep sslmode.
direct=$(python3 - "$dir/neon-direct-url" <<'PY'
import sys
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode
u = urlsplit(open(sys.argv[1]).read().strip())
q = [(k, v) for k, v in parse_qsl(u.query) if k != "channel_binding"]
sys.stdout.write(urlunsplit(u._replace(query=urlencode(q))))
PY
)
CHEMDFT_AUTH_MODE=jwt \
BETTER_AUTH_SECRET="$(cat "$dir/better-auth-secret")" \
BETTER_AUTH_URL="${BETTER_AUTH_URL:-https://chemdft.com}" \
CHEMDFT_AUTH_DATABASE_URL="$direct" \
  pnpm -s auth:create-user --email "$email" --name "$name" 2>&1 | grep -v "ExperimentalWarning\|trace-warnings\|SECURITY WARNING\|next major\|To prepare\|If you want\|See https\|^$"
unset CHEMDFT_NEW_USER_PASSWORD direct
