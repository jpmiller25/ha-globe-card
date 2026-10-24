# TODO

## GUI configuration editor - done

Implemented via `getConfigElement()`/`getStubConfig()`, backed by Home
Assistant's own `<ha-form>` component (`GlobeCardEditor` in
`globe-card.js`). Covers the original list:

- [x] Home entity selector (`home_entity`) - entity picker scoped to
      `zone.*`/`person.*`/`device_tracker.*`.
- [x] Home icon enable/disable (`show_home_icon`)
- [x] Default view selector (`view`)
- [x] Default labels toggle (`show_country_labels`)
- [x] Per-view label color override (`label_color_geographic`/
      `_satellite`/`_political`)

Plus, picked up along the way since they were cheap once `ha-form` was
wired in: which view buttons are shown and in what order (`views`), hiding
the play/pause button (`show_play_pause`), hiding the card header
(`show_header`), locking out zoom (`allow_zoom`), and GUI rows for the
remaining YAML options (rotation speed, zoom bounds, card sizing).

## Deliberately not done

- **Multiple markers.** Tracking more than one entity on the globe at once
  is a bigger change to the data model than a config option - `home_entity`
  is still a single entity. Explicitly out of scope for this round.

## Before HACS submission

- [ ] Verify the GUI editor renders and behaves correctly in a real browser
      - it was written and reviewed without being click-tested live (see
        the WebGL/sandbox limitation noted during the original build), though
        the editor itself doesn't need WebGL so it should be easier to check
        than the globe rendering.
- [ ] Decide whether a missing/invalid `home_entity` should show a visible
      warning on the card instead of silently falling back to the
      mid-Atlantic location - fine for personal use, but a strangers'-eyes
      HACS release probably shouldn't fail that quietly.
