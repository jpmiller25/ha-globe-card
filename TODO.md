# TODO

## GUI configuration editor

This card is YAML-only right now - no Lovelace visual editor
(`getConfigElement()`/`getStubConfig()`). That's fine for personal use, but
not for a card published to the HACS default store, where people expect to
configure it without hand-writing YAML. Not planning to submit to HACS
until at least the items below exist.

- [ ] Home entity selector - a GUI entity picker to choose which entity's
      lat/lng drives the Home marker, instead of the hardcoded `zone.home`.
      Needs to accept any entity exposing `latitude`/`longitude` attributes
      (e.g. a `person.*` or `device_tracker.*`), not just zones.
- [ ] Home icon enable/disable - a toggle to turn the marker (point + label)
      off entirely, not just customize its text.
- [ ] Default view selector - GUI dropdown for `view`
      (Geographic/Satellite/Political). The YAML option already exists.
- [ ] Default labels toggle - GUI toggle for `show_country_labels`. The
      YAML option already exists.
- [ ] Per-view label color override - a color picker for the Labels text,
      settable per view (Geographic/Satellite/Political), replacing the
      current hardcoded white-on-satellite/black-otherwise rule.

## Also worth covering once an editor exists

For full GUI parity, not just the five above, the rest of the current
YAML-only options should probably get editor rows too: `title`,
`home_label`, `rotate_speed`, `zoom_altitude`/`min_altitude`/`max_altitude`,
`max_width`/`aspect_ratio`/`max_height`.
