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
rotate_speed: 0.1           # degrees/frame-ish; higher = faster (default 0.1, slow)
max_width: 1100px
aspect_ratio: 16 / 9
max_height: 620px
home_label: Home            # text on the marker at zone.home (default "Home")
show_country_labels: false  # country name labels on, via the Labels button (default off)
zoom_altitude: 2            # initial camera distance, in globe.gl's own pointOfView altitude units (globe radii; library default is 2.5)
min_altitude: 1.02          # closest zoom-in allowed, same units - past this the texture has no more detail to show, just blur
max_altitude: 3.5           # farthest zoom-out allowed, same units
```

Drag to manually rotate, pinch/scroll to zoom within the `min_altitude`/
`max_altitude` bounds (panning is disabled - there's nowhere meaningful to
pan to on a globe). The Geographic/Satellite/Political buttons switch the
globe's imagery live; the Labels button toggles country name labels; the
play/pause button on the right toggles auto-rotation.

## How it works

- Pulls latitude/longitude from `zone.home` automatically - no location
  config needed, and the card opens centered on it (the initial
  `pointOfView` call passes `zone.home`'s lat/lng, not globe.gl's own
  default of 0,0).
- **Satellite** view: NASA Blue Marble true-color imagery.
- **Geographic** view: a shaded-relief/terrain-style map.
- **Political** view: the same photo texture as Geographic (naturally blue
  oceans) with country polygons drawn on top, each colored from a hash of
  its name (stable across reloads, but arbitrary - there's no meaningful
  legend, it's just visually distinct borders). globe.gl has no separate
  "water color" option - the base `globeImageUrl` texture is the only
  intended lever for ocean appearance, same as the other two views.
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
- Country name labels (`show_country_labels` / the Labels button) use the
  same Natural Earth dataset as the Political view, but it has no ready-made
  label coordinate (no LABEL_X/LABEL_Y field) and no area field - so each
  label's position is the plain vertex average of that country's largest
  ring, and its size is scaled (sqrt-compressed, so it's not linear) from
  that same ring's lat/lng bounding-box area, both computed once and cached
  the first time labels are turned on. Close enough to place and size a name
  tag, not precise cartography - Antarctica is excluded since its ring wraps
  most of the globe and would otherwise wreck the size scale for everyone
  else. Label color (including the Home marker's label) follows the current
  view: white on Satellite's darker imagery, black on Geographic/Political's
  lighter land colors.
- The zoom range (`min_altitude`/`max_altitude`) is enforced via the
  OrbitControls instance globe.gl exposes through `.controls()` - standard
  ThreeJS `minDistance`/`maxDistance`, not anything globe.gl-specific.

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
  The Political view (one mesh per country) is the heaviest of the three;
  renderer antialiasing is off and polygon color/data transitions are
  untweened to help. `polygonCapCurvatureResolution` is deliberately left
  at the library default (5) - coarsening it thins out the interior point
  grid `three-conic-polygon-geometry` uses to Delaunay-triangulate large
  polygons, which produced an actual rendering gap in the US outline, not
  just a performance change. If Political is still too heavy, the next
  thing to try would be simplifying the GeoJSON itself upstream (fewer
  vertices per country) rather than touching this setting again.
