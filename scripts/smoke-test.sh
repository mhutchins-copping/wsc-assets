#!/usr/bin/env bash
# Hits the deployed worker's public-facing surface and confirms it's alive.
# Runs in CI after a deploy; exits non-zero if anything looks wrong.
#
# We have no SSO cookie and no API key here, so protected routes should
# return 401. The goal isn't to test business logic — it's to catch:
#   - 5xx errors (deploy broke something)
#   - network failures (worker not reachable)
#   - unexpected changes to the auth surface

set -uo pipefail

API="${API_URL:-https://api.it-wsc.com}"
FAIL=0

# Accepts a list of acceptable status codes. Passes if the response matches
# any of them; fails if it's 5xx, 000 (network error), or unlisted.
check() {
  local name="$1" path="$2"; shift 2
  local accept=("$@")
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$API$path" || echo "000")

  for want in "${accept[@]}"; do
    if [[ "$code" == "$want" ]]; then
      printf '  ok   %-28s  %s → %s\n' "$name" "$path" "$code"
      return
    fi
  done

  printf '  FAIL %-28s  %s → %s (expected: %s)\n' "$name" "$path" "$code" "${accept[*]}"
  FAIL=$((FAIL + 1))
}

echo "Smoke test: $API"
echo

# Root: anything non-5xx is fine; worker is responding
check "root"                  "/"                         "200" "404" "401"

# Health: the same endpoint the GH Actions cron pings every 5 min.
# Should return 200 (D1 reachable) or 503 (D1 down). 503 here would
# fail the deploy AND the health-check workflow on the next run -
# better to fail noisily here than discover it 5 min later.
check "health"                "/api/health"               "200"

# Protected routes: auth rejects us cleanly (not a 500)
check "assets list"           "/api/assets"               "401"
check "stats"                 "/api/stats"                "401"
check "reports"               "/api/reports"              "401"
check "people"                "/api/people"               "401"
check "categories"            "/api/categories"           "401"
check "audits"                "/api/audits"               "401"

# Images surface: GET on a bogus key should 404 (R2 miss), not 500
check "image miss"            "/images/nonexistent/x.jpg" "404"

echo
if [[ "$FAIL" -gt 0 ]]; then
  echo "FAILED: $FAIL check(s) did not pass"
  exit 1
fi
echo "PASSED: all checks green"
