let tracks = [];

// Button icons
const PLAY_ICON    = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 12" width="10" height="12" fill="currentColor"><polygon points="0,0 10,6 0,12"/></svg>`;
const PAUSE_ICON   = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 11 12" width="11" height="12" fill="currentColor"><rect x="0" y="0" width="3.5" height="12"/><rect x="7.5" y="0" width="3.5" height="12"/></svg>`;
const RESTART_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" width="12" height="12" fill="currentColor"><rect x="0" y="0" width="2" height="12"/><polygon points="2,6 12,0 12,12"/></svg>`;
const SKIP_ICON    = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" width="12" height="12" fill="currentColor"><polygon points="0,0 10,6 0,12"/><rect x="10" y="0" width="2" height="12"/></svg>`;

// Cached metadata per track slug: { artworkSrc, samples }
const trackCache = {};

// Audio player — the single playing instance
const player = {
  widget: null,
  track: null,
  duration: 0,
  position: 0,
  progress: 0,
  isPlaying: false,
  loading: false,
  samples: null,
};

// Metadata widget — silent, fetches artwork + waveform on page visit
let metaWidget = null;
let loadingDotsInterval = null;

// Shuffle queue
const queue = { order: [], index: -1 };
let isScrubbing = false;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function initQueue(currentSlug) {
  const rest = shuffle(tracks.map(t => t.slug).filter(s => s !== currentSlug));
  queue.order = [currentSlug, ...rest];
  queue.index = 0;
}

async function skipToNext() {
  if (!tracks.length) return;
  if (queue.order.length === 0) initQueue(player.track?.slug ?? tracks[0].slug);
  queue.index = (queue.index + 1) % queue.order.length;
  // Reshuffle on wrap-around
  if (queue.index === 0) {
    const last = queue.order[queue.order.length - 1];
    queue.order = [last, ...shuffle(tracks.map(t => t.slug).filter(s => s !== last))];
  }
  const track = tracks.find(t => t.slug === queue.order[queue.index]);
  if (!track) return;
  await activateTrack(track);
  if (location.hash.startsWith('#/track/')) location.hash = `#/track/${track.slug}`;
}

function restartTrack() {
  if (!player.widget || !player.track) return;
  player.widget.seekTo(0);
  player.progress = 0;
  player.position = 0;
  if (trackCache[player.track.slug]) {
    trackCache[player.track.slug].progress = 0;
    trackCache[player.track.slug].position = 0;
  }
  const canvas = document.querySelector('.waveform');
  if (canvas) drawWaveform(canvas, trackCache[player.track.slug]?.samples ?? null, 0);
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

// Animated mode uses inline SVG (SMIL). Static mode uses the off-DOM img → canvas pipeline.
// Firefox with high DPI starts in static mode; all others start in animated mode.
// The user can toggle this at any time via the indicator in the bottom-left corner.
let isAnimatedMode = !(/Firefox/i.test(navigator.userAgent) && (window.devicePixelRatio || 1) > 1);

// SVG text cache — avoids re-fetching when the user toggles mode.
const svgTextCache = {};

function applyBgScale() {
  // Cover-scale all three bg layers so they fill the viewport without gaps.
  // All three use the same fixed 1280×720 CSS size, so one scale value covers all.
  const scale = Math.max(window.innerWidth / 1280, window.innerHeight / 720);
  const t = `translate(-50%, -50%) scale(${scale})`;
  document.getElementById('bg-canvas').style.transform = t;
  document.getElementById('bg-track-inline').style.transform = t;
  document.getElementById('bg-home').style.transform = t;
}

// Render a static SVG file to the background canvas using the off-DOM img pipeline.
// Chrome computes feTurbulence/feDisplacementMap at the SVG's intrinsic dimensions
// (its width/height attributes) when the image is not in the DOM — so filter patterns
// are always anchored to the SVG's canonical coordinate space regardless of viewport.
// Uses svgTextCache so mode-toggling never re-fetches the same file.
async function renderSVGToCanvas(url) {
  const canvas = document.getElementById('bg-canvas');
  if (canvas.dataset.currentSrc === url) return;
  if (!svgTextCache[url]) svgTextCache[url] = await fetch(url).then(r => r.text());
  const svgText = svgTextCache[url];
  const blob = new Blob([svgText], { type: 'image/svg+xml' });
  const objectUrl = URL.createObjectURL(blob);
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width  = Math.round(img.naturalWidth  * dpr);
      canvas.height = Math.round(img.naturalHeight * dpr);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(objectUrl);
      canvas.dataset.currentSrc = url;
      resolve();
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(); };
    img.src = objectUrl;
  });
}

