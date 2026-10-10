#!/usr/bin/env bash
# deploy/publish.sh — the one command that publishes, when Ryan decides to.
# It refuses to run if preflight is red, and it never touches a credential itself: if a remote exists
# and git needs auth, it stops and tells you to finish the push yourself.
set -euo pipefail
cd "$(dirname "$0")/.."

bash deploy/preflight.sh || { echo; echo "Not publishing: preflight is red."; exit 1; }

echo
echo "Preflight green. Staging and committing."
git add -A
git commit -m "site: publish $(date '+%Y-%m-%d %H:%M')" || echo "(nothing new to commit)"

if git remote get-url origin >/dev/null 2>&1; then
  echo
  echo "Remote found: $(git remote get-url origin)"
  echo "Pushing. If this asks for a password, stop and run 'git push' yourself in Terminal —"
  echo "the token must never pass through the agent."
  git push || { echo; echo "Push failed (auth or CNAME rebase). Try: git pull --rebase origin main && git push"; exit 1; }
  echo
  echo "Pushed. GitHub Pages takes ~1 minute."
  echo "Verify:  curl -s -o /dev/null -w '%{http_code}\\n' https://$(git remote get-url origin | sed -E 's#.*[:/]([^/]+)/([^/.]+)(\\.git)?#\\1.github.io/\\2#')/"
else
  echo
  echo "No remote yet. Create it (in your own Terminal, so no token touches the agent):"
  echo "  gh repo create permaculture-ai-site --public --source=. --push"
  echo
  echo "Then set Pages: repo -> Settings -> Pages -> Deploy from a branch -> main / root."
  echo "Then follow deploy/README.md sections 2 and 3 for DNS and the tunnel."
fi
