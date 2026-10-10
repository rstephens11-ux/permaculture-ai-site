#!/usr/bin/env bash
# deploy/preflight.sh — everything that must be true before this goes anywhere near the public.
# Exits non-zero on the first real problem. Read-only: it starts the server, checks it, stops it.
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
FAIL=0
say()  { printf '%s\n' "$*"; }
ok()   { printf '  ok    %s\n' "$*"; }
bad()  { printf '  FAIL  %s\n' "$*"; FAIL=1; }

say "permaculture-ai preflight — $ROOT"
say ""

say "1. tests"
if node --test tests/*.mjs >/tmp/pa-tests.log 2>&1; then
  ok "$(grep -E '^# pass|^ℹ pass' /tmp/pa-tests.log | tail -1) "
else
  bad "tests failed — see /tmp/pa-tests.log"
fi

say "2. pages present, no untouched placeholders"
for f in index.html plan.html product.html thanks.html terms.html privacy.html 404.html; do
  if [ -f "$f" ]; then ok "$f"; else bad "$f missing"; fi
done
if grep -rnE '\{\{[A-Z_]+\}\}|SITE_NAME|DEPLOY_HOST|TODO' ./*.html assets/js/*.js 2>/dev/null | grep -v 'data-.*placeholder'; then
  bad "unresolved placeholder tokens above"
else
  ok "no unresolved tokens in the pages"
fi

say "3. no secrets in tracked files"
LEAK=$(git grep -nIE '(sk-[A-Za-z0-9]{16,}|api[_-]?key\s*[:=]\s*["'\''][^"'\'']{12,}|AKIA[0-9A-Z]{12,}|ghp_[A-Za-z0-9]{20,})' -- . ':!*.example' 2>/dev/null)
if [ -n "$LEAK" ]; then bad "possible secret in: $LEAK"; else ok "nothing that looks like a key"; fi

say "4. leads.csv is not tracked"
if git check-ignore -q leads.csv 2>/dev/null; then ok "leads.csv is ignored"; else bad "leads.csv is NOT gitignored"; fi

say "5. the server answers (ENGINE=mock, localhost only)"
ENGINE=mock PORT=8098 LEAD_STORE=/tmp/pa-preflight-leads.csv node server/dev.mjs >/tmp/pa-server.log 2>&1 &
PID=$!
for i in $(seq 1 20); do
  sleep 0.25
  H=$(curl -s -m 2 http://127.0.0.1:8098/api/health || true)
  [ -n "$H" ] && break
done
if printf '%s' "${H:-}" | grep -q '"ok":true'; then
  ok "health: $(printf '%s' "$H" | head -c 140)"
else
  bad "no health response — see /tmp/pa-server.log"
fi
CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 3 http://127.0.0.1:8098/)
[ "$CODE" = "200" ] && ok "index.html serves" || bad "index.html returned $CODE"
kill $PID 2>/dev/null; wait $PID 2>/dev/null

say "6. forge reachable (informational — the tool still works when it is, and says so when it isn't)"
curl -s -m 4 "${FORGE_BASE_URL:-http://forge:8188}/system_stats" >/dev/null 2>&1 \
  && ok "forge:8188 answering" \
  || say "  note  forge:8188 not answering from here (fine if you're off the LAN)"

say ""
if [ "$FAIL" -eq 0 ]; then say "PREFLIGHT GREEN — safe to publish."; else say "PREFLIGHT RED — fix the FAILs above."; fi
exit $FAIL
