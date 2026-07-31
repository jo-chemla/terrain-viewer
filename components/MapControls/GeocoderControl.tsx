/* global fetch */
import * as React from 'react';
import { useState } from 'react';
import { useControl, Marker, MarkerProps, ControlPosition } from 'react-map-gl/maplibre';
import MaplibreGeocoder, {
  MaplibreGeocoderApi,
  MaplibreGeocoderOptions,
  CarmenGeojsonFeature
} from '@maplibre/maplibre-gl-geocoder';

type GeocoderControlProps = Omit<MaplibreGeocoderOptions, 'maplibregl' | 'marker'> & {
  marker?: boolean | Omit<MarkerProps, 'longitude' | 'latitude'>;

  position: ControlPosition;

  onLoading?: (e: object) => void;
  onResults?: (e: object) => void;
  onResult?: (e: object) => void;
  onError?: (e: object) => void;
};

/* eslint-disable camelcase */
// Recognizes a typed "lat, lng" (or "lng, lat") pair and turns it straight
// into a point feature instead of sending it to Photon as a place-name
// search, which would find nothing useful for raw coordinates. Ported from
// historicalsatellite's geocoder-control.tsx (itself adapted from the
// mapbox-gl-geocoder docs' own coordinatesGeocoder example) — maplibre's
// geocoder exposes the same `localGeocoder` hook mapbox's does, just with a
// plain array return instead of null-or-array.
// "48.8566°N 2.3522°E" rather than a bare signed number — the compass suffix
// reads faster than remembering "negative longitude means west" and matches
// the convention every other coordinate display in this app (e.g. the
// elevation picker) already uses. Deliberately no comma between the two
// halves: the geocoder's default result renderer splits `place_name` on its
// first comma into a bold title line + a dimmer address line underneath, so
// a comma here would push the longitude onto its own second line.
function formatLatLng(lat: number, lng: number): string {
  const ns = lat < 0 ? 'S' : 'N';
  const ew = lng < 0 ? 'W' : 'E';
  // Clamped to 6dp — plenty for sub-meter precision, and keeps a DMS-derived
  // value (e.g. 35.799683333333334 from 35°47'58.86") from spilling a long
  // float tail into the result label.
  const round6 = (v: number) => Math.round(Math.abs(v) * 1e6) / 1e6;
  return `${round6(lat)}°${ns} ${round6(lng)}°${ew}`;
}

// Alternative parsing libraries, not full feature parity with our needs
// [parse-dms](https://github.com/gmaclennan/parse-dms) — dedicated DMS parser, 
// handles hemisphere letters as prefix or suffix, falls back to lat/lon order 
// when hemisphere letters are absent, explicitly built to handle "most weird 
// ways that people write DMS."
// [parse-coords](https://github.com/danielsiwiec/parse-coords) — broader: 
// DD, DDM, DMS, and UTM, degree/minute/second symbols optional, N/S/E/W as 
// prefix or suffix.

// A bare number token accepts either '.' or ',' as the decimal separator —
// e.g. European-style "45,5 7,2" — normalized to '.' before Number() ever
// sees it (see toNum below). The pair separator (comma and/or space between
// the two tokens, see COORDINATES_PATTERN) still works even when both are
// comma-decimals ("48,8566, 2,3522"): regex greediness consumes a token's own
// decimal comma into that token's \d* before the separator group gets a
// chance to claim it.
// The decimal digit after the separator is deliberately mandatory (not
// `[.,]?\d*`, which lets `\d+` and `\d*` both claim the same plain digit
// run) — that ambiguity is what let COORD_TOKEN's nested optional
// degrees/minutes/seconds groups blow up into catastrophic backtracking on
// a long unbroken digit run (e.g. a paste with an extra digits-only field,
// or a near-miss DMS string using an unsupported quote character), hanging
// the tab for whole seconds on real input lengths.
const NUM = String.raw`-?\d+(?:[.,]\d+)?`;

