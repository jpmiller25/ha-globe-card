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

// Used when `home_entity` doesn't exist or has no latitude/longitude
// attributes - the equator, mid-Atlantic, roughly halfway between the
// Brazilian and African coastlines. Open ocean, nowhere near a border or
// landmark, so a misconfigured card reads as "not pointing anywhere real"
// rather than looking like a deliberate (if odd) location choice.
const FALLBACK_LATLNG = { lat: 0, lng: -21 };

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
// coordinate) and no area field either, so there's no library-provided place
// to put a country name or size it by country size. This derives both from
// the country's largest ring (by point count, as a stand-in for "biggest
// landmass" - island nations and far-flung territories are ignored, not
// worth the complexity for a name tag): its vertex average as a rough visual
// center, and its lat/lng bounding-box area as a rough size proxy (not true
// geographic area, but cheap, and enough to tell Russia from Luxembourg).
// Longitude is unwrapped across the antimeridian when a ring's raw span
// looks bogus (>180 degrees) - Russia's mainland ring genuinely crosses it,
// and a naive min/max would otherwise read it as stretching almost all the
// way around the globe instead of ~100 degrees.
function countryLabelInfo(feat) {
  const geom = feat.geometry;
  const rings = geom.type === 'Polygon' ? [geom.coordinates[0]] : geom.coordinates.map((poly) => poly[0]);
  const largest = rings.reduce((a, b) => (b.length > a.length ? b : a));

  let lngSum = 0;
  let latSum = 0;
  let lngs = [];
  const lats = [];
  largest.forEach(([x, y]) => {
    lngSum += x;
    latSum += y;
    lngs.push(x);
    lats.push(y);
  });

  if (Math.max(...lngs) - Math.min(...lngs) > 180) {
    lngs = lngs.map((x) => (x < 0 ? x + 360 : x));
  }
  const area = (Math.max(...lngs) - Math.min(...lngs)) * (Math.max(...lats) - Math.min(...lats));

  return {
    lat: latSum / largest.length,
    lng: lngSum / largest.length,
    text: feat.properties.NAME,
    area,
  };
}

const COUNTRY_LABEL_MIN_SIZE = 0.45;
const COUNTRY_LABEL_MAX_SIZE = 1.5;

// Shared across every card instance, same reasoning as ensureCountriesLoaded.
let countryLabelsPromise = null;
function ensureCountryLabelsLoaded() {
  if (!countryLabelsPromise) {
    countryLabelsPromise = ensureCountriesLoaded().then((geo) => {
      // Antarctica's ring wraps nearly the full globe east-west (it's drawn
      // as a band around the pole, not an ordinary landmass outline), which
      // blows out its bounding-box "area" far past every real country and
      // badly skews the min/max size scale for everyone else. Left off the
      // label list entirely rather than special-cased into the scale.
      const infos = geo.features.filter((f) => f.properties.CONTINENT !== 'Antarctica').map(countryLabelInfo);
      // sqrt compresses the dynamic range (area, not linear size, is what
      // varies country-to-country) before spreading it across the min/max
      // label size range, so the biggest countries don't dwarf everything
      // else into illegibility.
      const scaled = infos.map((info) => Math.sqrt(info.area));
      const lo = Math.min(...scaled);
      const hi = Math.max(...scaled);
      return infos.map((info, i) => ({
        kind: 'country',
        lat: info.lat,
        lng: info.lng,
        text: info.text,
        size: COUNTRY_LABEL_MIN_SIZE + ((scaled[i] - lo) / (hi - lo)) * (COUNTRY_LABEL_MAX_SIZE - COUNTRY_LABEL_MIN_SIZE),
      }));
    });
  }
  return countryLabelsPromise;
}

const VIEWS = ['geographic', 'satellite', 'political'];
const VIEW_LABELS = { geographic: 'Geographic', satellite: 'Satellite', political: 'Political' };

