#!/usr/bin/env node
/**
 * build-docs.js
 *
 * Converts the repo's top-level markdown docs (CLAUDE.md, DEPLOYMENT.md,
 * CONTRIBUTING.md) to static HTML files under docs/.
 *
 * Run with:   npm run build:docs
 *
 * Features:
 *   - Per-page sidebar table of contents from H2/H3 headings
 *   - Top nav bar links between all docs
 *   - Rewrites .md links to .html so cross-doc nav works in the browser
 *   - Strips GitHub-style #Lxxx line-number anchors (those don't exist in HTML)
 *   - Shared docs/styles.css
 *
 * To add a new doc: append an entry to the `sources` array below.
 */
const fs = require('fs');
const path = require('path');
const MarkdownIt = require('markdown-it');
const anchor = require('markdown-it-anchor');

const REPO_ROOT = path.resolve(__dirname, '..');
const DOCS_DIR = path.join(REPO_ROOT, 'docs');

const sources = [
  { md: 'CLAUDE.md',         html: 'claude.html',         title: 'CLAUDE',         blurb: 'Architecture, conventions, business rules, and infrastructure overview.' },
  { md: 'DEPLOYMENT.md',     html: 'deployment.html',     title: 'DEPLOYMENT',     blurb: 'Lightsail setup, SSL, backups, restore, monitoring, troubleshooting.' },
  { md: 'CONTRIBUTING.md',   html: 'contributing.html',   title: 'CONTRIBUTING',   blurb: 'Git workflow: branching, committing, reviewing, merging, cleanup.' },
  { md: 'TODOS.md',          html: 'todos.html',          title: 'TODOS',          blurb: 'Deferred work and follow-ups, tagged by criticality.' },
  { md: 'RELEASE_NOTES.md',  html: 'release-notes.html',  title: 'RELEASE NOTES',  blurb: 'Per-version changelog with App Store review context and deploy notes.' },
  { md: 'TESTFLIGHT_CHECKLIST.md', html: 'testflight-checklist.html', title: 'TESTFLIGHT CHECKLIST', blurb: 'Must-test-on-device list: IAP, release-only renders, native modules, reinstall persistence.' },
];

// Map "claude" / "deployment" / etc to the lowercase filename so link rewriting
// is case-insensitive (CLAUDE.md and claude.md both map to claude.html).
const mdToHtmlBasename = new Map(
  sources.map((s) => [s.md.toLowerCase().replace(/\.md$/, ''), s.html])
);

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

const md = new MarkdownIt({
  html: true,
  // linkify is off because our docs frequently mention filenames like "CLAUDE.md"
  // in prose, and linkify converts those to http://CLAUDE.md links. We rely on
  // explicit [text](url) markdown syntax instead.
  linkify: false,
  typographer: false,
  breaks: false,
}).use(anchor, {
  level: [1, 2, 3, 4],
  permalink: anchor.permalink.linkInsideHeader({
    symbol: '#',
    placement: 'before',
    ariaHidden: true,
  }),
  slugify,
});