// One "12.34", "12.34°N", "12.34 N" (decimal), "35°47'58.86\"N" (DMS), or
// "x: 36.8772" / "y: 34.9150" (ESRI Wayback-style axis label) style token —
// degrees is required, minutes/seconds are each optional (and only
// meaningful once degrees/minutes are present). Either a trailing N/S/E/W
// letter OR a leading x:/y: label fixes which of the two tokens is the
// latitude vs longitude (x/y also matches plain cartesian convention: x is
// easting/longitude, y is northing/latitude) — see token1IsLat below, which
// needs only one of the two tokens to carry either marker to resolve order
// unambiguously, no magnitude-based guessing needed.
const COORD_TOKEN = String.raw`(?:Lat:\s*|Lng:\s*|([xXyY]):\s*)?(${NUM})\s*°?\s*(?:(${NUM})\s*['′]\s*(?:(${NUM})\s*["″]\s*)?)?([NSEWnsew])?`;
const COORDINATES_PATTERN = new RegExp(`^[ ]*${COORD_TOKEN}[, ]+${COORD_TOKEN}[ ]*$`, 'i');

function toNum(str: string): number {
  return Number(str.replace(',', '.'));
}

// Combines a token's degrees/minutes/seconds captures into one signed
// decimal-degree value — magnitude comes from degrees+minutes/60+seconds/3600,
// sign from the degrees value itself (direction-letter overrides, if any,
// are applied by the caller the same way they already were for plain decimals).
function dmsToDecimal(degStr: string, minStr?: string, secStr?: string): number {
  const magnitude = Math.abs(toNum(degStr)) + (minStr ? toNum(minStr) / 60 : 0) + (secStr ? toNum(secStr) / 3600 : 0);
  return toNum(degStr) < 0 ? -magnitude : magnitude;
}

/** 'lat'/'lng' when a token's direction letter or x:/y: axis label pins down
 *  which coordinate it is, undefined when neither is present (falls back to
 *  magnitude-based guessing in the caller). */
function roleOf(dir?: string, axis?: string): 'lat' | 'lng' | undefined {
  if (dir === 'N' || dir === 'S') return 'lat';
  if (dir === 'E' || dir === 'W') return 'lng';
  if (axis === 'Y') return 'lat';
  if (axis === 'X') return 'lng';
  return undefined;
}

