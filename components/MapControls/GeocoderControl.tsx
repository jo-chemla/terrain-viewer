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

// One "12.34", "12.34°N", "12.34 N" (decimal), or "35°47'58.86\"N" (DMS)
// style token — degrees is required, minutes/seconds are each optional (and
// only meaningful once degrees/minutes are present), and the trailing letter
// (any of N/S/E/W) is optional. When present, the letter both fixes the
// value's sign and says outright whether this token is the latitude or the
// longitude, so two directioned tokens (in either order) never need the
// magnitude-based guessing below. Minutes/seconds accept either the plain
// ASCII quotes or the proper prime/double-prime marks some sources (e.g.
// Google Earth's copy-coordinates output) use.
const COORD_TOKEN = String.raw`(?:Lat: |Lng: )?(-?\d+\.?\d*)\s*°?\s*(?:(\d+\.?\d*)\s*['′]\s*(?:(\d+\.?\d*)\s*["″]\s*)?)?([NSEWnsew])?`;
const COORDINATES_PATTERN = new RegExp(`^[ ]*${COORD_TOKEN}[, ]+${COORD_TOKEN}[ ]*$`, 'i');

// Combines a token's degrees/minutes/seconds captures into one signed
// decimal-degree value — magnitude comes from degrees+minutes/60+seconds/3600,
// sign from the degrees value itself (direction-letter overrides, if any,
// are applied by the caller the same way they already were for plain decimals).
function dmsToDecimal(degStr: string, minStr?: string, secStr?: string): number {
  const magnitude = Math.abs(Number(degStr)) + (minStr ? Number(minStr) / 60 : 0) + (secStr ? Number(secStr) / 3600 : 0);
  return Number(degStr) < 0 ? -magnitude : magnitude;
}

function coordinatesGeocoder(query: string): CarmenGeojsonFeature[] {
  // Matches "Lat: 12.34 Lng: 56.78", "12.34, 56.78", "12.34°N, 56.78°E",
  // "35°47'58.86\"N 36°47'54.61\"E", etc.
  const matches = query.match(COORDINATES_PATTERN);
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

  const [, deg1Str, min1Str, sec1Str, dir1Raw, deg2Str, min2Str, sec2Str, dir2Raw] = matches;
  const v1 = dmsToDecimal(deg1Str, min1Str, sec1Str);
  const v2 = dmsToDecimal(deg2Str, min2Str, sec2Str);
  const dir1 = dir1Raw?.toUpperCase();
  const dir2 = dir2Raw?.toUpperCase();

  if (dir1 || dir2) {
    // A direction letter forces the value's sign (S/W negative, N/E
    // positive) — with no letter, keep whatever sign the number itself
    // already had.
    const withSign = (v: number, dir?: string) =>
      dir === 'S' || dir === 'W' ? -Math.abs(v) : dir === 'N' || dir === 'E' ? Math.abs(v) : v;
    // token1 is the latitude unless it's explicitly marked E/W, or it's
    // unmarked and token2 is explicitly marked E/W (leaving token1 as the
    // latitude by elimination) — this reads correctly regardless of which
    // token came first.
    const token1IsLat = dir1 === 'N' || dir1 === 'S' || !(dir1 === 'E' || dir1 === 'W') && !(dir2 === 'N' || dir2 === 'S');
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
