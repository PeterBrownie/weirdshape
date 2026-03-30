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

async function renderTrack(app, track) {
  const embedSrc = `https://w.soundcloud.com/player/?url=${encodeURIComponent(track.soundcloudUrl)}&visual=false&color=%23000000&auto_play=false&hide_related=true&show_comments=false&show_user=false&show_reposts=false&show_teaser=false`;

  const tags = (track.tags || [])
    .map(tag => `<span class="tag">${esc(tag)}</span>`)
    .join('');

  app.innerHTML = `
    <nav><a href="#/">← back</a></nav>
    <div class="track-page">
      <h1>${esc(track.title)}</h1>
      <div class="player">
        <div class="artwork-wrap">
          <img class="player-artwork" alt="${esc(track.title)}">
        </div>
        <div class="player-main">
          <div class="player-loader">
            <svg viewBox="0 0 46 20" fill="white" xmlns="http://www.w3.org/2000/svg">
              <rect class="bar" x="0"  y="4" width="4" height="12" rx="1"/>
              <rect class="bar" x="9"  y="4" width="4" height="12" rx="1"/>
              <rect class="bar" x="18" y="4" width="4" height="12" rx="1"/>
              <rect class="bar" x="27" y="4" width="4" height="12" rx="1"/>
              <rect class="bar" x="36" y="4" width="4" height="12" rx="1"/>
            </svg>
          </div>
          <canvas class="waveform"></canvas>
          <div class="player-controls">
            <button class="play-btn">play</button>
            <span class="player-time">
              <span class="time-current">0:00</span>
              <span class="time-sep"> / </span>
              <span class="time-total">0:00</span>
            </span>
          </div>
        </div>
      </div>
      <iframe
        id="sc-iframe"
        src="${embedSrc}"
        allow="autoplay"
        style="display:none"
      ></iframe>
      ${track.description ? `<p class="track-description">${esc(track.description)}</p>` : ''}
      ${tags ? `<div class="track-tags">${tags}</div>` : ''}
    </div>
  `;

  await loadWidgetAPI();
  initPlayer();
}

function loadWidgetAPI() {
  return new Promise(resolve => {
    if (window.SC) return resolve();
    const script = document.createElement('script');
    script.src = 'https://w.soundcloud.com/player/api.js';
    script.onload = resolve;
    document.head.appendChild(script);
  });
}

function initPlayer() {
  const iframe = document.getElementById('sc-iframe');
  const widget = SC.Widget(iframe);
  const canvas = document.querySelector('.waveform');
  const ctx = canvas.getContext('2d');
  const playBtn = document.querySelector('.play-btn');
  const timeCurrent = document.querySelector('.time-current');
  const timeTotal = document.querySelector('.time-total');
  const artworkEl = document.querySelector('.player-artwork');

  let duration = 0;
  let samples = null;
  let progress = 0;

  function fmt(ms) {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function sizeCanvas() {
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
  }

  function draw() {
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (!samples) {
      // plain progress bar fallback
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(0, h / 2 - 1, w, 2);
      ctx.fillStyle = '#b8ff00';
      ctx.fillRect(0, h / 2 - 1, w * progress, 2);
      return;
    }

    const barW = 2;
    const gap = 1;
    const step = barW + gap;
    const numBars = Math.floor(w / step);
    const bucketSize = samples.length / numBars;

    for (let i = 0; i < numBars; i++) {
      const start = Math.floor(i * bucketSize);
      const end = Math.floor((i + 1) * bucketSize);
      let peak = 0;
      for (let j = start; j < end; j++) peak = Math.max(peak, samples[j]);

      const barH = Math.max(2, peak * h);
      const x = i * step;
      const y = (h - barH) / 2;

      ctx.fillStyle = i / numBars < progress
        ? '#b8ff00'
        : 'rgba(255,255,255,0.15)';
      ctx.fillRect(x, y, barW, barH);
    }
  }

  canvas.addEventListener('click', e => {
    if (!duration) return;
    const ratio = (e.clientX - canvas.getBoundingClientRect().left) / canvas.offsetWidth;
    widget.seekTo(ratio * duration);
  });

  widget.bind(SC.Widget.Events.READY, () => {
    widget.getDuration(ms => {
      duration = ms;
      timeTotal.textContent = fmt(ms);
    });

    widget.getCurrentSound(sound => {
      const artSrc = sound.artwork_url
        ? sound.artwork_url.replace('-large.', '-t300x300.')
        : sound.user?.avatar_url?.replace('-large.', '-t300x300.');
      if (artSrc) {
        artworkEl.onload = () => { artworkEl.style.opacity = '1'; };
        artworkEl.src = artSrc;
      }

      const showPlayer = () => {
        document.querySelector('.player-loader')?.remove();
        sizeCanvas();
        draw();
        requestAnimationFrame(() => { canvas.style.opacity = '1'; });
      };

      if (sound.waveform_url) {
        fetch(sound.waveform_url.replace('.png', '.json'))
          .then(r => r.json())
          .then(data => {
            const max = data.height;
            samples = data.samples.map(v => v / max);
            showPlayer();
          })
          .catch(showPlayer);
      } else {
        showPlayer();
      }
    });
  });

  widget.bind(SC.Widget.Events.PLAY_PROGRESS, data => {
    progress = data.relativePosition;
    timeCurrent.textContent = fmt(data.currentPosition);
    draw();
  });

  widget.bind(SC.Widget.Events.PLAY, () => {
    playBtn.textContent = 'pause';
  });

  widget.bind(SC.Widget.Events.PAUSE, () => {
    playBtn.textContent = 'play';
  });

  widget.bind(SC.Widget.Events.FINISH, () => {
    playBtn.textContent = 'play';
    progress = 0;
    draw();
  });

  playBtn.addEventListener('click', () => widget.toggle());

  window.addEventListener('resize', () => {
    sizeCanvas();
    draw();
  });
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
