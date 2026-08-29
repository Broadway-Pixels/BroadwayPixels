# Broadway Pixels website concept

Broadway Pixels website, positioning the studio as a music producer, content creator, and app developer. The site includes a project-aware support form backed by Resend, branded ticket confirmations, automatic time-based light and dark themes, and a private dashboard for analytics and support tickets.

## Preview locally

```bash
npm start
```

Then open `http://localhost:8080`.

## Pages

- `/`: focused studio introduction and latest work
- `/music`: year-grouped releases with direct Spotify and verified SoundCloud links
- `/videos`: YouTube video releases, Shorts, Reels, and TikToks
- `/projects`: apps, games, and software projects
- `/support`: single form for project support, collaborations, press, and general questions
- `/dashboard`: private dashboard for replying to, archiving, restoring, and deleting support tickets plus page views, sessions, sources, devices, and recent activity
- `/privacy`: public Tanktopia privacy policy used by the store metadata handoff
- `/tanktopia/eula`: public Tanktopia end user license agreement used by the store metadata handoff
- `/steady/privacy`: public Steady privacy policy for account sync, wellness data, AI coaching, subscriptions, and ads
- `/steady/terms`: public Steady terms of use and subscription terms
- The server maps these clean URLs to the static HTML templates and redirects legacy `.html` links.
- `styles.css`: complete responsive design system
- `theme.js`: early time-based theme selection with light, dark, and automatic visitor controls
- `script.js`: mobile navigation, scroll reveals, current year, and privacy-preserving page-view collection
- `dashboard.js`: authenticated analytics and support-ticket dashboard rendering
- `support.js`: support form submission and UI states
- `server.mjs`: dependency-free static server with Resend support, private ticket storage, first-party analytics, and dashboard endpoints
- `api/support.js`: serverless support endpoint for Vercel-compatible hosting
- `assets/broadway-pixels-logo-v2.png`: transparent Broadway Pixels wordmark used in the header, footer, and support emails
- `assets/broadway-pixels-favicon.png`: circular Broadway Pixels logo used in browser tabs
- `assets/artist-hero.webp` and `assets/artist-portrait.webp`: current artist photography from the live site
- `assets/anything-cover.jpg`: Spotify artwork for the latest release, Anything
- `assets/youtube-*.jpg`: current Broadway Pixels YouTube thumbnails
- `assets/vidioza-app-preview.png`: current Vidioza product website preview
- `assets/autoclicker-app-icon.png`: Autoclicker project icon used on the Projects page
- `assets/tanktopia-background.png` and `assets/tanktopia-logo.png`: Tanktopia project art and wordmark
- `assets/kixkan-preview.jpg`: branded KixKan Linux project preview
- `assets/app-worlds.jpg`: optimized app-development artwork
- `assets/app-worlds.png`: original generated Broadway Pixels illustration

## Squarespace path

Use the design as a visual blueprint in Squarespace 7.1. Create Home, Projects, Music, and Support pages, add the generated art as image blocks, and copy the text section by section. The custom CSS can be adapted in Design > Custom CSS. Keep the Resend API endpoint on a server or serverless host because Squarespace browser code must not contain the secret key.

## Cloudflare production hosting

Broadway Pixels runs as one Cloudflare Worker with Static Assets and a D1 database. Static pages and assets are built into `dist/`; `/api/support`, `/api/analytics`, and `/api/dashboard` run in `worker/index.mjs`. D1 stores tickets, reply history, archive state, first-party analytics, and rate-limit counters. Resend remains the transactional email provider.

```bash
npm install
npm run build
npm run cf:migrate:local
npm run cf:dev
```

Production configuration lives in `wrangler.jsonc`. Store `RESEND_API_KEY`, `DASHBOARD_USERNAME`, `DASHBOARD_PASSWORD`, and `DASHBOARD_SESSION_SECRET` with `wrangler secret`; never place their real values in the repository. Apply migrations with `npm run cf:migrate:remote`, then deploy with `npm run cf:deploy`.

The legacy Node/Nginx files remain temporarily for rollback while the Cloudflare deployment is proven. They are no longer the intended production hosting path after cutover.

## Theme and analytics

- Automatic mode uses each visitor's local time: light from 7:00 AM through 6:59 PM and dark from 7:00 PM through 6:59 AM.
- The header control cycles between automatic, light, and dark. Manual choices remain in local browser storage.
- Public analytics store the page path, referrer hostname, device class, UTC timestamp, and an anonymous tab-session ID.
- Analytics do not retain visitor IP addresses, names, email addresses, complete referrer URLs, or dashboard visits.
- Support tickets retain the submitted name, email, project, subject, message, optional helpful link, delivery status, public ticket number, archive state, and dashboard reply history in the private ticket store. Deleting a ticket permanently removes its stored record.
- Browsers with Do Not Track enabled are not recorded.
- Dashboard sessions use signed, secure, HttpOnly cookies and expire after 12 hours.

## Resend setup

1. Add and verify `broadwaypixels.com` in Resend.
2. Create a sending-only API key restricted to that domain.
3. Store `RESEND_API_KEY` as a Cloudflare Worker secret. Public email addresses and allowed origins are configured in `wrangler.jsonc`.
4. Run `npm test`, `npm run build`, and `npm run cf:deploy`.

The API key must only exist on the server. Never add the real key to `support.js`, HTML, Git, or Squarespace code injection. If the frontend remains on Squarespace, deploy `/api/support` separately and change the form fetch URL in `support.js` to that HTTPS endpoint.

The contact email is `Media@BroadwayPixels.com`. Before launch, confirm project status language, final domain DNS, analytics, privacy copy, and social preview image.