async function init() {
  try {
    const res = await fetch('tracks.json');
    tracks = await res.json();
  } catch (e) {
    tracks = [];
  }

  document.querySelector('.mini-play').addEventListener('click', () => {
    player.widget?.toggle();
  });

  document.querySelector('.mini-restart').addEventListener('click', () => restartTrack());
  document.querySelector('.mini-skip').addEventListener('click', () => skipToNext());

  window.addEventListener('resize', () => {
    applyBgScale();
    const canvas = document.querySelector('.waveform');
    if (canvas) {
      canvas.width = canvas.offsetWidth;
      redrawPageWaveform();
    }
  });

  if (isAnimatedMode) document.body.classList.add('animated-mode');
  document.getElementById('animated-mode-indicator').addEventListener('click', toggleAnimatedMode);
  applyBgScale();
  route();
  window.addEventListener('hashchange', route);
}

// ─── Router ──────────────────────────────────────────────────────────────────

function setPlayBtnLoading(loading) {
  clearInterval(loadingDotsInterval);
  loadingDotsInterval = null;
  const btn = document.querySelector('.play-btn');
  if (!btn) return;
  if (loading) {
    btn.disabled = true;
    let n = 0;
    btn.textContent = '.';
    loadingDotsInterval = setInterval(() => {
      const b = document.querySelector('.play-btn');
      if (!b) { clearInterval(loadingDotsInterval); loadingDotsInterval = null; return; }
      n = (n % 3) + 1;
      b.textContent = '.'.repeat(n);
    }, 380);
  } else {
    btn.disabled = false;
    btn.innerHTML = PLAY_ICON;
  }
}

let bgHomeLoaded = false;

// Show exactly one bg layer; hide the others.
function showBg(id) {
  for (const elId of ['bg-home', 'bg-track-inline', 'bg-canvas']) {
    document.getElementById(elId).style.display = elId === id ? 'block' : 'none';
  }
}

// Fetch a track background SVG and route it to the correct pipeline.
// In animated mode: ALWAYS use inline, regardless of whether the SVG has SMIL.
//   This ensures both the animated and static variants of the same design go through
//   the exact same rendering path — Chrome computes feTurbulence at identical CSS
//   pixel dimensions for both, so the patterns match. SMIL animations play automatically.
// In static mode: canvas pipeline (off-DOM img → drawImage), no animations.
// SVG text is cached so mode-toggling never re-fetches.
async function applyTrackBg(url) {
  const inlineEl = document.getElementById('bg-track-inline');
  const canvas   = document.getElementById('bg-canvas');

  // Instant show if already rendered for the current mode.
  if (isAnimatedMode  && inlineEl.dataset.currentSrc === url) { showBg('bg-track-inline'); return; }
  if (!isAnimatedMode && canvas.dataset.currentSrc   === url) { showBg('bg-canvas'); return; }

  // Clear old bg immediately — blank is better than showing the wrong page's bg.
  showBg('bg-canvas');

  if (!svgTextCache[url]) svgTextCache[url] = await fetch(url).then(r => r.text());
  const svgText = svgTextCache[url];

  if (isAnimatedMode) {
    inlineEl.innerHTML = svgText;
    inlineEl.dataset.currentSrc = url;
    showBg('bg-track-inline');
    // Restart SMIL animations explicitly — required in Firefox when the SVG was
    // inserted into a hidden element before the container became visible.
    inlineEl.querySelectorAll('animate, animateTransform')
      .forEach(a => { try { a.beginElement(); } catch(e) {} });
  } else {
    const blob = new Blob([svgText], { type: 'image/svg+xml' });
    const objectUrl = URL.createObjectURL(blob);
    await new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const dpr = window.devicePixelRatio || 1;
        canvas.width  = Math.round(img.naturalWidth  * dpr);
        canvas.height = Math.round(img.naturalHeight * dpr);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(objectUrl);
        canvas.dataset.currentSrc = url;
        resolve();
      };
      img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(); };
      img.src = objectUrl;
    });
    showBg('bg-canvas');
  }
}

