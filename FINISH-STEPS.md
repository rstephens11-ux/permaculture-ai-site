# What's left, and whose job it is

Everything below is real and checked, not asserted. Where something is still broken it says so.

## Done — check it, don't take my word

- **106 crops**, each with a sourced row and a sprite. Every sprite was fetched over HTTP from the live
  site and byte-compared, not assumed to have deployed.
- **The plan engine**: staples-ranked selection (garlic leads, then what fills a plate), one crop per
  botanical family, a shared bed divided **proportionally** so the glut crop gets the room, one running
  number per crop run that the drawing, the bed list and the steps all read from, nine phases, and the
  permanent plantings in their own section with the year-one rule.
- **Both drawings**: the beds-mode overlay over your own photo (beds found, filled, planted, numbered) and
  the to-scale layout. The home-page sample is now the real beds-mode output, at 332 KB instead of 4.8 MB.
- **78 tests**, `deploy/preflight.sh` **GREEN**, `BLOCKERS.md` rewritten — the drawing problem is closed
  with the two measurements that closed it.

## Your steps, in order

### 1. Decide where the tool lives (this is the only thing blocking a real visitor)

The site is published; the tool runs on this Mac. `apiBase` is empty, so a real "Plan my yard" on the
published domain fails today. Pick one:

- **Tailscale Funnel — recommended, and the fewest moving parts.** Tailscale is already installed and
  logged in on this Mac (`ryans-macbook-pro-2`, `100.65.77.13`); there's no funnel config yet. You enable
  it in the admin console (DNS → HTTPS certificates, then allow Funnel in the ACLs), say the word, and I
  run `tailscale funnel 8099`. You get `https://ryans-macbook-pro-2.<your-tailnet>.ts.net`.
- **Cloudflare Tunnel.** Needs `cloudflared` installed and a browser login, and if you want
  `api.permacultureai.com` rather than a `.ts.net` name, the domain's nameservers have to move to
  Cloudflare — which changes the DNS story in step 2.
- **Host the API somewhere always-on.** The honest fix if this ever has real traffic. Real cost, no Mac
  awake requirement.

Once it exists I set `apiBase` in `assets/js/config.js` and re-verify from the public site myself.

### 2. NameSilo DNS, for the site itself

- `A` records for `@` (and for the `www` if you want it) → `185.199.108.153`, `185.199.109.153`,
  `185.199.110.153`, `185.199.111.153`
- `CNAME` for `www` → `rstephens11-ux.github.io`
- **DNS-only (grey cloud).** A proxied record plus Pages' HTTPS-everywhere produces a redirect loop. This
  is the one that bites.
- Then tell me and I add the `CNAME` file to the repo; you tick **Enforce HTTPS** in repo Settings → Pages.

### 3. Buttondown

Create the account, generate an API key, and put it in the environment as `BUTTONDOWN_API_KEY` — **not in
chat.** Then I wire the gate, and the email the site asks for can actually be sent. Until then the list is
inert and says so on `/privacy.html`.

### 4. Optional: make the tool survive a restart

`deploy/README.md` §4 has the LaunchAgent recipe (`~/Library/LaunchAgents/com.ryan.permaculture-ai.plist`,
`RunAtLoad` + `KeepAlive`). One command, I can run it with your ok. Without it the server dies on restart
and the free tool goes quiet while still looking alive.

### 5. Two decisions parked

- **106 crops or 100.** I'd keep 106 — the extra six are real Maine-possible crops and the table is the
  variety you asked for. Trimming is trivial either way.
- **Bed sharing** — answered in code, not in prose: shares are proportional, tomato gets a 1.8× share
  (5 ft and 2–3 plants in a two-bed garden, up from 4 ft and 2). Say if you'd rather it took a whole bed.

## To finish: one line from you

**"funnel"** (after enabling it) or **"cloudflare"** — and I can do the rest without you.

---

## Known limits, stated rather than buried

- The photo has to travel to this Mac for the beds to be found. Read in memory, never written to disk,
  never to a cloud service — nothing stronger is claimed, and `/privacy.html` says exactly that.
- The queue is in memory: a restart drops in-flight jobs. The page tells people to resend.
- The zip→frost table covers the Northeast on purpose; everywhere else is told to confirm its own dates
  rather than handed a made-up one. Hawaii and Puerto Rico resolve to "too far to be your weather".
- Days-to-maturity are catalog ranges, labelled as estimates in every row.
