# weirdshape

The artist site for weirdshape, live at [weirdshape.com](https://weirdshape.com). It is a work in progress.

It is a static single-page site with no build step and no dependencies: plain HTML, CSS and JavaScript. Audio streams from SoundCloud.

## Running locally

The site fetches `tracks.json` and the background SVGs at runtime, so it has to be served over HTTP rather than opened as a file:

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Files

| Path | Purpose |
| --- | --- |
| `index.html` | Page shell: background layers, hidden SoundCloud iframes, mini player bar |
| `app.js` | Router, rendering, player, backgrounds |
| `style.css` | All styles |
| `tracks.json` | The track list (the only file to edit when adding a song) |
| `svgs/` | Backgrounds and the artwork placeholder |
| `evolve.png`, `meta.jpg` | Favicon and social preview image |
| `CNAME` | Custom domain for GitHub Pages |

## Adding a track

Add an object to the array in `tracks.json`. Tracks appear on the home page in file order.

```json
{
  "slug": "lastnight",
  "title": "Last Night",
  "year": 2026,
  "soundcloudUrl": "https://soundcloud.com/weirdshape/lastnight",
  "background": "svgs/bg-lastnight.svg",
  "backgroundStatic": "svgs/bg-lastnight-static.svg",
  "description": "notes about the song",
  "tags": ["electronic"]
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `slug` | yes | Used in the URL: `#/track/<slug>` |
| `title` | yes | |
| `year` | no | Shown next to the title on the home page |
| `soundcloudUrl` | yes | Source of the audio, artwork and waveform |
| `background` | no | Animated (SMIL) SVG, used when animations are on |
| `backgroundStatic` | no | Static SVG, used when animations are off |
| `description` | no | Line breaks are preserved |
| `tags` | no | |

If only one of the two backgrounds is set, it is used in both modes. If neither is set, the track falls back to `svgs/bg-track.svg`.

## How it works

### Routing

Routing is hash-based. `#/` is the home page and `#/track/<slug>` is a track page; an unknown slug shows "track not found". The home page pins the title at the top and scrolls only the track list.

### Player

Playback uses the SoundCloud Widget API through two hidden iframes:

- **`sc-iframe`** is the one playing instance. It keeps playing across navigation.
- **`sc-meta-iframe`** silently loads the track being viewed to get its artwork and waveform without interrupting playback. Results are cached per track for the session.

The waveform is drawn on a canvas from SoundCloud's waveform JSON, and can be dragged to scrub. Once a track has been started, a mini player bar stays at the bottom of every page.

Controls are restart, play/pause and skip. Skip, and the end of a track, move to the next song in a shuffled queue that reshuffles each time it wraps. The space bar toggles play/pause, and on a track page with nothing loaded it starts that track.

### Backgrounds

Backgrounds are SVGs that use `feTurbulence` displacement filters, drawn at 12% opacity behind the page. Every background layer is a fixed 1280×720 box scaled to cover the viewport, which keeps the filter pattern the same at any window size.

There are two rendering modes, toggled with the "animations on/off" text in the bottom-left corner:

- **Animations on**: the SVG is inlined into the DOM so its SMIL animations run. IDs are prefixed on insert so several SVGs can coexist.
- **Animations off**: the SVG is loaded as an off-DOM image and drawn once to a canvas.

Animations start on, except in Firefox on high-DPI displays, where they start off for performance.

## Deployment

The site is served by GitHub Pages from the `main` branch, so pushing to `main` publishes it.
