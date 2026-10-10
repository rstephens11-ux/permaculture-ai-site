# Publishing this site

Nothing here has been deployed. Everything below is a step Ryan runs — the agent that built this did
**not** push, buy, register or publish anything.

The site is two pieces, and they publish differently:

| Piece | Where it lives | Why |
|---|---|---|
| The pages (`*.html`, `assets/`) | **GitHub Pages** — the same way `personal-site` works | static files, no server needed |
| The tool (`/api/*`) | **this Mac**, reached through the existing Cloudflare tunnel | it needs the GPU, which is in the workshop |

## 1. Push the site

```bash
cd ~/permaculture-ai-site
bash deploy/preflight.sh          # must be green before you publish
```

Then, in your own Terminal (so no token ever goes through chat):

```bash
git init -b main && git add -A && git commit -m "Permaculture AI site"
gh repo create permaculture-ai-site --public --source=. --push
```

⚠️ **Name it `permaculture-ai-site`.** GitHub repo names are case-insensitive, and
`rstephens11-ux/Permaculture-AI` already exists (the old AI Studio sketch).

Then: repo → **Settings → Pages → Deploy from a branch → main / root**. Live at
`https://rstephens11-ux.github.io/permaculture-ai-site/` in about a minute. Verify:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://rstephens11-ux.github.io/permaculture-ai-site/
```

## 2. Custom domain

Same recipe as `personal-site` (NameSilo + GitHub Pages), and the same trap:

- Four `A` records to GitHub Pages' IPs and a `www` `CNAME`, **all DNS-only (grey cloud)** if the
  nameservers are on Cloudflare. A **proxied** record plus Pages' HTTPS-everywhere behaviour produces a
  redirect loop and the site stops loading. This exact failure is documented in the deploy skill.
- After you set the custom domain in Pages, GitHub commits a `CNAME` file to the repo, so your next
  local push is rejected with `fetch first`. Fix: `git pull --rebase origin main`, then push.

Candidate names (check availability before committing to one): `permacultureai.com`,
`smartpermaculture.com`, `thepreservationrun.com`.

## 3. Put the tool on the internet

The pages are static, so the tool needs an address of its own. Two working shapes:

**A. Tunnel hostname (recommended for a soft launch)**
The Mac already runs the site on `127.0.0.1:8099`. Add a hostname to the existing Cloudflare tunnel:

```
api.<your-domain>  ->  http://127.0.0.1:8099
```

Then set `DEPLOY_HOST` in `.env` and rebuild nothing — the site's JS calls `/api/...` on its own origin,
so if you serve the pages from the same hostname you don't need this at all; if you keep Pages for the
pages, add a one-line reverse proxy rule or point the JS at `api.` explicitly.

**B. Serve everything from the Mac** (simplest of all)
`node server/dev.mjs` already serves the pages *and* the API on one port, so one tunnel hostname to
`:8099` gives you the whole product with no Pages involvement. Downside: a home connection serving
pages, and the site is only up while the Mac is up.

## 4. What must be running

| Requirement | Why | Already handled? |
|---|---|---|
| The Mac awake | it serves the tool | yes — `com.ryan.forgelab-keepawake` (`caffeinate -s`, AC only) |
| forge awake and reachable as `forge:8188` | it draws the plans | yes — WoL armed, ComfyUI under systemd |
| `node server/dev.mjs` running | the API and pages | **no — this is the one thing to keep alive** (see below) |

Keep the server up on boot with a LaunchAgent:

```bash
# write ~/Library/LaunchAgents/com.ryan.permaculture-ai.plist with:
#   ProgramArguments: /Users/ryansmacbookpro/.hermes/tools/node-26.7.0-darwin-arm64/bin/node
#                    /Users/ryansmacbookpro/permaculture-ai-site/server/dev.mjs
#   RunAtLoad: true, KeepAlive: true, WorkingDirectory: /Users/ryansmacbookpro/permaculture-ai-site
launchctl load ~/Library/LaunchAgents/com.ryan.permaculture-ai.plist
```

Then check from the outside: `curl -s https://api.<your-domain>/api/health`.

## 5. Before you tell anyone

- [ ] `node --test tests/*.mjs` is green
- [ ] `bash deploy/preflight.sh` is green
- [ ] the tool answers through the tunnel from a phone on cellular, not just on the LAN
- [ ] caps are set the way you want (`PER_IP_PER_DAY`, `GLOBAL_DAILY_CAP`, `QUEUE_MAX`)
- [ ] you've read `content/site-copy.md` and it sounds like you
- [ ] decide about the email list: right now nothing sends mail. One Buttondown signup fixes that.
- [ ] `leads.csv` is genuinely gitignored (`git check-ignore leads.csv` should print it)