function coordinatesGeocoder(query: string): CarmenGeojsonFeature[] {
  // Matches "Lat: 12.34 Lng: 56.78", "12.34, 56.78", "12.34°N, 56.78°E",
  // "35°47'58.86\"N 36°47'54.61\"E", "x: 36.8772 y: 34.9150" (ESRI Wayback),
  // "45,5 7,2" (comma-decimal), etc. Trimmed first so a pasted value's
  // leading/trailing whitespace (including tabs/newlines, not just plain
  // spaces — COORDINATES_PATTERN's own `[ ]*` boundaries only cover the
  // latter) doesn't stop the match.
  const matches = query.trim().match(COORDINATES_PATTERN);
  if (!matches) return [];

  const coordinateFeature = (lng: number, lat: number): CarmenGeojsonFeature => {
    const label = formatLatLng(lat, lng);
    return {
      id: `coord-${lng}-${lat}`,
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lng, lat] },
      place_name: label,
      text: label,
      place_type: ['coordinate'],
      properties: {},
      // Not part of CarmenGeojsonFeature's declared shape, but the geocoder
      // reads it (same as the existing Photon results below) as the point to
      // fly to.
      center: [lng, lat],
    } as CarmenGeojsonFeature;
  };

  const [, axis1Raw, deg1Str, min1Str, sec1Str, dir1Raw, axis2Raw, deg2Str, min2Str, sec2Str, dir2Raw] = matches;
  const v1 = dmsToDecimal(deg1Str, min1Str, sec1Str);
  const v2 = dmsToDecimal(deg2Str, min2Str, sec2Str);
  const dir1 = dir1Raw?.toUpperCase();
  const dir2 = dir2Raw?.toUpperCase();
  const axis1 = axis1Raw?.toUpperCase();
  const axis2 = axis2Raw?.toUpperCase();
  const role1 = roleOf(dir1, axis1);
  const role2 = roleOf(dir2, axis2);

  if (role1 || role2) {
    // A direction letter forces the value's sign (S/W negative, N/E
    // positive); an x:/y: axis label doesn't (cartesian coordinates carry
    // their own sign) — with neither, keep whatever sign the number itself
    // already had.
    const withSign = (v: number, dir?: string) =>
      dir === 'S' || dir === 'W' ? -Math.abs(v) : dir === 'N' || dir === 'E' ? Math.abs(v) : v;
    // token1 is the latitude unless it's explicitly marked lng (E/W or
    // x:), or it's unmarked and token2 is explicitly marked lat (N/S or
    // y:) — leaving token1 as the latitude by elimination. Reads correctly
    // regardless of which token came first or which marker kind was used.
    const token1IsLat = role1 === 'lat' || (role1 !== 'lng' && role2 !== 'lat');
    const lat = withSign(token1IsLat ? v1 : v2, token1IsLat ? dir1 : dir2);
    const lng = withSign(token1IsLat ? v2 : v1, token1IsLat ? dir2 : dir1);
    return [coordinateFeature(lng, lat)];
  }

  const coord1 = v1;
  const coord2 = v2;
  const features: CarmenGeojsonFeature[] = [];

  if (coord1 < -90 || coord1 > 90) {
    // coord1 can't be a latitude -> must be lng, lat
    features.push(coordinateFeature(coord1, coord2));
  } else if (coord2 < -90 || coord2 > 90) {
    // coord2 can't be a latitude -> must be lat, lng
    features.push(coordinateFeature(coord2, coord1));
  } else {
    // Either order is plausible (both values fit within ±90) — offer both
    // interpretations rather than guessing, most-common-convention (lat, lng)
    // first.
    features.push(coordinateFeature(coord2, coord1));
    features.push(coordinateFeature(coord1, coord2));
  }

  return features;
}