// Re-renders only the background for the current route. Called by route() and toggleAnimatedMode().
function applyCurrentBg() {
  const hash = location.hash;
  if (hash.startsWith('#/track/')) {
    const slug  = hash.slice('#/track/'.length);
    const track = tracks.find(t => t.slug === slug);
    const src   = (isAnimatedMode ? track?.background : track?.backgroundStatic)
      ?? track?.backgroundStatic ?? track?.background ?? 'svgs/bg-track.svg';
    applyTrackBg(src);
  } else {
    if (isAnimatedMode) {
      showBg('bg-home');
      if (!bgHomeLoaded) {
        bgHomeLoaded = true;
        fetch('svgs/bg-home.svg').then(r => r.text()).then(svg => {
          const el = document.getElementById('bg-home');
          el.innerHTML = svg;
          el.querySelectorAll('animate, animateTransform')
            .forEach(a => { try { a.beginElement(); } catch(e) {} });
        });
      }
    } else {
      showBg('bg-canvas');
      renderSVGToCanvas('svgs/bg-home-static.svg').then(applyBgScale);
    }
  }
}

function toggleAnimatedMode() {
  isAnimatedMode = !isAnimatedMode;
  document.body.classList.toggle('animated-mode', isAnimatedMode);
  // Invalidate pipeline caches so the new mode re-renders rather than serving stale content.
  document.getElementById('bg-track-inline').dataset.currentSrc = '';
  document.getElementById('bg-canvas').dataset.currentSrc = '';
  applyCurrentBg();
}

function route() {
  clearInterval(loadingDotsInterval);
  loadingDotsInterval = null;
  const hash = location.hash;
  const app  = document.getElementById('app');

  if (hash.startsWith('#/track/')) {
    const slug  = hash.slice('#/track/'.length);
    const track = tracks.find(t => t.slug === slug);
    applyCurrentBg();
    track ? renderTrack(app, track) : renderNotFound(app);
  } else {
    applyCurrentBg();
    renderHome(app);
  }

  window.scrollTo(0, 0);
}

