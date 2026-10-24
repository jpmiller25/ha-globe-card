// Globe Card - an interactive, rotating 3D globe Home Assistant Lovelace card
// with switchable Political / Geographic / Satellite views and a marker on
// your home location, rendered with the globe.gl library (MIT-licensed,
// https://github.com/vasturiano/globe.gl, built on three.js/three-globe).
//
// Unlike nightsky-card, globe.gl is loaded straight off a version-pinned npm
// CDN URL rather than vendored - it's MIT licensed with no open licensing
// question to resolve, and `new Globe(domElement)` takes the actual DOM node
// instead of a string selector, so it has no shadow-DOM lookup problem to
// patch around.
const GLOBEGL_URL = 'https://cdn.jsdelivr.net/npm/globe.gl@2.46.2';

// three-globe ships the example globe textures used below, also version-pinned.
const TEXTURE_BASE = 'https://cdn.jsdelivr.net/npm/three-globe@2.45.6/example/img/';
const SATELLITE_IMG = TEXTURE_BASE + 'earth-blue-marble.jpg';
const GEOGRAPHIC_IMG = TEXTURE_BASE + 'earth-day.jpg';
const TOPOLOGY_IMG = TEXTURE_BASE + 'earth-topology.png';

// The Natural Earth country-boundary GeoJSON used for the Political view
// lives only in globe.gl's example/ folder, not published to npm - so this
// has to go through jsDelivr's GitHub proxy mode instead. Pinned to a commit
// (not @master) for the same reason nightsky-card pins VENDOR_COMMIT: a
// branch ref gets cached as if it were immutable, so a later update to that
// file would silently never reach already-loaded dashboards.
const COUNTRIES_COMMIT = '6820a9c794bddde8e842bb203eaa698f6ed7adfe';
const COUNTRIES_URL = `https://cdn.jsdelivr.net/gh/vasturiano/globe.gl@${COUNTRIES_COMMIT}/example/datasets/ne_110m_admin_0_countries.geojson`;

let libPromise = null;
function ensureLibLoaded() {
  if (!libPromise) {
    libPromise = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = GLOBEGL_URL;
      el.onload = () => (window.Globe ? resolve() : reject(new Error('globe-card: globe.gl loaded but window.Globe is missing')));
      el.onerror = () => reject(new Error(`globe-card: failed to load ${GLOBEGL_URL}`));
      document.head.appendChild(el);
    });
  }
  return libPromise;
}

// Shared across every card instance on a dashboard - the country boundaries
// never change per-instance, so there's no reason to fetch this file twice.
let countriesPromise = null;
function ensureCountriesLoaded() {
  if (!countriesPromise) {
    countriesPromise = fetch(COUNTRIES_URL).then((r) => r.json());
  }
  return countriesPromise;
}

