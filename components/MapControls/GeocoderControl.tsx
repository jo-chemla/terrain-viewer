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