// Rewrite markdown-source links:
//   - foo.md           -> foo.html
//   - foo.md#anchor    -> foo.html#anchor  (anchor passes through)
//   - foo.md#Lxxx      -> foo.html         (strip GitHub line anchors)
//
// Operates on the raw markdown so it covers both inline links [x](y.md) and
// reference-style links. Case-insensitive on the filename.
function rewriteLinks(markdown) {
  return markdown.replace(
    /\(([^)\s]+?)\.md(#[^)\s]*)?\)/gi,
    (match, basePath, anchor) => {
      const basename = basePath.toLowerCase().split('/').pop();
      const htmlName = mdToHtmlBasename.get(basename) || `${basename}.html`;
      // Preserve the dirname if any (e.g. ./foo/bar.md -> ./foo/bar.html)
      const dir = basePath.includes('/') ? basePath.replace(/\/[^/]+$/, '/') : '';
      let cleanAnchor = '';
      if (anchor) {
        // Strip GitHub line-number anchors like #L468 or #L100-L120
        if (!/^#L\d+(-L\d+)?$/i.test(anchor)) {
          cleanAnchor = anchor;
        }
      }
      return `(${dir}${htmlName}${cleanAnchor})`;
    }
  );
}

// Pull H2 / H3 headings out of the rendered HTML to build a sidebar TOC.
// markdown-it-anchor injects id="..." attributes; we read those.
function extractToc(html) {
  const headings = [];
  const re = /<h([23])[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g;
  let m;
  while ((m = re.exec(html))) {
    const level = parseInt(m[1], 10);
    const id = m[2];
    // Strip permalink anchor (markdown-it-anchor wraps content in <a href="#id">...</a>)
    let text = m[3]
      .replace(/<a\b[^>]*class="header-anchor"[^>]*>[\s\S]*?<\/a>/g, '')
      .replace(/<a\b[^>]*aria-hidden[^>]*>[\s\S]*?<\/a>/g, '')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (!text) continue;
    headings.push({ level, id, text });
  }
  if (headings.length === 0) {
    return '<p class="toc-empty">(no sections)</p>';
  }
  // Build a nested list with well-formed open/close pairs.
  //
  // State machine: `depth` tracks how many <ul>s are currently open. Each
  // heading drives the depth toward (level - rootLevel). When opening a deeper
  // level, the previous <li> stays open so the new <ul> nests inside it. When
  // closing, we close the deeper </li></ul> pairs back to the target depth,
  // then close the now-current </li> before opening the new <li>.
  const rootLevel = Math.min(...headings.map((h) => h.level)) - 1;
  let out = '';
  let depth = 0;
  for (const h of headings) {
    const target = h.level - rootLevel;
    // Open <ul>s to go deeper
    while (depth < target) {
      out += depth === 0 ? '<ul class="toc">' : '<ul>';
      depth++;
    }
    // Close </li></ul> pairs to come shallower
    while (depth > target) {
      out += '</li></ul>';
      depth--;
    }
    // Close the previous <li> at this depth unless we just opened the <ul>
    if (!out.endsWith('<ul class="toc">') && !out.endsWith('<ul>')) {
      out += '</li>';
    }
    out += `<li><a href="#${h.id}">${escapeHtml(h.text)}</a>`;
  }
  // Close everything still open
  while (depth > 0) {
    out += '</li></ul>';
    depth--;
  }
  return out;
}

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderPage({ title, bodyHtml, tocHtml, currentHtml }) {
  const navLinks = [
    `<a href="index.html"${currentHtml === 'index.html' ? ' class="active"' : ''}>Index</a>`,
    ...sources.map(
      (s) => `<a href="${s.html}"${s.html === currentHtml ? ' class="active"' : ''}>${s.title}</a>`
    ),
  ].join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — TryOn Docs</title>
<link rel="stylesheet" href="styles.css">
</head>
<body>
<header class="topbar">
  <a href="index.html" class="brand">TryOn Docs</a>
  <nav class="docnav">${navLinks}</nav>
</header>
<div class="layout">
  <aside class="sidebar">
    <h2 class="toc-title">On this page</h2>
    ${tocHtml}
  </aside>
  <main class="content">
${bodyHtml}
  </main>
</div>
<footer class="footer">
  <p>Generated from <code>${escapeHtml(title === 'Index' ? 'scripts/build-docs.js' : sources.find((s) => s.title === title)?.md || '')}</code>. Run <code>npm run build:docs</code> to regenerate.</p>
</footer>
</body>
</html>
`;
}

// ----- main ---------------------------------------------------------------

fs.mkdirSync(DOCS_DIR, { recursive: true });

for (const s of sources) {
  const srcPath = path.join(REPO_ROOT, s.md);
  if (!fs.existsSync(srcPath)) {
    console.error(`SKIP: missing source ${s.md}`);
    continue;
  }
  const src = fs.readFileSync(srcPath, 'utf-8');
  const rewritten = rewriteLinks(src);
  const rendered = md.render(rewritten);
  const toc = extractToc(rendered);
  const html = renderPage({
    title: s.title,
    bodyHtml: rendered,
    tocHtml: toc,
    currentHtml: s.html,
  });
  const outPath = path.join(DOCS_DIR, s.html);
  fs.writeFileSync(outPath, html);
  console.log(`  ✓ ${s.md} → docs/${s.html}`);
}

// Landing page
const indexBody = `
<h1>TryOn Documentation</h1>
<p>Static HTML build of the project's markdown docs. Sources live at the repo root; this output is regenerated by <code>npm run build:docs</code>.</p>
<div class="doc-cards">
${sources
  .map(
    (s) => `  <a class="doc-card" href="${s.html}">
    <h2>${s.title}</h2>
    <p>${s.blurb}</p>
  </a>`
  )
  .join('\n')}
</div>
<h2>Adding a new doc</h2>
<ol>
  <li>Add the <code>.md</code> file at the repo root.</li>
  <li>Append an entry to the <code>sources</code> array in <code>scripts/build-docs.js</code>.</li>
  <li>Run <code>npm run build:docs</code>.</li>
</ol>
`;

const indexHtml = renderPage({
  title: 'Index',
  bodyHtml: indexBody,
  tocHtml: '<p class="toc-empty">(landing page)</p>',
  currentHtml: 'index.html',
});
fs.writeFileSync(path.join(DOCS_DIR, 'index.html'), indexHtml);
console.log('  ✓ docs/index.html');

console.log('\nDone.');