// Countries have no inherent color - this picks a stable, distinct-looking
// one per country from its ISO code so the same country is always the same
// color across reloads, without needing a fixed lookup table of ~180 colors.
function countryColor(feat) {
  const key = (feat.properties && (feat.properties.ISO_A3 || feat.properties.NAME)) || '?';
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360}, 55%, 55%)`;
}

// The Natural Earth dataset has no ready-made label point (no LABEL_X/
// LABEL_Y field - just LABELRANK, a display-priority number, not a
// coordinate), so there's no library-provided place to put a country name.
// This derives a rough visual center instead: the plain vertex average of
// the country's largest ring (by point count, as a stand-in for "biggest
// landmass" - not a true area-weighted centroid, but close enough for
// placing a name, and cheap). Computed once per country the first time
// labels are turned on, then cached.
function countryCentroid(feat) {
  const geom = feat.geometry;
  const rings = geom.type === 'Polygon' ? [geom.coordinates[0]] : geom.coordinates.map((poly) => poly[0]);
  const largest = rings.reduce((a, b) => (b.length > a.length ? b : a));
  let lng = 0;
  let lat = 0;
  largest.forEach(([x, y]) => {
    lng += x;
    lat += y;
  });
  return { lat: lat / largest.length, lng: lng / largest.length };
}

// Shared across every card instance, same reasoning as ensureCountriesLoaded.
let countryLabelsPromise = null;
function ensureCountryLabelsLoaded() {
  if (!countryLabelsPromise) {
    countryLabelsPromise = ensureCountriesLoaded().then((geo) =>
      geo.features.map((feat) => {
        const c = countryCentroid(feat);
        return { kind: 'country', lat: c.lat, lng: c.lng, text: feat.properties.NAME };
      })
    );
  }
  return countryLabelsPromise;
}

const VIEWS = ['geographic', 'satellite', 'political'];

const DEFAULT_CONFIG = {
  title: 'Globe',
  view: 'geographic',
  autorotate: true,
  rotate_speed: 0.2,
  max_width: '1100px',
  aspect_ratio: '16 / 9',
  max_height: '620px',
  home_label: 'Home',
  show_country_labels: false,
  // All three below are globe.gl's own pointOfView "altitude" units (camera
  // distance as a multiple of the globe's radius - library default is 2.5).
  // Smaller = more zoomed in/closer to the surface.
  zoom_altitude: 2, // initial camera distance
  min_altitude: 1.1, // closest zoom-in allowed - past this the base texture just looks blurry, it has no more detail to show
  max_altitude: 3.5, // farthest zoom-out allowed
};

class GlobeCard extends HTMLElement {
  setConfig(config) {
    if (config.view && !VIEWS.includes(config.view)) {
      throw new Error(`globe-card: view must be one of ${VIEWS.join(', ')}`);
    }
    this._config = { ...DEFAULT_CONFIG, ...config };
    this._maybeInit();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._latlong) {
      const zone = hass.states['zone.home'];
      if (zone && zone.attributes.latitude != null) {
        this._latlong = {
          lat: zone.attributes.latitude,
          lng: zone.attributes.longitude,
        };
        this._maybeInit();
      }
    }
  }

  connectedCallback() {
    if (this._built) return;
    this._built = true;
    this._uid = 'globe-' + Math.random().toString(36).slice(2);
    const cfg = this._config || DEFAULT_CONFIG;
    // Same panel-view flex-item fix nightsky-card needed: without
    // min-width:0, this element (and ha-card below it) can't shrink below
    // the globe canvas's intrinsic width, and the view scrolls horizontally
    // instead of the card clamping to its container.
    this.style.cssText = 'display:block;min-width:0;height:auto!important;align-self:flex-start;';
    this.innerHTML = `
      <ha-card header="${cfg.title}" style="overflow:hidden;width:min(100%, ${cfg.max_width});min-width:0;margin:0 auto;height:auto!important;align-self:flex-start;--ha-card-border-radius:12px;--ha-card-box-shadow:0px 2px 8px rgba(0,0,0,0.3);">
        <div style="position:relative;width:100%;aspect-ratio:${cfg.aspect_ratio};max-height:${cfg.max_height};background:#000;">
          <div id="${this._uid}" style="width:100%;height:100%;overflow:hidden;"></div>
          <div style="position:absolute;bottom:10px;left:10px;display:flex;gap:6px;">
            <button class="gc-view" data-view="geographic" style="font-size:18px;padding:6px 12px;">Geographic</button>
            <button class="gc-view" data-view="satellite" style="font-size:18px;padding:6px 12px;">Satellite</button>
            <button class="gc-view" data-view="political" style="font-size:18px;padding:6px 12px;">Political</button>
          </div>
          <div style="position:absolute;bottom:10px;right:10px;display:flex;gap:6px;">
            <button class="gc-labels-toggle" style="font-size:18px;padding:6px 12px;">Labels</button>
            <button class="gc-playpause" style="font-size:22px;padding:6px 16px;"></button>
          </div>
        </div>
      </ha-card>
    `;
    this._container = this.querySelector('#' + this._uid);
    this._playPauseBtn = this.querySelector('.gc-playpause');
    this._labelsToggleBtn = this.querySelector('.gc-labels-toggle');
    this.querySelectorAll('.gc-view').forEach((btn) => {
      btn.addEventListener('click', () => this._applyView(btn.dataset.view));
    });
    this._playPauseBtn.addEventListener('click', () => this._setAutoRotate(!this._config.autorotate));
    this._labelsToggleBtn.addEventListener('click', () => this._setLabelsVisible(!this._config.show_country_labels));
    this._maybeInit();
  }

  getCardSize() {
    return 4;
  }

  // Only initialize once we have: the DOM container, the config, AND the
  // home coordinates from hass - these three arrive in no particular order.
  _maybeInit() {
    if (this._globe || !this._container || !this._config || !this._latlong) return;
    ensureLibLoaded().then(
      () => this._createGlobe(),
      (err) => this._showError(err)
    );
  }

  _showError(err) {
    console.error('globe-card:', err);
    if (this._container) {
      this._container.innerHTML = `<div style="color:#f88;padding:12px;font-size:13px;">Globe Card failed to load: ${err.message || err}</div>`;
    }
  }

  _createGlobe() {
    this._home = { kind: 'home', lat: this._latlong.lat, lng: this._latlong.lng, text: this._config.home_label };

    this._globe = new window.Globe(this._container, { rendererConfig: { antialias: false } })
      .backgroundColor('rgba(0,0,0,0)')
      .pointsData([this._home])
      .pointColor(() => '#ffffff')
      .pointAltitude(0.02)
      .pointRadius(0.4)
      .labelsData([this._home])
      .labelText('text')
      .labelSize((d) => (d.kind === 'home' ? 1.4 : 0.55))
      .labelColor((d) => (d.kind === 'home' ? '#ffffff' : 'rgba(255,255,255,0.85)'))
      .labelDotRadius((d) => (d.kind === 'home' ? 0.3 : 0))
      .labelAltitude((d) => (d.kind === 'home' ? 0.021 : 0.006))
      .labelResolution(2)
      // Political's country polygons are the heaviest thing this card draws
      // (one mesh per country) - antialias off above and no transition-
      // tweening on data changes both cut real cost there with no visual
      // downside. polygonCapCurvatureResolution is deliberately left at
      // three-globe's own default (5) - coarsening it (tried 10) measurably
      // thins out the interior point grid the underlying
      // three-conic-polygon-geometry library uses for large polygons'
      // Delaunay triangulation, and for a complex shape like the US outline
      // that produced an actual rendering gap (a patch of the base texture
      // showing through instead of the country's fill), not just a
      // cosmetic change. Not worth it for the perf gain.
      .polygonsTransitionDuration(0);

    const controls = this._globe.controls();
    controls.enablePan = false;
    controls.autoRotateSpeed = this._config.rotate_speed;

    // pointOfView's altitude is the camera's distance in globe-radius units
    // (library default 2.5); reading the resulting camera distance back
    // gives the actual world-units-per-altitude-unit scale, so minDistance/
    // maxDistance can be derived from the configured altitude limits without
    // having to assume/hardcode three-globe's internal globe radius.
    this._globe.pointOfView({ altitude: this._config.zoom_altitude });
    const unitDistance = controls.object.position.length() / this._config.zoom_altitude;
    controls.minDistance = unitDistance * this._config.min_altitude;
    controls.maxDistance = unitDistance * this._config.max_altitude;

    this._applyView(this._config.view);
    this._setLabelsVisible(this._config.show_country_labels);
    this._setAutoRotate(this._config.autorotate);
    this._wireResize();
    // Starting size: the ResizeObserver only fires on a later size *change*,
    // so without this the globe is born at container's size-at-construction-
    // time, which can be 0x0 if the card's layout hadn't settled yet.
    this._resizeToContainer();
  }

  _applyView(view) {
    this._config.view = view;
    this.querySelectorAll('.gc-view').forEach((btn) => {
      const active = btn.dataset.view === view;
      btn.style.background = active ? '#444' : '';
      btn.style.fontWeight = active ? 'bold' : '';
    });

    if (view === 'satellite') {
      this._globe.globeImageUrl(SATELLITE_IMG).bumpImageUrl(TOPOLOGY_IMG).polygonsData([]);
    } else if (view === 'geographic') {
      this._globe.globeImageUrl(GEOGRAPHIC_IMG).bumpImageUrl(TOPOLOGY_IMG).polygonsData([]);
    } else if (view === 'political') {
      // Same photo texture as Geographic (its oceans are naturally blue) -
      // the country polygons drawn on top are what make this view read as
      // "political" rather than the base texture, same approach globe.gl's
      // own choropleth-countries example uses.
      this._globe.globeImageUrl(GEOGRAPHIC_IMG).bumpImageUrl(TOPOLOGY_IMG).polygonsData([]);
      ensureCountriesLoaded().then((geo) => {
        if (this._config.view !== 'political') return; // user switched away while this was loading
        this._globe
          .polygonsData(geo.features)
          .polygonCapColor(countryColor)
          .polygonSideColor(() => 'rgba(0,0,0,0.15)')
          .polygonStrokeColor(() => '#1a1a1a')
          .polygonAltitude(0.006);
      });
    }
  }

  _setAutoRotate(on) {
    this._config.autorotate = on;
    this._globe.controls().autoRotate = on;
    this._playPauseBtn.textContent = on ? '⏸' : '▶';
  }

  _setLabelsVisible(on) {
    this._config.show_country_labels = on;
    this._labelsToggleBtn.style.background = on ? '#444' : '';
    this._labelsToggleBtn.style.fontWeight = on ? 'bold' : '';

    if (!on) {
      this._globe.labelsData([this._home]);
      return;
    }
    ensureCountryLabelsLoaded().then((countryLabels) => {
      if (!this._config.show_country_labels) return; // toggled off again while this was loading
      this._globe.labelsData([this._home, ...countryLabels]);
    });
  }

  _resizeToContainer() {
    if (!this._globe || !this._container) return;
    const { clientWidth, clientHeight } = this._container;
    if (clientWidth > 0 && clientHeight > 0) {
      this._globe.width(clientWidth).height(clientHeight);
    }
  }

  // The container's CSS size (height follows aspect-ratio, see
  // DEFAULT_CONFIG) can change after creation - window resize, sidebar
  // toggle, dashboard layout settling, etc. globe.gl doesn't track its
  // container's size on its own, so without this the renderer stays
  // whatever size it happened to be born at.
  _wireResize() {
    let pending = false;
    const observer = new ResizeObserver(() => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        this._resizeToContainer();
      });
    });
    observer.observe(this._container);
    this._resizeObserver = observer;
  }

  disconnectedCallback() {
    if (this._resizeObserver) this._resizeObserver.disconnect();
  }
}

customElements.define('globe-card', GlobeCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'globe-card',
  name: 'Globe Card',
  description: 'An interactive rotating 3D globe (political/geographic/satellite) with a marker on your home location.',
});
