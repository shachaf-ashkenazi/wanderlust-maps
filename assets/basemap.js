import {setWorkerUrl} from "maplibre-gl";
import {maplibreGL} from "./leaflet-maplibre-gl.mjs";

setWorkerUrl(new URL("./maplibre-gl-worker.mjs", import.meta.url).href);

function poiLayers(native) {
  return (native.getStyle()?.layers || []).filter(layer => layer["source-layer"] === "poi").map(layer => layer.id);
}
function placeFromFeature(feature) {
  const properties = feature.properties, point = feature.geometry;
  const name = properties.name || properties.name_en;
  if (typeof name !== "string" || !name.trim() || point.type !== "Point") return null;
  const [longitude, latitude] = point.coordinates;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return {name, latitude, longitude, kind: typeof properties.class === "string" ? properties.class.replaceAll("_", " ") : "Place"};
}
export function openStreetMapLayer(view, failed) {
  const probe = document.createElement("canvas").getContext("webgl2");
  if (!probe) throw new Error("This browser does not support interactive vector maps");
  probe.getExtension("WEBGL_lose_context")?.loseContext();
  const layer = maplibreGL({
    style: "https://tiles.openfreemap.org/styles/liberty",
    attributionControl: {customAttribution: '<a href="https://openfreemap.org">OpenFreeMap</a> | ' +
      '<a href="https://www.openmaptiles.org/">OpenMapTiles</a> | ' +
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'},
  });
  let visible = true, stopped = false;
  const remove = layer.onRemove;
  layer.onRemove = function(map) {
    stopped = true;
    if (this.getMaplibreMap()) remove.call(this, map);
    else this.getContainer()?.remove();
  };
  try { layer.addTo(view); }
  catch (error) { layer.remove(); throw error; }
  const native = layer.getMaplibreMap();
  layer.setBusinesses = show => {
    visible = show;
    for (const id of poiLayers(native)) native.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
  };
  native.on("load", () => { if (!stopped) layer.setBusinesses(visible); });
  native.on("error", event => {
    if (stopped) return;
    stopped = true;
    failed(event.error.message);
  });
  layer.placeAt = event => {
    const original = event.originalEvent, ids = poiLayers(native);
    if (!visible || !original || !ids.length) return null;
    const canvas = native.getCanvas().getBoundingClientRect();
    const features = native.queryRenderedFeatures([original.clientX - canvas.left, original.clientY - canvas.top], {layers: ids});
    return features.map(placeFromFeature).find(Boolean) || null;
  };
  return layer;
}
