let tracks = [];

async function init() {
  try {
    const res = await fetch('tracks.json');
    tracks = await res.json();
  } catch (e) {
    tracks = [];
  }
  route();
  window.addEventListener('hashchange', route);
}

function route() {
  const hash = location.hash;
  const app = document.getElementById('app');
  const bg = document.getElementById('bg');

  if (hash.startsWith('#/track/')) {
    const slug = hash.slice('#/track/'.length);
    const track = tracks.find(t => t.slug === slug);
    bg.className = 'track';
    if (track) {
      renderTrack(app, track);
    } else {
      renderNotFound(app);
    }
  } else {
    bg.className = 'home';
    renderHome(app);
  }

  window.scrollTo(0, 0);
}

function renderHome(app) {
  const items = tracks.map(t => `
    <li>
      <a href="#/track/${esc(t.slug)}">
        <span class="track-title">${esc(t.title)}</span>
        <span class="track-meta">${t.year ? esc(String(t.year)) : ''}</span>
      </a>
    </li>
  `).join('');

  app.innerHTML = `
    <header class="home-header">
      <h1>weirdshape</h1>
      <p class="tagline">electronic music</p>
    </header>
    <ul class="track-list">${items}</ul>
  `;
}

function renderTrack(app, track) {
  const embedSrc = `https://w.soundcloud.com/player/?url=${encodeURIComponent(track.soundcloudUrl)}&visual=false&color=%23000000&auto_play=false&hide_related=true&show_comments=false&show_user=false&show_reposts=false&show_teaser=false`;

  const tags = (track.tags || [])
    .map(tag => `<span class="tag">${esc(tag)}</span>`)
    .join('');

  app.innerHTML = `
    <nav><a href="#/">← back</a></nav>
    <div class="track-page">
      <h1>${esc(track.title)}</h1>
      <div class="track-embed">
        <iframe
          src="${embedSrc}"
          width="100%"
          height="166"
          scrolling="no"
          allow="autoplay"
        ></iframe>
      </div>
      ${track.description ? `<p class="track-description">${esc(track.description)}</p>` : ''}
      ${tags ? `<div class="track-tags">${tags}</div>` : ''}
    </div>
  `;
}

function renderNotFound(app) {
  app.innerHTML = `
    <nav><a href="#/">← back</a></nav>
    <p class="not-found">track not found</p>
  `;
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

init();
