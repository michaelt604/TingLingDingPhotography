# TingLingDing Photography

Personal photography site for **TingLingDing** — a split-screen home with two
distinct sides and an Instagram feed on each. Built with **Next.js 15**,
exported as a fully static site, and deployed to **Cloudflare Pages**.

---

## Quick facts

| | |
|---|---|
| Domain | `tinglingdingphotography.com` |
| Stack | Next.js 15 · React 19 · TypeScript · CSS Modules |
| Output | Static export (`output: 'export'` in `next.config.mjs`) |
| Hosting | Cloudflare Pages (free tier) |
| Source | GitHub |
| Instagram | `@tinglingdingphotography` (underwater) · `@tinglingdingportraits` (portraits) |
| Contact | `mailto:tinglingdingphotography@gmail.com` (no backend) — appears only on the portraits page |

---

## Local development

Requires Node 18.18+ (Node 20 LTS recommended).

```bash
# install
npm install

# dev server with hot reload
npm run dev          # → http://localhost:3000

# production build (writes to ./out)
npm run build

# preview the production build locally
npx serve out        # or any static host
```

The exported site lives in `./out/` — that's the directory Cloudflare Pages
deploys.

---

## Project layout

```
.
├── app/                        # Next.js App Router
│   ├── layout.tsx              # Root layout, fonts, metadata
│   ├── globals.css             # Design tokens (dark + per-side accents)
│   ├── page.tsx                # The split-screen hub
│   ├── page.module.css
│   ├── underwater/             # Underwater & nature side
│   │   ├── layout.tsx          # sets data-side="underwater"
│   │   ├── page.tsx
│   │   └── page.module.css
│   ├── portraits/              # Portraits side
│   │   ├── layout.tsx          # sets data-side="portrait"
│   │   ├── page.tsx
│   │   └── page.module.css
│   └── components/
│       ├── SiteNav.tsx         # Top nav for the two side pages
│       ├── InstagramFeed.tsx   # IG feed (placeholder until widget wired)
│       ├── Contact.tsx         # mailto: inquiry form (portraits only)
│       └── Footer.tsx
├── public/                     # Static assets
│   ├── favicon.svg
│   ├── site.webmanifest
│   ├── robots.txt
│   ├── sitemap.xml
│   ├── _headers                # Cloudflare security headers
│   └── _redirects              # Cloudflare URL rewrites
├── next.config.mjs             # Static export config
├── tsconfig.json
├── package.json
└── moodboard/                  # Style reference (kept for context)
```

---

## Design system

Two aesthetic axes, no theme toggle:

