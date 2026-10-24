# Globe Card

A Home Assistant Lovelace card showing an interactive, rotating 3D globe
with three switchable views - Political, Geographic, Satellite - and a
marker on your home location (read from `zone.home`). Built on the
[globe.gl](https://github.com/vasturiano/globe.gl) library (MIT), itself
built on [three-globe](https://github.com/vasturiano/three-globe) and
three.js.

**Status:** personal-use card, not published to the HACS default store.

## Install (as a HACS custom repository)

1. HACS -> the three-dot menu (top right) -> **Custom repositories**
2. Add this repo's URL, category **Lovelace**
3. Install "Globe Card" from HACS like any other frontend card
4. Settings -> Dashboards -> Resources -> add resource:
   - URL: `/hacsfiles/ha-globe-card/globe-card.js`
   - Resource type: **JavaScript Module**

## Add the card to a dashboard

```yaml
type: custom:globe-card
title: Globe              # card header text (default "Globe")
view: geographic            # geographic | satellite | political (default geographic)
autorotate: true           # starts turning automatically (default true)
rotate_speed: 0.2           # degrees/frame-ish; higher = faster (default 0.2, slow)
max_width: 1100px
aspect_ratio: 16 / 9
max_height: 620px
home_label: Home            # text on the marker at zone.home (default "Home")
political_water_color: '#1f6fb2'  # ocean color for the Political view (default a medium blue)
```

Drag to manually rotate, pinch/scroll to zoom (panning is disabled - there's
nowhere meaningful to pan to on a globe). The Geographic/Satellite/Political
buttons switch the globe's imagery live; the play/pause button on the right
toggles auto-rotation.

## How it works

- Pulls latitude/longitude from `zone.home` automatically - no location
  config needed.
- **Satellite** view: NASA Blue Marble true-color imagery.
- **Geographic** view: a shaded-relief/terrain-style map.
- **Political** view: a flat-colored ocean (`political_water_color`, no photo
  texture) with country polygons drawn on top, each country colored from a
  hash of its name (stable across reloads, but arbitrary - there's no
  meaningful legend, it's just visually distinct borders).
- All three globe textures load from three-globe's own CDN-hosted example
  assets, version-pinned. The Political view's country boundaries (Natural
  Earth 1:110m admin-0 countries, public domain) come from globe.gl's GitHub
  repo via jsDelivr's GitHub proxy mode, pinned to a specific commit (jsDelivr
  caches a branch ref as if it were immutable, so a plain `@master` URL would
  silently never pick up a later update to that file).
- globe.gl itself is loaded from a version-pinned npm CDN URL - no vendoring
  needed, since it's MIT-licensed with no ambiguity to resolve (unlike
  [ha-nightsky-card](https://github.com/jpmiller25/ha-nightsky-card), whose
  underlying library has an unresolved licensing question).

## Known limitations

- The Political view's country colors are arbitrary (hash-based), not a
  meaningful choropleth. Fine for "which country is which at a glance,"
  not for showing any actual data per-country.
- No day/night shading or clouds layer - could be added later if wanted,
  globe.gl supports both.
- Performance on lower-powered kiosk hardware (e.g. a Raspberry Pi) is
  untested - this is a WebGL 3D scene with continuous auto-rotation, which
  is meaningfully heavier than nightsky-card's 2D canvas rendering. Worth
  watching for dropped frames or high CPU/GPU usage if deployed to one.
