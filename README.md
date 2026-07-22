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
- `/dashboard`: private dashboard for support tickets, page views, sessions, sources, devices, and recent activity
- The server maps these clean URLs to the static HTML templates and redirects legacy `.html` links.
- `styles.css`: complete responsive design system
- `theme.js`: early time-based theme selection with light, dark, and automatic visitor controls
- `script.js`: mobile navigation, scroll reveals, current year, and privacy-preserving page-view collection
- `dashboard.js`: authenticated analytics and support-ticket dashboard rendering
- `support.js`: support form submission and UI states
- `server.mjs`: dependency-free static server with Resend support, private ticket storage, first-party analytics, and dashboard endpoints
- `api/support.js`: serverless support endpoint for Vercel-compatible hosting
- `assets/broadway-pixels-logo-v2.png`: transparent Broadway Pixels wordmark used in the header and footer
- `assets/broadway-pixels-favicon.png`: circular Broadway Pixels logo used in browser tabs and support emails
- `assets/artist-hero.webp` and `assets/artist-portrait.webp`: current artist photography from the live site
- `assets/anything-cover.jpg`: Spotify artwork for the latest release, Anything
- `assets/youtube-*.jpg`: current Broadway Pixels YouTube thumbnails
- `assets/vidioza-app-preview.png`: current Vidioza product website preview
- `assets/tanktopia-background.png` and `assets/tanktopia-logo.png`: Tanktopia project art and wordmark
- `assets/kixkan-preview.jpg`: branded KixKan Linux project preview
- `assets/app-worlds.jpg`: optimized app-development artwork
- `assets/app-worlds.png`: original generated Broadway Pixels illustration

## Squarespace path

Use the design as a visual blueprint in Squarespace 7.1. Create Home, Projects, Music, and Support pages, add the generated art as image blocks, and copy the text section by section. The custom CSS can be adapted in Design > Custom CSS. Keep the Resend API endpoint on a server or serverless host because Squarespace browser code must not contain the secret key.

## Droplet path

The support form and dashboard need server endpoints, so run `server.mjs` behind Nginx instead of serving the folder directly. Copy `.env.example` to a protected environment file, add the Resend and dashboard values, create `/var/lib/broadway-pixels/analytics` and `/var/lib/broadway-pixels/tickets` owned by the service user, run the Node process with systemd, and proxy Nginx to `127.0.0.1:8080`. Add HTTPS with Certbot.

## Theme and analytics

- Automatic mode uses each visitor's local time: light from 7:00 AM through 6:59 PM and dark from 7:00 PM through 6:59 AM.
- The header control cycles between automatic, light, and dark. Manual choices remain in local browser storage.
- Public analytics store the page path, referrer hostname, device class, UTC timestamp, and an anonymous tab-session ID.
- Analytics do not retain visitor IP addresses, names, email addresses, complete referrer URLs, or dashboard visits.
- Support tickets retain the submitted name, email, project, subject, message, optional helpful link, delivery status, and public ticket number in the private ticket store.
- Browsers with Do Not Track enabled are not recorded.
- Dashboard sessions use signed, secure, HttpOnly cookies and expire after 12 hours.

## Resend setup

1. Add and verify `broadwaypixels.com` in Resend.
2. Create a sending-only API key restricted to that domain.
3. Set `RESEND_API_KEY`, `SUPPORT_FROM_EMAIL`, `SUPPORT_TO_EMAIL`, `SUPPORT_DATA_DIR`, and `ALLOWED_ORIGINS` from `.env.example` in the hosting environment.
4. Run `npm test`, then start the site with `npm start`.

The API key must only exist on the server. Never add the real key to `support.js`, HTML, Git, or Squarespace code injection. If the frontend remains on Squarespace, deploy `/api/support` separately and change the form fetch URL in `support.js` to that HTTPS endpoint.

The contact email is `Media@BroadwayPixels.com`. Before launch, confirm project status language, final domain DNS, analytics, privacy copy, and social preview image.
