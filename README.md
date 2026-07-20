# Broadway Pixels website concept

Three-page static site concept for `broadwaypixels.com`, positioning Broadway Pixels as a music producer, content creator, and app developer.

## Preview locally

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Pages

- `index.html`: music, content, apps, and artist story
- `music.html`: year-grouped releases with direct Spotify and verified SoundCloud links
- `projects.html`: filterable music, content, and app portfolio
- `styles.css`: complete responsive design system
- `script.js`: mobile navigation, scroll reveals, project filters, and current year
- `assets/broadway-pixels-logo.webp`: current Broadway Pixels logo from the live Squarespace site
- `assets/artist-hero.webp` and `assets/artist-portrait.webp`: current artist photography from the live site
- `assets/anything-cover.jpg`: Spotify artwork for the latest release, Anything
- `assets/youtube-*.jpg`: current Broadway Pixels YouTube thumbnails
- `assets/vidioza-dancing-fruit.jpg`: Vidioza product media used on Home and Projects
- `assets/app-worlds.jpg`: optimized app-development artwork
- `assets/app-worlds.png`: original generated Broadway Pixels illustration

## Squarespace path

Use the design as a visual blueprint in Squarespace 7.1. Create Home and Projects pages, add the generated art as image blocks, and copy the text section by section. The custom CSS can be adapted in Design > Custom CSS. Squarespace is the easier choice if nontechnical editing is the priority.

## Droplet path

This folder can be served directly by Nginx with no build step. Point `broadwaypixels.com` and `www.broadwaypixels.com` to the droplet, copy the folder to `/var/www/broadwaypixels`, configure Nginx with `index index.html`, and add HTTPS with Certbot.

The contact email is `Media@BroadwayPixels.com`. Before launch, confirm project status language, final domain DNS, analytics, privacy copy, and social preview image.

## Art prompt

Built-in image generation was used for a wide editorial cartoon city connecting an aquarium game, barcode resale utility, and mobile storefront. The visual direction uses cobalt blue, powder blue, navy, off-white, and one warm yellow accent with no embedded text or logos.