// Open-data geocoder (Photon / komoot, OSM-based, no key) — see riverrem-ui.
const geocoderApi: MaplibreGeocoderApi = {
  forwardGeocode: async config => {
    const features: CarmenGeojsonFeature[] = [];
    // query can also be a [lng, lat] pair per MaplibreGeocoderApiConfig (used by
    // reverse-geocode flows) — this API object only implements forward (text)
    // search, so a non-string query has nothing to send Photon.
    if (typeof config.query === 'string') try {
      const request = `https://photon.komoot.io/api/?limit=5&q=${encodeURIComponent(config.query)}`;
      const response = await fetch(request);
      const geojson = await response.json();
      for (const feature of geojson.features ?? []) {
        const p = feature.properties ?? {};
        const center = feature.geometry.coordinates;
        const label = [p.name, p.city, p.state, p.country].filter(Boolean).join(", ");
        const point = {
          // Photon has no single stable id field across result types — osm_id is
          // only unique per osm_type, and neither is guaranteed present — so this
          // just needs to be unique within one result list (the geocoder uses it
          // for its own internal result tracking, not anything user-visible).
          id: `${p.osm_type ?? "photon"}-${p.osm_id ?? features.length}`,
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: center
          },
          place_name: label || p.name || "?",
          properties: p,
          text: label || p.name || "?",
          place_type: ['place'],
          center
        };
        features.push(point);
      }
    } catch (e) {
      console.error(`Failed to forwardGeocode with error: ${e}`); // eslint-disable-line
    }

    return {
      type: 'FeatureCollection' as const,
      features
    };
  }
};
export default function GeocoderControl({
  marker = true,
  position,
  onLoading = () => { },
  onResults = () => { },
  onResult = () => { },
  onError = () => { },
  ...props
}: GeocoderControlProps) {

  const [markerEl, setMarkerEl] = useState<React.ReactNode>(null);

  const geocoder = useControl<MaplibreGeocoder>(
    ({ mapLib }) => {
      const ctrl = new MaplibreGeocoder(geocoderApi, {
        ...props,
        localGeocoder: coordinatesGeocoder,
        // Always suppress the library's own built-in pin marker — this wrapper
        // renders its own (small dot, see the `marker` prop) via markerEl below.
        marker: false,
        // react-map-gl's `mapLib` is deliberately typed as a minimal Mapbox/
        // MapLibre-compatible interface (see @vis.gl/react-maplibre's own "only
        // loosely typed for compatibility" doc comment) so it can hand back
        // either library — the geocoder instead wants the full maplibre-gl
        // module namespace, which is what `mapLib` actually IS at runtime here
        // (this app only ever renders via react-map-gl/maplibre, never mapbox).
        maplibregl: mapLib as unknown as typeof import('maplibre-gl'),
      });

      // ── Enter commits the top suggestion ─────────────────────────────────
      // Out of the box (showResultsWhileTyping + no getSuggestions API), Enter
      // does nothing useful: the library's own keydown handler just calls
      // _fitBoundsForMarkers(), a no-op here since showResultMarkers is off.
      // Programmatic selection goes through the same path the library itself
      // uses for a clicked suggestion: set _typeahead.selected then invoke
      // _onChange(), which runs the full flyTo + "result" event flow.
      let selectFirstOnResults = false;
      const selectFirst = () => {
        const g = ctrl as any;
        const first = g._typeahead?.data?.[0];
        if (!first || g._typeahead.selected) return false;
        // Visually highlight item 0 in the dropdown (the same ".active" class
        // arrow-key navigation applies via List.prototype.move) before
        // committing — without this, Enter used to fly the map straight away
        // with no indication in the list of which result was picked.
        g._typeahead.list?.move?.(0);
        g._typeahead.selected = first;
        if (g._inputEl) g._inputEl.value = first.place_name ?? first.text ?? g._inputEl.value;
        g._onChange();
        g._typeahead.clear?.();
        return true;
      };
      // Document-level capture (the input doesn't exist until onAdd, and capture
      // on an ancestor is guaranteed to run before the library's own handlers).
      // Never removed: this control lives for the whole app session.
      document.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key !== "Enter") return;
        const t = e.target as HTMLElement | null;
        if (!t?.classList?.contains("maplibregl-ctrl-geocoder--input")) return;
        const g = ctrl as any;
        // If the user arrow-highlighted a specific suggestion, defer to the
        // typeahead's own Enter handling instead of overriding with the first.
        const active = g._typeahead?.list?.active;
        if (typeof active === "number" && active > 0) return;
        // Suggestions already listed -> commit the top one now; otherwise the
        // user out-typed the debounced search -> commit on the next results.
        if (!selectFirst()) selectFirstOnResults = true;
      }, true);

      ctrl.on("loading", onLoading);
      ctrl.on("results", (evt: object) => {
        onResults(evt);
        if (selectFirstOnResults) {
          selectFirstOnResults = false;
          selectFirst();
        }
      });
      ctrl.on("result", evt => {
        selectFirstOnResults = false; // a manual pick supersedes a pending auto-select
        onResult(evt);
        // A picked result sets _inputEl.value directly (both the library's own
        // click-a-suggestion path and selectFirst() above) rather than typing
        // it in, so it never fires a native "input" event — the listener
        // below alone would miss "stay expanded once there's a result".
        setExpanded(true);

        const { result } = evt;
        const location =
          result &&
          (result.center ||
            (result.geometry?.type === "Point" && result.geometry.coordinates));

        if (location && marker) {
          const markerProps =
            typeof marker === "object" ? marker : {};
          setMarkerEl(
            <Marker {...markerProps} longitude={location[0]} latitude={location[1]} />
          );
        } else {
          setMarkerEl(null);
        }
      });

      ctrl.on("error", onError);
      // The library's own "Clear" (X) button removes ITS built-in marker
      // (which we suppress via `marker: false` above, since this wrapper draws
      // its own instead) but has no idea this wrapper's separate `markerEl`
      // state exists — without this, clearing the input left the previous
      // result's marker/pill sitting on the map. It does emit "clear" though.
      ctrl.on("clear", () => setMarkerEl(null));

      // ── Expanding search ──────────────────────────────────────────────────
      // Collapsed to just the search icon (src/index.css's .geocoder-collapsed)
      // until clicked, focused, typed into, or a result is picked — modeled on
      // https://www.interior.dev/docs/expanding-search, reimplemented with a
      // plain CSS width/opacity transition instead of pulling in the "motion"
      // library for one control. `_inputEl`'s parent IS the
      // `.maplibregl-ctrl-geocoder` container (see this file's other private-
      // member reads above, e.g. `g._inputEl`/`g._typeahead`).
      const geocoderEl = () => (ctrl as any)._inputEl?.parentElement as HTMLElement | undefined;
      const setExpanded = (next: boolean) => {
        geocoderEl()?.classList.toggle("geocoder-collapsed", !next);
      };
      // `_inputEl` doesn't exist yet here — MaplibreGeocoder only builds its
      // DOM inside onAdd(map), which react-map-gl's useControl calls AFTER
      // this factory returns `ctrl`. Wrapping onAdd (rather than attaching
      // listeners directly in this factory) is what actually gets a real
      // input element to attach to.
      const originalOnAdd = ctrl.onAdd.bind(ctrl);
      (ctrl as any).onAdd = (map: unknown) => {
        const container = originalOnAdd(map as any);
        const inputEl = (ctrl as any)._inputEl as HTMLInputElement | undefined;
        inputEl?.addEventListener("focus", () => setExpanded(true));
        inputEl?.addEventListener("input", () => {
          if (inputEl.value.length > 0) setExpanded(true);
        });
        // Only collapses on blur while empty — picking a suggestion (mousedown
        // on the list before blur) or clicking the Clear (×) button both blur
        // the input too, so this is deferred just enough for either to finish
        // first: a pick already called setExpanded(true) above by then, and a
        // clear leaves the value genuinely empty, which should collapse.
        inputEl?.addEventListener("blur", () => {
          setTimeout(() => {
            if (inputEl && inputEl.value.length === 0) setExpanded(false);
          }, 150);
        });
        geocoderEl()?.addEventListener("click", () => {
          if (!geocoderEl()?.classList.contains("geocoder-collapsed")) return;
          setExpanded(true);
          inputEl?.focus();
        });
        setExpanded(false);
        return container;
      };

      return ctrl;
    },
    {
      position
    }
  );

  // @ts-ignore accessing private member
  if (geocoder._map) {
    if (geocoder.getProximity() !== props.proximity && props.proximity !== undefined) {
      geocoder.setProximity(props.proximity);
    }
    if (geocoder.getRenderFunction() !== props.render && props.render !== undefined) {
      geocoder.setRenderFunction(props.render);
    }
    if (geocoder.getLanguage() !== props.language && props.language !== undefined) {
      geocoder.setLanguage(props.language);
    }
    if (geocoder.getZoom() !== props.zoom && props.zoom !== undefined) {
      geocoder.setZoom(props.zoom);
    }
    if (geocoder.getFlyTo() !== props.flyTo && props.flyTo !== undefined) {
      geocoder.setFlyTo(props.flyTo);
    }
    if (geocoder.getPlaceholder() !== props.placeholder && props.placeholder !== undefined) {
      geocoder.setPlaceholder(props.placeholder);
    }
    if (geocoder.getCountries() !== props.countries && props.countries !== undefined) {
      geocoder.setCountries(props.countries);
    }
    if (geocoder.getTypes() !== props.types && props.types !== undefined) {
      geocoder.setTypes(props.types);
    }
    if (geocoder.getMinLength() !== props.minLength && props.minLength !== undefined) {
      geocoder.setMinLength(props.minLength);
    }
    if (geocoder.getLimit() !== props.limit && props.limit !== undefined) {
      geocoder.setLimit(props.limit);
    }
    if (geocoder.getFilter() !== props.filter && props.filter !== undefined) {
      geocoder.setFilter(props.filter);
    }
  }

  return markerEl;
}