const DEFAULT_CONFIG = {
  title: 'Globe',
  show_header: true,
  view: 'geographic',
  views: ['geographic', 'satellite', 'political'], // which view buttons are shown, and in what order
  autorotate: true,
  rotate_speed: 0.1,
  allow_zoom: true,
  show_play_pause: true,
  max_width: '1100px',
  aspect_ratio: '16 / 9',
  max_height: '620px',
  home_entity: 'zone.home', // any entity with latitude/longitude attributes - zone, person, device_tracker
  home_label: 'Home',
  show_home_icon: true,
  show_country_labels: false,
  // Label text color per view - defaults match the original hardcoded rule
  // (white reads on Satellite's darker imagery, black on the lighter
  // Geographic/Political land colors). Any CSS color string works.
  label_color_geographic: '#000000',
  label_color_satellite: '#ffffff',
  label_color_political: '#000000',
  // All three below are globe.gl's own pointOfView "altitude" units (camera
  // distance as a multiple of the globe's radius - library default is 2.5).
  // Smaller = more zoomed in/closer to the surface.
  zoom_altitude: 2, // initial camera distance
  min_altitude: 1.02, // closest zoom-in allowed - past this the base texture just looks blurry, it has no more detail to show
  max_altitude: 3.5, // farthest zoom-out allowed
};

// GUI configuration editor, backed by Home Assistant's own <ha-form> element
// (the same one the built-in cards use) rather than hand-built inputs - it
// already knows how to render an entity picker, booleans, numbers, and
// grouped/expandable sections from a plain schema array, so there's no
// custom widget code to write or validate here.
const EDITOR_SCHEMA = [
  { name: 'home_entity', selector: { entity: { domain: ['zone', 'person', 'device_tracker'] } } },
  { name: 'show_home_icon', selector: { boolean: {} } },
  { name: 'home_label', selector: { text: {} } },
  { name: 'view', selector: { select: { mode: 'dropdown', options: VIEWS.map((v) => ({ value: v, label: VIEW_LABELS[v] })) } } },
  { name: 'views', selector: { select: { multiple: true, mode: 'list', options: VIEWS.map((v) => ({ value: v, label: VIEW_LABELS[v] })) } } },
  { name: 'show_country_labels', selector: { boolean: {} } },
  { name: 'show_play_pause', selector: { boolean: {} } },
  { name: 'show_header', selector: { boolean: {} } },
  { name: 'title', selector: { text: {} } },
  {
    name: 'label_colors',
    type: 'expandable',
    title: 'Label colors',
    schema: [
      { name: 'label_color_geographic', selector: { text: {} } },
      { name: 'label_color_satellite', selector: { text: {} } },
      { name: 'label_color_political', selector: { text: {} } },
    ],
  },
  {
    name: 'rotation_zoom',
    type: 'expandable',
    title: 'Rotation & zoom',
    schema: [
      { name: 'autorotate', selector: { boolean: {} } },
      { name: 'rotate_speed', selector: { number: { min: 0.01, max: 2, step: 0.01, mode: 'box' } } },
      { name: 'allow_zoom', selector: { boolean: {} } },
      { name: 'zoom_altitude', selector: { number: { min: 1, max: 10, step: 0.1, mode: 'box' } } },
      { name: 'min_altitude', selector: { number: { min: 1, max: 10, step: 0.01, mode: 'box' } } },
      { name: 'max_altitude', selector: { number: { min: 1, max: 10, step: 0.1, mode: 'box' } } },
    ],
  },
  {
    name: 'sizing',
    type: 'expandable',
    title: 'Card size',
    schema: [
      { name: 'max_width', selector: { text: {} } },
      { name: 'aspect_ratio', selector: { text: {} } },
      { name: 'max_height', selector: { text: {} } },
    ],
  },
];