- **Side accent** — set per page via `data-side="underwater"` or
  `data-side="portrait"` (in each page's `layout.tsx`). Controls the accent
  color (cyan vs. lavender/purple) and the display typeface (Anton vs. DM
  Serif Display).
- **Hub split** — the homepage uses `data-side="hub"` and each half sets
  its own `data-half` for the accent.

The site is dark by default — there is no light mode.

---

## Wiring up the Instagram feed

> **Status as of 2026:** Instagram's **Basic Display API was shut down
> March 3, 2025**. Don't use it. The Instagram **Graph API** still
> works but only for Business/Creator accounts, requires a Facebook
> app, and is CORS-blocked from a static client — so you need a small
> server-side proxy to bridge it.

You have three options. **Path 2 is the recommended one** — it's
the only one that's free forever, you own the data, and there's no
subscription.

### Path 1: third-party widget (5 min setup, ongoing cost)

If you don't mind paying ~$10–30/mo for someone else to handle the
IG connection:

| Service | URL | Notes |
|---|---|---|
| **SnapWidget** | https://snapwidget.com | Easiest free tier, just an iframe |
| **Behold** | https://behold.pictures | Cleaner visual defaults |
| **Curator.io** | https://curator.io | 1-week trial then paid |
| **Elfsight** | https://elfsight.com | Lots of widget types |
| **EmbedSocial** | https://embedsocial.com | Hashtag aggregation |
| **Juicer** | https://juicer.io | Free, moderation tools |

Sign up, point at the handle, paste their embed into the `feedActive`
block in `app/components/InstagramFeed.tsx`, pass `feedActive={true}`
from the page. Done in 5 min, but it's a subscription.

### Path 2: Instagram Graph API + Cloudflare Worker (recommended, ~1-2h one-time, free forever)

This is what's already wired up. The static site calls
`${NEXT_PUBLIC_IG_PROXY_URL}/underwater` and `/portraits`, and the
Worker holds the access token server-side, fetches from the Graph API,
caches at the edge for 1 hour, and returns CORS-safe JSON.

**What you need to do** (one-time, ~1-2 hours):

1. **Convert both IG accounts to Business or Creator.** In the IG app:
   Settings → Account → Switch to professional account. Choose
   Business (safest for a photographer selling services) or Creator
   (if you want a more "creator" vibe). Repeat for both accounts.

2. **Link each IG to a Facebook Page.** If you don't have one, create
   it (Facebook → Create Page → name it, ~2 min). In the Page's
   Settings → Linked Accounts → Connect Instagram. Repeat for both
   IGs — they can both link to the same Page or different ones.

3. **Create a Facebook app** at
   [developers.facebook.com](https://developers.facebook.com) (type
   "Other" or "Consumer"). In the app dashboard, click **Add Product**
   and add **Instagram** (the new "Instagram" product, which gives
   you Graph API access — *not* the old "Instagram Basic Display" which
   is dead).

4. **Get the user IDs.** Visit
   `https://graph.instagram.com/v18.0/me?fields=id&access_token=SHORT_TOKEN`
   for each account. Copy the numeric `id` field for each.

5. **Generate a long-lived access token** for each account:
   ```bash
   # Get a short-lived token via the Graph API Explorer first
   # (https://developers.facebook.com/tools/explorer/)
   # Then exchange it for a 60-day long-lived token:
   curl -X GET \
     "https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=APP_SECRET&access_token=SHORT_TOKEN"
   ```
   Do this twice — once per IG account, using the matching token.

6. **Deploy the Worker** (the code is already in `workers/ig-proxy/`):
   ```bash
   cd workers/ig-proxy
   npm install
   npx wrangler login
   npx wrangler secret put IG_USER_ID_UNDERWATER
   npx wrangler secret put IG_ACCESS_TOKEN_UNDERWATER
   npx wrangler secret put IG_USER_ID_PORTRAITS
   npx wrangler secret put IG_ACCESS_TOKEN_PORTRAITS
   npx wrangler deploy
   ```
   The deploy output will give you a URL like
   `https://ig-proxy.<your-subdomain>.workers.dev`.

7. **Set `NEXT_PUBLIC_IG_PROXY_URL`** in your env to that Worker URL
   (in `.env.local` for dev, in Cloudflare Pages → Settings →
   Environment variables for prod).

8. **Redeploy the static site.** The feed will start showing real
   posts. Refresh tokens every 60 days (set a calendar reminder —
   when they expire, the feed falls back to the placeholder with an
   error note).

**Why this is the right answer:** zero ongoing cost, you own the
data, no third-party branding, free of trial limits. The 1-2h setup
is a one-time cost.

### Path 3: oEmbed for individual posts (not a real feed)

Public, no auth, but only for individual hardcoded posts. You can't
use it for a feed — you'd have to manually curate which posts to
show. Skip unless you have a very specific "featured post" use case.

---

## Swapping the hero images

For now, the heroes are CSS-only placeholders. When you have specific
photos to feature:

- **Underwater hero** — open `app/underwater/page.tsx` and replace the
  `<div className={styles.heroBg}>` block with a Next.js `<Image />` (or
  just a plain `<img>` if you want zero config) pointing at your asset.
- **Portrait hero** — same idea. Replace or layer on top of the existing
  hero container. The page already has a subtle purple gradient as a
  default; you can either keep it as a backdrop or replace it.

If you want image optimization, drop the photos into `public/photos/` and
use `<Image src="/photos/your-file.jpg" ... />` from `next/image` after
removing the `unoptimized: true` flag in `next.config.mjs`.

---

## Deploying to Cloudflare Pages

The site is set up for `output: 'export'` so the build is a static
`out/` directory. Cloudflare Pages can deploy it directly.

### First-time setup

1. **Push to GitHub.** This repo (or the main branch you want to ship from).
2. **Log in to Cloudflare** → Workers & Pages → Create application → Pages →
   Connect to Git.
3. **Select the repo.**
4. **Configure the build:**
   - **Framework preset:** Next.js (Static Export)
   - **Build command:** `npm run build`
   - **Build output directory:** `out`
   - **Node version:** 20 (set under Environment variables → `NODE_VERSION=20`)
5. **Save and deploy.** First deploy takes a couple of minutes.
6. **Custom domain:** Pages will give you a `*.pages.dev` URL. Once that's
   live, attach `tinglingdingphotography.com`:
   - Pages → Custom domains → Set up a custom domain → enter the apex
   - Cloudflare will tell you to add a CNAME (for subdomains) or move the
     nameservers (for the apex).

### Moving the apex domain from GoDaddy to Cloudflare

For an **apex domain** (`tinglingdingphotography.com`, no `www`), the only
way to point it at Pages is to move DNS to Cloudflare.

1. **In Cloudflare:** Add the site → choose the Free plan → Cloudflare
   will scan existing DNS records. Verify it found your existing records
   (especially any mail records you need to keep).
2. **Cloudflare gives you two nameservers** (something like
   `chip.ns.cloudflare.com` and `nina.ns.cloudflare.com`).
3. **In GoDaddy:** My Products → Domains → `tinglingdingphotography.com`
   → Manage DNS → Nameservers → Change → Custom nameservers → paste the
   two Cloudflare nameservers → Save.
4. **Propagation** takes 5 minutes to 48 hours. Cloudflare will email
   you when it's active.
5. **Back in Cloudflare Pages → Custom domains:** add
   `tinglingdingphotography.com`. Pages automatically creates the right
   CNAME at the apex via Cloudflare's CNAME flattening.

> **Heads up:** if you have email (Gmail, Workspace, etc.) routed through
> the domain, make sure the MX records survive the move. Cloudflare usually
> imports them, but double-check before flipping the nameservers.

### Environment variables

None required for the static build. If you add server-side features
later (Resend, OG image generation, etc.), set them under
**Pages → Settings → Environment variables**.

---

## Editing the site

Most tweaks live in:

| What | Where |
|---|---|
| IG handle on a side | `app/underwater/page.tsx` / `app/portraits/page.tsx` (constant at the top) |
| Hero copy | Same files, the `<h1>` inside `heroInner` |
| Contact email | `app/components/Contact.tsx` (`TO_EMAIL` constant) |
| IG proxy URL | `NEXT_PUBLIC_IG_PROXY_URL` env var — points at your deployed `ig-proxy` Worker |
| IG secrets (server-side) | Set in Cloudflare Worker via `wrangler secret put` (see Worker setup above) |
| Accent colors | `app/globals.css` (`[data-side="underwater"]` and `[data-side="portrait"]` blocks) |
| Hero gradient (per side) | `app/underwater/page.module.css` and `app/portraits/page.module.css` (3 slide variants) |
| Hub gradient colors | `app/page.module.css` (`.halfUnderwater .halfBg` and `.halfPortrait .halfBg`) |
| Fonts | `app/layout.tsx` (Google Fonts link) + `app/globals.css` (`--ff-display`, `--ff-body`, etc.) |
| Self-review screenshots | Daemon MCP bridge at `app/mcp-bridge.cjs` — registered as "playwright" in `~/.mavis/mcp/mcp.json` |
| Cloudflare Worker | `workers/ig-proxy/` — deploy with `wrangler deploy` after setting secrets |

---

## Roadmap (when you want it)

- [ ] Real hero photos (swap from CSS placeholders)
- [ ] Wire up the IG widget for both sides
- [ ] Custom 404 page
- [ ] Open Graph image (drop a JPG in `public/og-default.png`)
- [ ] Image optimization (turn off `unoptimized` in `next.config.mjs` and
      add `next/image` everywhere)
- [ ] Optional: upgrade to SSR with `@cloudflare/next-on-pages` if you
      ever want a real contact-form backend instead of `mailto:`