// ─── Home ─────────────────────────────────────────────────────────────────────

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
      <p class="tagline">this website is a work in progress</p>
    </header>
    <ul class="track-list">${items}</ul>
  `;
}

// ─── Track page ───────────────────────────────────────────────────────────────

function renderTrack(app, track) {
  const sameSong = player.track?.slug === track.slug;
  const cached = trackCache[track.slug];
  const tags = (track.tags || []).map(tag => `<span class="tag">${esc(tag)}</span>`).join('');

  app.innerHTML = `
    <nav><a href="#/">← back</a></nav>
    <div class="track-page">
      <h1>${esc(track.title)}</h1>
      <div class="player">
        <div class="artwork-wrap">
          <img class="player-artwork" alt="${esc(track.title)}"
            ${cached?.artworkSrc ? `src="${esc(cached.artworkSrc)}" style="opacity:1"` : ''}>
        </div>
        <div class="player-main">
          ${!cached ? loaderHTML() : ''}
          <canvas class="waveform"></canvas>
          <div class="player-controls">
            <button class="restart-btn" ${!sameSong || player.loading ? 'disabled' : ''}>${RESTART_ICON}</button>
            <button class="play-btn" ${player.loading && sameSong ? 'disabled' : ''}>${player.isPlaying && sameSong ? PAUSE_ICON : (player.loading && sameSong ? '.' : PLAY_ICON)}</button>
            <button class="skip-btn">${SKIP_ICON}</button>
            <span class="player-time">
              <span class="time-current">${sameSong ? fmt(player.position) : '0:00'}</span>
              <span class="time-sep"> / </span>
              <span class="time-total">${sameSong && player.duration ? fmt(player.duration) : '0:00'}</span>
            </span>
          </div>
        </div>
      </div>
      ${track.description ? `<p class="track-description">${esc(track.description)}</p>` : ''}
      ${tags ? `<div class="track-tags">${tags}</div>` : ''}
    </div>
  `;

  const canvas = document.querySelector('.waveform');

  // Restore waveform if metadata is already cached
  if (cached) {
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    drawWaveform(canvas, cached.samples, sameSong ? player.progress : 0);
    canvas.style.opacity = '1';
  }

  // Restart dots animation if this track is still loading
  if (player.loading && sameSong) setPlayBtnLoading(true);

  // Wire up play button
  document.querySelector('.play-btn').addEventListener('click', async () => {
    if (player.track?.slug === track.slug) {
      player.widget?.toggle();
    } else {
      // Only hide the waveform and show loader if we don't already have the samples cached
      if (!trackCache[track.slug]?.samples && !document.querySelector('.player-loader')) {
        const div = document.createElement('div');
        div.innerHTML = loaderHTML();
        canvas.style.opacity = '0';
        canvas.parentElement.insertBefore(div.firstElementChild, canvas);
      }
      player.loading = true;
      setPlayBtnLoading(true);
      await activateTrack(track);
    }
  });

  // Drag-to-scrub on waveform
  function scrubAt(clientX) {
    const ratio = Math.max(0, Math.min(1, (clientX - canvas.getBoundingClientRect().left) / canvas.offsetWidth));
    player.progress = ratio;
    if (trackCache[track.slug]) trackCache[track.slug].progress = ratio;
    drawWaveform(canvas, trackCache[track.slug]?.samples ?? null, ratio);
    return ratio;
  }

  canvas.addEventListener('mousedown', e => {
    if (!player.duration || player.track?.slug !== track.slug) return;
    e.preventDefault();
    isScrubbing = true;
    scrubAt(e.clientX);
    const onMove = e => scrubAt(e.clientX);
    const onUp = e => {
      isScrubbing = false;
      player.widget?.seekTo(scrubAt(e.clientX) * player.duration);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  canvas.addEventListener('touchstart', e => {
    if (!player.duration || player.track?.slug !== track.slug) return;
    e.preventDefault();
    isScrubbing = true;
    scrubAt(e.touches[0].clientX);
    const onMove = e => { e.preventDefault(); scrubAt(e.touches[0].clientX); };
    const onEnd = e => {
      isScrubbing = false;
      player.widget?.seekTo(scrubAt(e.changedTouches[0].clientX) * player.duration);
      canvas.removeEventListener('touchmove', onMove);
      canvas.removeEventListener('touchend', onEnd);
    };
    canvas.addEventListener('touchmove', onMove, { passive: false });
    canvas.addEventListener('touchend', onEnd);
  }, { passive: false });

  document.querySelector('.restart-btn').addEventListener('click', restartTrack);
  document.querySelector('.skip-btn').addEventListener('click', () => skipToNext());

  // Kick off metadata fetch (no-op if already cached)
  fetchTrackMeta(track);
}

// ─── Metadata widget ──────────────────────────────────────────────────────────
// Loads tracks silently to retrieve artwork and waveform without touching audio.

async function fetchTrackMeta(track) {
  if (trackCache[track.slug]) return; // already cached

  await loadWidgetAPI();

  if (!metaWidget) {
    const iframe = document.getElementById('sc-meta-iframe');
    iframe.src = buildEmbedUrl(track.soundcloudUrl, false);
    metaWidget = SC.Widget(iframe);
  } else {
    metaWidget.unbind(SC.Widget.Events.READY);
    metaWidget.load(track.soundcloudUrl, {
      auto_play: false,
      hide_related: true,
      show_comments: false,
      show_user: false,
      show_reposts: false,
      show_teaser: false,
    });
  }

  metaWidget.bind(SC.Widget.Events.READY, () => {
    metaWidget.getCurrentSound(sound => {
      const artworkSrc = (sound.artwork_url || sound.user?.avatar_url)
        ?.replace('-large.', '-t300x300.') ?? null;

      const store = (samples) => {
        trackCache[track.slug] = { artworkSrc, samples, progress: 0, position: 0 };
        applyMetaToPage(track.slug);
      };

      if (sound.waveform_url) {
        fetch(sound.waveform_url.replace('.png', '.json'))
          .then(r => r.json())
          .then(data => store(data.samples.map(v => v / data.height)))
          .catch(() => store(null));
      } else {
        store(null);
      }
    });
  });
}

// Apply cached metadata to the page if the user is still viewing that track
function applyMetaToPage(slug) {
  const viewedSlug = location.hash.match(/^#\/track\/(.+)$/)?.[1];
  if (viewedSlug !== slug) return;

  const cached = trackCache[slug];
  const sameSong = player.track?.slug === slug;

  const img = document.querySelector('.player-artwork');
  if (img && !img.src && cached.artworkSrc) {
    img.onload = () => { img.style.opacity = '1'; };
    img.src = cached.artworkSrc;
  }

  document.querySelector('.player-loader')?.remove();

  // If this is the playing track, update mini bar artwork too
  if (player.track?.slug === slug) updateMiniBar();

  const canvas = document.querySelector('.waveform');
  if (canvas) {
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    drawWaveform(canvas, cached.samples, sameSong ? player.progress : 0);
    requestAnimationFrame(() => { canvas.style.opacity = '1'; });
  }
}

// ─── Audio player ─────────────────────────────────────────────────────────────

async function activateTrack(track) {
  initQueue(track.slug);
  if (!player.widget) {
    document.getElementById('sc-iframe').src = buildEmbedUrl(track.soundcloudUrl, true);
    player.track = track;
    player.loading = true;
    setPlayBtnLoading(true);
    await loadWidgetAPI();
    initPlayerWidget();
  } else {
    player.track = track;
    player.samples = null;
    player.progress = 0;
    player.position = 0;
    player.duration = 0;
    updateMiniBar();
    // Immediately redraw the waveform at 0 so the old track's progress doesn't flash
    const canvas = document.querySelector('.waveform');
    if (canvas) drawWaveform(canvas, trackCache[track.slug]?.samples ?? null, 0);
    player.widget.load(track.soundcloudUrl, {
      auto_play: true,
      hide_related: true,
      show_comments: false,
      show_user: false,
      show_reposts: false,
      show_teaser: false,
    });
  }
}

function initPlayerWidget() {
  player.widget = SC.Widget(document.getElementById('sc-iframe'));

  player.widget.bind(SC.Widget.Events.READY, () => {
    player.widget.getDuration(ms => {
      player.duration = ms;
      // Update the track page if the user is still on the playing track
      const viewedSlug = location.hash.match(/^#\/track\/(.+)$/)?.[1];
      if (viewedSlug === player.track?.slug) {
        const el = document.querySelector('.time-total');
        if (el) el.textContent = fmt(ms);
      }
    });

    player.widget.getCurrentSound(sound => {
      player.loading = false;
      setPlayBtnLoading(false);
      const restartBtn = document.querySelector('.restart-btn');
      if (restartBtn) restartBtn.disabled = false;
      const miniRestart = document.querySelector('.mini-restart');
      if (miniRestart) miniRestart.disabled = false;
      updateMiniBar();

      // Pull waveform from cache if already fetched by meta widget
      const cached = trackCache[player.track?.slug];
      if (cached?.samples) {
        player.samples = cached.samples;
        showPlayerWaveform();
      } else if (sound.waveform_url) {
        fetch(sound.waveform_url.replace('.png', '.json'))
          .then(r => r.json())
          .then(data => {
            player.samples = data.samples.map(v => v / data.height);
            // Populate cache too
            if (player.track) {
              trackCache[player.track.slug] = {
                artworkSrc: trackCache[player.track.slug]?.artworkSrc ?? null,
                samples: player.samples,
              };
            }
            showPlayerWaveform();
          })
          .catch(showPlayerWaveform);
      } else {
        showPlayerWaveform();
      }
    });
  });

  player.widget.bind(SC.Widget.Events.PLAY_PROGRESS, data => {
    player.progress = data.relativePosition;
    player.position = data.currentPosition;
    if (player.track && trackCache[player.track.slug]) {
      trackCache[player.track.slug].progress = player.progress;
      trackCache[player.track.slug].position = player.position;
    }

    document.querySelector('.mini-progress-fill').style.width = `${player.progress * 100}%`;
    document.querySelector('.mini-time').textContent =
      `${fmt(player.position)} / ${player.duration ? fmt(player.duration) : '0:00'}`;

    // Only update track page UI if viewing the currently playing track and not scrubbing
    const viewedSlug = location.hash.match(/^#\/track\/(.+)$/)?.[1];
    if (!isScrubbing && viewedSlug === player.track?.slug) {
      const canvas = document.querySelector('.waveform');
      if (canvas) {
        const samples = trackCache[player.track.slug]?.samples ?? null;
        drawWaveform(canvas, samples, player.progress);
        document.querySelector('.time-current').textContent = fmt(player.position);
      }
    }
  });

  player.widget.bind(SC.Widget.Events.PLAY, () => {
    player.isPlaying = true;
    document.querySelectorAll('.play-btn, .mini-play').forEach(b => { b.innerHTML = PAUSE_ICON; });
  });

  player.widget.bind(SC.Widget.Events.PAUSE, () => {
    player.isPlaying = false;
    document.querySelectorAll('.play-btn, .mini-play').forEach(b => { b.innerHTML = PLAY_ICON; });
  });

  player.widget.bind(SC.Widget.Events.FINISH, () => {
    player.isPlaying = false;
    player.progress = 0;
    player.position = 0;
    if (player.track && trackCache[player.track.slug]) {
      trackCache[player.track.slug].progress = 0;
      trackCache[player.track.slug].position = 0;
    }
    document.querySelectorAll('.play-btn, .mini-play').forEach(b => { b.innerHTML = PLAY_ICON; });
    const canvas = document.querySelector('.waveform');
    if (canvas) drawWaveform(canvas, trackCache[player.track?.slug]?.samples ?? null, 0);
    skipToNext();
  });
}

function showPlayerWaveform() {
  document.querySelector('.player-loader')?.remove();
  const canvas = document.querySelector('.waveform');
  if (!canvas) return;
  canvas.width = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;
  const samples = trackCache[player.track?.slug]?.samples ?? null;
  drawWaveform(canvas, samples, player.progress);
  requestAnimationFrame(() => { canvas.style.opacity = '1'; });
}

// Redraws the page waveform using whichever data is appropriate for the viewed track
function redrawPageWaveform() {
  const canvas = document.querySelector('.waveform');
  if (!canvas) return;
  const viewedSlug = location.hash.match(/^#\/track\/(.+)$/)?.[1];
  if (!viewedSlug) return;
  const sameSong = player.track?.slug === viewedSlug;
  const samples = trackCache[viewedSlug]?.samples ?? null;
  const progress = sameSong ? player.progress : 0;
  drawWaveform(canvas, samples, progress);
}

// ─── Waveform drawing ─────────────────────────────────────────────────────────

function drawWaveform(canvas, samples, progress = 0) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  if (!samples) {
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(0, h / 2 - 1, w, 2);
    if (progress > 0) {
      ctx.fillStyle = '#b8ff00';
      ctx.fillRect(0, h / 2 - 1, w * progress, 2);
    }
    return;
  }

  const barW = 2, gap = 1, step = barW + gap;
  const numBars = Math.floor(w / step);
  const bucketSize = samples.length / numBars;

  for (let i = 0; i < numBars; i++) {
    const start = Math.floor(i * bucketSize);
    const end = Math.floor((i + 1) * bucketSize);
    let peak = 0;
    for (let j = start; j < end; j++) peak = Math.max(peak, samples[j]);
    const barH = Math.max(2, peak * h);
    ctx.fillStyle = i / numBars < progress ? '#b8ff00' : 'rgba(255,255,255,0.15)';
    ctx.fillRect(i * step, (h - barH) / 2, barW, barH);
  }
}

// ─── Mini bar ─────────────────────────────────────────────────────────────────

function updateMiniBar() {
  if (!player.track) return;
  document.getElementById('mini-bar').classList.add('visible');
  document.getElementById('app').classList.add('has-mini-bar');
  document.querySelector('.mini-title').textContent = player.track.title;

  const artworkSrc = trackCache[player.track.slug]?.artworkSrc;
  if (artworkSrc) {
    const img = document.querySelector('.mini-artwork');
    if (img && img.src !== artworkSrc) {
      img.style.opacity = '0';
      img.onload = () => { img.style.opacity = '1'; };
      img.src = artworkSrc;
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loaderHTML() {
  return `<div class="player-loader">
    <svg viewBox="0 0 46 20" fill="white" xmlns="http://www.w3.org/2000/svg">
      <rect class="bar" x="0"  y="4" width="4" height="12" rx="1"/>
      <rect class="bar" x="9"  y="4" width="4" height="12" rx="1"/>
      <rect class="bar" x="18" y="4" width="4" height="12" rx="1"/>
      <rect class="bar" x="27" y="4" width="4" height="12" rx="1"/>
      <rect class="bar" x="36" y="4" width="4" height="12" rx="1"/>
    </svg>
  </div>`;
}

function buildEmbedUrl(scUrl, autoPlay = false) {
  return `https://w.soundcloud.com/player/?url=${encodeURIComponent(scUrl)}&visual=false&color=%23000000&auto_play=${autoPlay}&hide_related=true&show_comments=false&show_user=false&show_reposts=false&show_teaser=false`;
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

function renderNotFound(app) {
  app.innerHTML = `
    <nav><a href="#/">← back</a></nav>
    <p class="not-found">track not found</p>
  `;
}

function fmt(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

init();
