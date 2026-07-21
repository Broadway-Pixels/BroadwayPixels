# Broadway Pixels website concept

Broadway Pixels website, positioning the studio as a music producer, content creator, and app developer. The site includes a project-aware support form backed by Resend.

## Preview locally

```bash
npm start
```

Then open `http://localhost:8080`.

## Pages

- `index.html`: focused studio introduction and latest work
- `music.html`: year-grouped releases with direct Spotify and verified SoundCloud links
- `content.html`: YouTube video releases and Shorts
- `projects.html`: apps, games, and software projects
- `support.html`: single form for project support, collaborations, press, and general questions
- `styles.css`: complete responsive design system
- `script.js`: mobile navigation, scroll reveals, and current year
- `support.js`: support form submission and UI states
- `server.mjs`: dependency-free static server and Resend support endpoint for a droplet
- `api/support.js`: serverless support endpoint for Vercel-compatible hosting
- `assets/broadway-pixels-logo-v2.png`: transparent Broadway Pixels wordmark based on the supplied retro arcade logo direction
- `assets/artist-hero.webp` and `assets/artist-portrait.webp`: current artist photography from the live site
- `assets/anything-cover.jpg`: Spotify artwork for the latest release, Anything
- `assets/youtube-*.jpg`: current Broadway Pixels YouTube thumbnails
- `assets/vidioza-app-preview.png`: current Vidioza product website preview
- `assets/tanktopia-background.png` and `assets/tanktopia-logo.png`: Tanktopia project art and wordmark
- `assets/app-worlds.jpg`: optimized app-development artwork
- `assets/app-worlds.png`: original generated Broadway Pixels illustration

## Squarespace path

Use the design as a visual blueprint in Squarespace 7.1. Create Home, Projects, Music, and Support pages, add the generated art as image blocks, and copy the text section by section. The custom CSS can be adapted in Design > Custom CSS. Keep the Resend API endpoint on a server or serverless host because Squarespace browser code must not contain the secret key.

## Droplet path

The support form needs a server endpoint, so run `server.mjs` behind Nginx instead of serving the folder directly. Copy `.env.example` to a protected environment file, add the Resend values, run the Node process with systemd, and proxy Nginx to `127.0.0.1:8080`. Add HTTPS with Certbot.

## Resend setup

1. Add and verify a sending subdomain such as `mail.broadwaypixels.com` in Resend.
2. Create a sending-only API key restricted to that domain.
3. Set `RESEND_API_KEY`, `SUPPORT_FROM_EMAIL`, `SUPPORT_TO_EMAIL`, and `ALLOWED_ORIGINS` from `.env.example` in the hosting environment.
4. Run `npm test`, then start the site with `npm start`.

The API key must only exist on the server. Never add the real key to `support.js`, HTML, Git, or Squarespace code injection. If the frontend remains on Squarespace, deploy `/api/support` separately and change the form fetch URL in `support.js` to that HTTPS endpoint.

The contact email is `Media@BroadwayPixels.com`. Before launch, confirm project status language, final domain DNS, analytics, privacy copy, and social preview image.