const EDITOR_LABELS = {
  home_entity: 'Home entity',
  show_home_icon: 'Show home marker',
  home_label: 'Home marker label',
  view: 'Default view',
  views: 'Available view buttons',
  show_country_labels: 'Country labels on by default',
  show_play_pause: 'Show play/pause button',
  show_header: 'Show card header',
  title: 'Card title',
  label_color_geographic: 'Geographic view',
  label_color_satellite: 'Satellite view',
  label_color_political: 'Political view',
  autorotate: 'Auto-rotate by default',
  rotate_speed: 'Rotation speed',
  allow_zoom: 'Allow zoom',
  zoom_altitude: 'Initial zoom (altitude)',
  min_altitude: 'Closest zoom-in allowed (altitude)',
  max_altitude: 'Farthest zoom-out allowed (altitude)',
  max_width: 'Max width (CSS)',
  aspect_ratio: 'Aspect ratio (CSS)',
  max_height: 'Max height (CSS)',
};

class GlobeCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
  }

  connectedCallback() {
    this._render();
  }

  _render() {
    if (!this._config) return;
    if (!this._form) {
      this._form = document.createElement('ha-form');
      this._form.addEventListener('value-changed', (ev) => {
        ev.stopPropagation();
        this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: ev.detail.value } }));
      });
      this.innerHTML = '';
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.data = { ...DEFAULT_CONFIG, ...this._config };
    this._form.schema = EDITOR_SCHEMA;
    this._form.computeLabel = (schema) => EDITOR_LABELS[schema.name] || schema.name;
  }
}

customElements.define('globe-card-editor', GlobeCardEditor);

class GlobeCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement('globe-card-editor');
  }

  static getStubConfig() {
    return { ...DEFAULT_CONFIG };
  }

  setConfig(config) {
    if (config.view && !VIEWS.includes(config.view)) {
      throw new Error(`globe-card: view must be one of ${VIEWS.join(', ')}`);
    }
    const prevView = this._config && this._config.view;

    const merged = { ...DEFAULT_CONFIG, ...config };
    let views = Array.isArray(config.views) ? config.views.filter((v) => VIEWS.includes(v)) : DEFAULT_CONFIG.views;
    if (!views.length) views = DEFAULT_CONFIG.views;
    if (!views.includes(merged.view)) merged.view = views[0]; // e.g. default view got excluded from the enabled-views list
    merged.views = views;

    this._config = merged;
    this._resolveHomeLocation();

    // setConfig can be called again on an already-built, already-rendered
    // card - the GUI editor's live preview does exactly this on every field
    // change. Re-apply whatever changed instead of assuming this is always
    // the first/only call.
    if (this._built) {
      this._applyHeaderAndSize();
      this._renderToolbar();
    }
    if (this._globe) {
      this._applyConfigToGlobe(prevView);
    }
    this._maybeInit();
  }

  set hass(hass) {
    this._hass = hass;
    this._resolveHomeLocation();
  }

  // Resolves `home_entity` to a lat/lng, falling back to FALLBACK_LATLNG if
  // the entity doesn't exist or has no latitude/longitude attributes. Cheap
  // to call on every hass update (it's called on every one, since `hass` is
  // set on every state change anywhere in HA, not just this entity) because
  // it bails out immediately unless the entity id or its resolved coordinate
  // actually changed - so it also doubles as "recover once the entity shows
  // up" and "follow a moving person/device_tracker" without extra plumbing.
  _resolveHomeLocation() {
    if (!this._hass || !this._config) return;
    const entityId = this._config.home_entity || DEFAULT_CONFIG.home_entity;
    const state = this._hass.states[entityId];
    const lat = state && state.attributes.latitude;
    const lng = state && state.attributes.longitude;
    const resolved = lat != null && lng != null ? { lat, lng } : FALLBACK_LATLNG;

    const unchanged =
      this._resolvedEntityId === entityId && this._latlong && this._latlong.lat === resolved.lat && this._latlong.lng === resolved.lng;
    if (unchanged) return;

    this._resolvedEntityId = entityId;
    this._latlong = resolved;

    if (this._globe) {
      this._applyHomeMarker();
    } else {
      this._maybeInit();
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
      <ha-card style="overflow:hidden;min-width:0;margin:0 auto;height:auto!important;align-self:flex-start;--ha-card-border-radius:12px;--ha-card-box-shadow:0px 2px 8px rgba(0,0,0,0.3);">
        <div class="gc-aspect" style="position:relative;width:100%;background:#000;">
          <div id="${this._uid}" style="width:100%;height:100%;overflow:hidden;"></div>
          <div class="gc-view-row" style="position:absolute;bottom:10px;left:10px;display:flex;gap:6px;"></div>
          <div class="gc-control-row" style="position:absolute;bottom:10px;right:10px;display:flex;gap:6px;"></div>
        </div>
      </ha-card>
    `;
    this._cardEl = this.querySelector('ha-card');
    this._aspectEl = this.querySelector('.gc-aspect');
    this._container = this.querySelector('#' + this._uid);
    this._applyHeaderAndSize();
    this._renderToolbar();
    this._maybeInit();
  }

  getCardSize() {
    return 4;
  }

  _applyHeaderAndSize() {
    if (!this._cardEl) return;
    if (this._config.show_header) {
      this._cardEl.setAttribute('header', this._config.title);
    } else {
      this._cardEl.removeAttribute('header');
    }
    this._cardEl.style.width = `min(100%, ${this._config.max_width})`;
    this._aspectEl.style.aspectRatio = this._config.aspect_ratio;
    this._aspectEl.style.maxHeight = this._config.max_height;
  }

  // Rebuilds only the two button-row overlays, never the canvas container
  // (#uid div) - globe.gl/three.js hold a live reference to that exact DOM
  // node, so recreating it would tear down and need to recreate the whole
  // WebGL scene. Called at startup and whenever the GUI editor's live
  // preview changes something that affects which buttons exist.
  _renderToolbar() {
    const viewRow = this.querySelector('.gc-view-row');
    const controlRow = this.querySelector('.gc-control-row');
    if (!viewRow || !controlRow) return;

    viewRow.innerHTML = this._config.views
      .map((v) => `<button class="gc-view" data-view="${v}" style="font-size:18px;padding:6px 12px;">${VIEW_LABELS[v]}</button>`)
      .join('');
    viewRow.querySelectorAll('.gc-view').forEach((btn) => {
      btn.addEventListener('click', () => this._applyView(btn.dataset.view));
    });

    controlRow.innerHTML = `
      <button class="gc-labels-toggle" style="font-size:18px;padding:6px 12px;">Labels</button>
      ${this._config.show_play_pause ? '<button class="gc-playpause" style="font-size:22px;padding:6px 16px;"></button>' : ''}
    `;
    this._labelsToggleBtn = controlRow.querySelector('.gc-labels-toggle');
    this._labelsToggleBtn.addEventListener('click', () => this._setLabelsVisible(!this._config.show_country_labels));
    this._playPauseBtn = controlRow.querySelector('.gc-playpause');
    if (this._playPauseBtn) {
      this._playPauseBtn.addEventListener('click', () => this._setAutoRotate(!this._config.autorotate));
    }

    this._reflectToolbarState();
  }

  // Re-applies current state (active view, labels-on, play/pause icon) onto
  // whatever button DOM nodes exist right now - needed after _renderToolbar
  // rebuilds them from scratch, since the new nodes start with no memory of it.
  _reflectToolbarState() {
    this.querySelectorAll('.gc-view').forEach((btn) => {
      const active = btn.dataset.view === this._config.view;
      btn.style.background = active ? '#444' : '';
      btn.style.fontWeight = active ? 'bold' : '';
    });
    if (this._labelsToggleBtn) {
      this._labelsToggleBtn.style.background = this._config.show_country_labels ? '#444' : '';
      this._labelsToggleBtn.style.fontWeight = this._config.show_country_labels ? 'bold' : '';
    }
    if (this._playPauseBtn) {
      this._playPauseBtn.textContent = this._config.autorotate ? '⏸' : '▶';
    }
  }

  // Only initialize once we have: the DOM container, the config, AND the
  // home coordinates - these three arrive in no particular order.
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
    this._globe = new window.Globe(this._container, { rendererConfig: { antialias: false } })
      .backgroundColor('rgba(0,0,0,0)')
      .pointColor(() => '#ffffff')
      .pointAltitude(0.02)
      .pointRadius(0.4)
      .labelText('text')
      .labelSize((d) => (d.kind === 'home' ? 1.4 : d.size))
      .labelColor(() => this._config[`label_color_${this._config.view}`] || '#000000')
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
    controls.enableZoom = this._config.allow_zoom;

    // pointOfView's altitude is the camera's distance in globe-radius units
    // (library default 2.5); reading the resulting camera distance back
    // gives the actual world-units-per-altitude-unit scale, cached so later
    // zoom-bound recalculation (e.g. from a GUI editor change) doesn't need
    // to assume/hardcode three-globe's internal globe radius, and doesn't
    // get thrown off by the user having manually zoomed since.
    this._globe.pointOfView({ lat: this._latlong.lat, lng: this._latlong.lng, altitude: this._config.zoom_altitude });
    this._unitDistance = controls.object.position.length() / this._config.zoom_altitude;
    this._applyZoomBounds();

    this._applyHomeMarker();
    this._applyView(this._config.view);
    this._setAutoRotate(this._config.autorotate);
    this._reflectToolbarState();
    this._wireResize();
    // Starting size: the ResizeObserver only fires on a later size *change*,
    // so without this the globe is born at container's size-at-construction-
    // time, which can be 0x0 if the card's layout hadn't settled yet.
    this._resizeToContainer();
  }

  _applyZoomBounds() {
    const controls = this._globe.controls();
    controls.minDistance = this._unitDistance * this._config.min_altitude;
    controls.maxDistance = this._unitDistance * this._config.max_altitude;
  }

  // Re-applies config to an already-created globe instance - used when
  // setConfig runs again after _createGlobe already has (GUI editor live
  // preview, or a dashboard YAML edit that doesn't recreate the element).
  _applyConfigToGlobe(prevView) {
    const controls = this._globe.controls();
    controls.autoRotate = this._config.autorotate;
    controls.autoRotateSpeed = this._config.rotate_speed;
    controls.enableZoom = this._config.allow_zoom;
    this._applyZoomBounds();
    this._applyHomeMarker();
    if (this._config.view !== prevView) {
      this._applyView(this._config.view);
    } else {
      this._refreshLabels(); // picks up label-color changes even without a view change
    }
    this._reflectToolbarState();
  }

  _applyHomeMarker() {
    this._home = { kind: 'home', lat: this._latlong.lat, lng: this._latlong.lng, text: this._config.home_label };
    this._globe.pointsData(this._config.show_home_icon ? [this._home] : []);
    this._refreshLabels();
  }

  _applyView(view) {
    this._config.view = view;

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

    // labelColor's accessor reads this._config.view, but accessors only get
    // re-run when the labels layer's data is re-set, not just because the
    // view changed out from under it - so force that re-evaluation here.
    this._refreshLabels();
    this._reflectToolbarState();
  }

  _setAutoRotate(on) {
    this._config.autorotate = on;
    this._globe.controls().autoRotate = on;
    this._reflectToolbarState();
  }

  _setLabelsVisible(on) {
    this._config.show_country_labels = on;
    this._refreshLabels();
    this._reflectToolbarState();
  }

  _refreshLabels() {
    const home = this._config.show_home_icon ? [this._home] : [];
    if (!this._config.show_country_labels) {
      this._globe.labelsData(home);
      return;
    }
    ensureCountryLabelsLoaded().then((countryLabels) => {
      if (!this._config.show_country_labels) return; // toggled off again while this was loading
      this._globe.labelsData([...home, ...countryLabels]);
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
