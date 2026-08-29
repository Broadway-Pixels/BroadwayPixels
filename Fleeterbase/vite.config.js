import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

function publicUrl(value) {
  try {
    const url = new URL(value || 'http://127.0.0.1:5173');
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new Error('VITE_PUBLIC_SITE_URL must be a valid http or https origin.');
  }
}

function seoFiles(siteUrl) {
  return {
    name: 'fleeterbase-seo',
    transformIndexHtml(html) { return html.replaceAll('{{SITE_URL}}', siteUrl); },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: `User-agent: *\nAllow: /\nSitemap: ${siteUrl}/sitemap.xml\n` });
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${siteUrl}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url></urlset>\n` });
      this.emitFile({ type: 'asset', fileName: 'site.webmanifest', source: JSON.stringify({ name: 'Fleeterbase', short_name: 'Fleeterbase', description: 'Rental fleet operations for Turo hosts.', start_url: '/', display: 'standalone', background_color: '#ffffff', theme_color: '#06192e', icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }] }, null, 2) });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return { plugins: [react(), seoFiles(publicUrl(env.VITE_PUBLIC_SITE_URL))] };
});
