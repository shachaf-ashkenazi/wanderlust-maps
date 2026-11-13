"use strict";
const collectionId = document.querySelector('meta[name="collection-id"]').content;
const localMode = document.querySelector('meta[name="map-mode"]').content === "local";
const status = document.querySelector("#status");
const encoder = new TextEncoder();
let map = null;
let markers = null;
let places = [];
let routeIds = [];
let userPosition = null;
let locationWatch = null;
let locationMarker = null;
let accuracyCircle = null;
let basemap = null;
let loadingLocal = false;
let googleBusinessesVisible = true;
let selectedPlaceId = null;
const expandedPlaces = new Set();
const collapsedSubjects = new Set();
let publishedMapUrl = null;
let dayPlan = null;
let dayPlanView = false;
let editingPlan = null;
let editingDate = null;
const dayPeriods = ["morning", "noon", "afternoon", "evening", "night"];

const subjects = {
  attractions: "Attractions", food: "Food & cafes", bars: "Bars", nature: "Parks & gardens",
  shopping: "Shopping", stays: "Stays", areas: "Streets & areas", other: "Other places",
};
const kinds = {
  cafe: {label: "Cafe", symbol: "\u2615", tone: "food", exportColor: "#795548"},
  restaurant: {label: "Restaurant", symbol: "\u{1F374}", tone: "food", exportColor: "#e65100"},
  food: {label: "Food", symbol: "\u{1F374}", tone: "food", exportColor: "#ef6c00"},
  bar: {label: "Bar", symbol: "\u{1F378}", tone: "food", exportColor: "#9c27b0"},
  bakery: {label: "Bakery", symbol: "\u{1F950}", tone: "food", exportColor: "#f9a825"},
  hotel: {label: "Hotel", symbol: "\u{1F6CF}\uFE0F", tone: "stay", exportColor: "#0288d1"},
  shop: {label: "Shop", symbol: "\u{1F6CD}\uFE0F", tone: "shop", exportColor: "#d81b60"},
  christmas_market: {label: "Christmas market", symbol: "\u{1F384}", tone: "nature", exportColor: "#0f9d58"},
  museum: {label: "Museum", symbol: "\u{1F3DB}\uFE0F", tone: "culture", exportColor: "#673ab7"},
  gallery: {label: "Gallery", symbol: "\u{1F3A8}", tone: "culture", exportColor: "#8e24aa"},
  zoo: {label: "Zoo", symbol: "\u{1F412}", tone: "nature", exportColor: "#43a047"},
  park: {label: "Park", symbol: "\u{1F333}", tone: "nature", exportColor: "#0f9d58"},
  garden: {label: "Garden", symbol: "\u{1F33F}", tone: "nature", exportColor: "#7cb342"},
  street: {label: "Street", symbol: "\u{1F6B6}", tone: "area", exportColor: "#607d8b"},
  neighborhood: {label: "Neighborhood", symbol: "\u{1F3D8}\uFE0F", tone: "area", exportColor: "#455a64"},
  attraction: {label: "Attraction", symbol: "\u{1F3F0}", tone: "culture", exportColor: "#e53935"},
  other: {label: "Place", symbol: "\u{1F4CD}", tone: "area", exportColor: "#616161"},
};
const kindOf = place => Object.hasOwn(kinds, place.kind) ? place.kind :
  Object.hasOwn(kinds, place.category) ? place.category : "other";
function subjectOf(place) {
  const kind = kindOf(place);
  if (["museum", "gallery", "zoo", "attraction"].includes(kind)) return "attractions";
  if (["cafe", "restaurant", "food", "bakery"].includes(kind)) return "food";
  if (kind === "bar") return "bars";
  if (["park", "garden"].includes(kind)) return "nature";
  if (["shop", "christmas_market"].includes(kind)) return "shopping";
  if (kind === "hotel") return "stays";
  return ["street", "neighborhood"].includes(kind) ? "areas" : "other";
}

const decode = value => Uint8Array.from(atob(value), character => character.charCodeAt(0));
const coordinates = place => Number.isFinite(place.latitude) && Number.isFinite(place.longitude) &&
  Math.abs(place.latitude) <= 90 && Math.abs(place.longitude) <= 180;
function placeDescription(place) {
  return (place.description || "").split(/\n\s*\n/)
    .filter(paragraph => !/^(?:Research checked\b|Source:)/i.test(paragraph.trim()))
    .join("\n\n").trim();
}
function navigationUrl(place) {
  if (!coordinates(place) && place.google_maps_confirmed && place.maps_url) return locationReviewUrl(place);
  const destination = coordinates(place) ? `${place.latitude},${place.longitude}` :
    [place.name, place.address, place.locality].filter(Boolean).join(" ");
  const params = new URLSearchParams({api: "1", destination, dir_action: "navigate"});
  // Omitting origin lets Google Maps use the device's current location.
  return `https://www.google.com/maps/dir/?${params}`;
}
function node(tag, text, parent) {
  const element = document.createElement(tag);
  element.textContent = text;
  parent.append(element);
  return element;
}
function link(text, url, parent) {
  let target;
  try {
    target = new URL(url);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    node("p", `${text}: invalid source URL.`, parent);
    return;
  }
  if (!["https:", "http:"].includes(target.protocol)) {
    node("p", `${text}: unsupported link protocol.`, parent);
    return;
  }
  const element = node("a", text, parent);
  element.href = target.href;
  element.target = "_blank";
  element.rel = "noopener noreferrer";
}
function selectPlace(id, fromMarker = false) {
  if (fromMarker) setSidebar(false);
  selectedPlaceId = id;
  for (const article of document.querySelectorAll("#places article")) {
    const selected = article.dataset.placeId === String(id);
    article.classList.toggle("is-selected", selected);
    if (selected) {
      expandedPlaces.add(id);
      article.querySelector(".place-details").open = true;
      const subject = article.closest(".subject-group");
      collapsedSubjects.delete(subject.dataset.subject);
      subject.open = true;
      if (!document.querySelector("#sidebar").hidden && matchMedia("(min-width: 701px)").matches) {
        article.scrollIntoView({block: "nearest"});
      }
    }
  }
}
function focusPlace(place) {
  const marker = markers.getLayers().find(layer => layer.options.placeId === place.id);
  if (!marker) return;
  selectPlace(place.id);
  setSidebar(false);
  map.setView([place.latitude, place.longitude], 16, {animate: false});
  marker.openPopup();
}
function card(place, parent, sidebar = false) {
  const article = node("article", "", parent);
  article.dataset.placeId = place.id;
  let content = article, heading = article;
  if (sidebar) {
    article.classList.toggle("is-selected", selectedPlaceId === place.id);
    const details = node("details", "", article);
    details.className = "place-details";
    details.open = expandedPlaces.has(place.id);
    heading = node("summary", "", details);
    content = node("div", "", details);
    content.className = "place-body";
    heading.onclick = event => {
      if (!details.open && coordinates(place)) {
        event.preventDefault();
        focusPlace(place);
      } else if (details.open) expandedPlaces.delete(place.id);
      else expandedPlaces.add(place.id);
    };
    details.ontoggle = () => {
      if (details.isConnected) {
        if (details.open) expandedPlaces.add(place.id);
        else expandedPlaces.delete(place.id);
      }
    };
  }
  node("h3", place.name, heading).dir = "auto";
  const kind = kinds[kindOf(place)];
  node("span", `${kind.symbol} ${kind.label}`, heading).className = "place-type";
  node("span", locationReviewLabel(place), heading).className =
    "review-badge" + (place.google_maps_confirmed ? " is-confirmed" : "");
  const descriptionText = placeDescription(place);
  if (descriptionText) {
    const description = node("p", descriptionText, content);
    description.className = "description";
    description.dir = "auto";
  }
  node("p", place.address || "Address not supplied", content).dir = "auto";
  if (userPosition && coordinates(place)) {
    const meters = map.distance(userPosition, [place.latitude, place.longitude]);
    node("p", `${meters < 1000 ? Math.round(meters) + " m" : (meters / 1000).toFixed(1) + " km"} away (straight-line)`,
      content).className = "distance";
  }
  if (!coordinates(place)) {
    node("p", place.google_maps_confirmed ?
      "Google Maps link checked by you. Its URL has no precise map pin; the recommendation is still saved." :
      "Not mapped yet: automatic lookup could not resolve a confident pin. The recommendation is saved.", content).className = "missing";
  }
  const reviewTarget = {...place, maps_url: place.maps_url || navigationUrl(place)};
  const actions = node("div", "", content);
  actions.className = "place-actions";
  if (coordinates(place)) {
    link("Navigate in Google Maps", navigationUrl(place), actions);
    if (sidebar) node("button", "Show pin", actions).onclick = () => focusPlace(place);
    else link("Show in Google Maps", locationReviewUrl(reviewTarget), actions);
    const add = node("button", routeIds.includes(place.id) ? "Remove from route" : "Add to route", actions);
    add.className = "route-toggle";
    add.onclick = () => toggleStop(place.id);
  } else {
    link("Find / navigate with Google Maps", navigationUrl(place), actions);
  }
  if (place.source_url) link("Original recommendation", place.source_url, actions);
  link("Save in Google Maps", locationReviewUrl(reviewTarget), actions);
  if (localMode) {
    const remove = node("button", "Remove recommendation", actions);
    remove.type = "button";
    remove.className = "remove-recommendation";
    remove.onclick = () => removeRecommendation(reviewTarget, remove);
    content.append(locationReviewControls(reviewTarget, change => reviewPlace(place, change)));
  }
  return article;
}
async function removeRecommendation(place, button) {
  if (!confirm(`Remove "${place.name}" from this trip?\n\nIts source post and Google saved list will be kept.`)) return;
  button.disabled = true;
  try {
    await reviewPlace(place, {expected_url: place.maps_url, drop: true});
    locationReviewDrafts.delete(place.id);
  } catch (error) {
    mapStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
}
async function reviewPlace(place, change) {
  const [id, index] = place.id.split(":").map(Number);
  const token = document.querySelector('meta[name="map-token"]').content;
  const response = await fetch(locationReviewPath(change), {method: "POST",
    headers: {"Content-Type": "application/json", "X-Inbox-Token": token},
    body: JSON.stringify({collection: collectionId, id, index, ...change})});
  const saved = await response.json();
  if (!response.ok) throw new Error(saved.error || "Location review could not be saved.");
  await loadLocal();
  mapStatus(saved.dropped ? "Recommendation dropped. Public updates follow the publishing cycle." :
    saved.mapped ? "Location checked and saved." :
    "Google Maps link checked and saved. Paste a place link with a precise location to add its missing pin.", true);
  return saved;
}
function placeIcon(place) {
  const kind = kinds[kindOf(place)], symbol = document.createElement("span");
  symbol.textContent = kind.symbol;
  symbol.setAttribute("role", "img");
  symbol.setAttribute("aria-label", kind.label);
  const index = routeIds.indexOf(place.id);
  if (index >= 0) node("span", String(index + 1), symbol).className = "route-number";
  return L.divIcon({className: `place-marker marker-${kind.tone}`, html: symbol,
    iconSize: [36, 36], iconAnchor: [18, 36], popupAnchor: [0, -32]});
}
function fitPlaces() {
  const points = markers.getLayers().map(marker => marker.getLatLng());
  if (userPosition) points.push(userPosition);
  if (points.length) map.fitBounds(L.latLngBounds(points), {maxZoom: 15, padding: [30, 30]});
}
function updateKinds() {
  const select = document.querySelector("#kind"), selected = select.value;
  const available = [...new Set(places.map(kindOf))].sort((a, b) => kinds[a].label.localeCompare(kinds[b].label));
  select.replaceChildren(new Option("All types", ""));
  document.querySelector("#legend").replaceChildren();
  for (const key of available) {
    const kind = kinds[key];
    select.add(new Option(`${kind.symbol} ${kind.label}`, key));
    const button = node("button", `${kind.symbol} ${kind.label}`, document.querySelector("#legend"));
    button.type = "button";
    button.dataset.kind = key;
    button.onclick = () => { select.value = select.value === key ? "" : key; render(); };
  }
  if (available.includes(selected)) select.value = selected;
}
function restoreReviewFocus(previous) {
  if (!previous.matches(".review-url") || previous.isConnected) return;
  const id = previous.closest("article").dataset.placeId;
  const scope = previous.closest(".place-popup") ? ".place-popup" : "#places";
  const input = document.querySelector(`${scope} [data-place-id="${CSS.escape(id)}"] .review-url`);
  if (!input) return;
  input.focus({preventScroll: true});
  input.setSelectionRange(previous.selectionStart, previous.selectionEnd, previous.selectionDirection);
}
function render(fitBounds = false) {
  const focused = document.activeElement;
  const query = document.querySelector("#search").value.trim().toLocaleLowerCase();
  const type = document.querySelector("#kind").value;
  const review = document.querySelector("#review-filter").value;
  const visible = places.filter(place => (!type || kindOf(place) === type) &&
    `${place.name} ${place.address || ""} ${place.description || ""} ${kinds[kindOf(place)].label}`.toLocaleLowerCase().includes(query));
  const filtered = visible.filter(place =>
    (review !== "unreviewed" || !place.google_maps_confirmed) &&
    (review !== "confirmed" || place.google_maps_confirmed) &&
    (review !== "unmapped" || (!coordinates(place) && !place.google_maps_confirmed)));
  const nearest = userPosition && document.querySelector("#sort").value === "nearest";
  if (nearest) {
    const distance = place => coordinates(place) ? map.distance(userPosition, [place.latitude, place.longitude]) : Infinity;
    filtered.sort((a, b) => distance(a) - distance(b));
  }
  const root = document.querySelector("#places");
  root.replaceChildren();
  const groups = new Map();
  for (const place of filtered) {
    const key = subjectOf(place);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(place);
  }
  const order = nearest ? [...groups.keys()] : Object.keys(subjects).filter(key => groups.has(key));
  for (const key of order) {
    const group = node("details", "", root);
    group.className = "subject-group";
    group.dataset.subject = key;
    group.open = !collapsedSubjects.has(key);
    node("summary", `${subjects[key]} (${groups.get(key).length})`, group);
    group.ontoggle = event => {
      if (event.target !== group || !group.isConnected) return;
      if (group.open) collapsedSubjects.delete(key);
      else collapsedSubjects.add(key);
    };
    const list = node("div", "", group);
    for (const place of groups.get(key)) card(place, list, true);
  }
  updateMarkers(visible);
  restoreReviewFocus(focused);
  const mapped = visible.filter(coordinates).length;
  const checked = visible.filter(place => place.google_maps_confirmed).length;
  document.querySelector("#count").textContent =
    `${filtered.length} in list / ${visible.length} saved / ${mapped} mapped / ${visible.length - mapped} unmapped / ${checked} checked by you`;
  for (const button of document.querySelectorAll("#legend button")) {
    button.setAttribute("aria-pressed", String(button.dataset.kind === type));
  }
  renderRoute();
  if (fitBounds) fitPlaces();
}
function updateMarkers(filtered) {
  const openLayer = map.provider === "google" ? null : markers.getLayers().find(layer => layer.isPopupOpen());
  const mapped = new Map(filtered.filter(coordinates).map(place => [place.id, place]));
  for (const layer of [...markers.getLayers()]) {
    const place = mapped.get(layer.options.placeId), previous = layer.options.place;
    if (!place || previous.name !== place.name || previous.latitude !== place.latitude || previous.longitude !== place.longitude) {
      markers.removeLayer(layer);
    }
  }
  const existing = new Map(markers.getLayers().map(layer => [layer.options.placeId, layer]));
  for (const place of mapped.values()) {
    const popup = document.createElement("div");
    popup.className = "place-popup";
    card(place, popup);
    const iconKey = `${kindOf(place)}:${routeIds.indexOf(place.id)}`;
    let layer = existing.get(place.id);
    if (layer) {
      if (!layer.options.popupContent.isEqualNode(popup)) {
        layer.setPopupContent(popup);
        layer.options.popupContent = popup;
      }
      if (layer.options.iconKey !== iconKey) {
        layer.setIcon(map.provider === "google" ? googlePlaceIcon(place) : placeIcon(place));
      }
    } else {
      layer = map.provider === "google" ? map.place(place, popup) :
        L.marker([place.latitude, place.longitude], {
          icon: placeIcon(place), title: `${kinds[kindOf(place)].label}: ${place.name}`, placeId: place.id,
        }).bindPopup(popup, popupOptions()).on("click", () => selectPlace(place.id, true));
      layer.options.popupContent = popup;
      markers.addLayer(layer);
    }
    layer.options.place = place;
    layer.options.iconKey = iconKey;
  }
  if (openLayer && markers.hasLayer(openLayer) && !openLayer.isPopupOpen()) openLayer.getPopup().openOn(map);
}
function popupOptions() {
  return {minWidth: 250, maxWidth: 330,
    autoPanPaddingTopLeft: [12, document.querySelector("#map-header").getBoundingClientRect().bottom + 12],
    autoPanPaddingBottomRight: [12, 32]};
}
function showOrdinaryPlace(place) {
  setSidebar(false);
  const popup = document.createElement("div");
  popup.className = "place-popup ordinary-place-popup";
  node("h3", place.name, popup).dir = "auto";
  node("p", place.kind, popup).className = "place-type";
  node("p", "An OpenStreetMap place, not a saved trip recommendation.", popup);
  const actions = node("div", "", popup);
  actions.className = "place-actions";
  link("Directions", navigationUrl(place), actions);
  const search = new URLSearchParams({api: "1", query: `${place.name} ${place.latitude},${place.longitude}`});
  link("Search in Google Maps", `https://www.google.com/maps/search/?${search}`, actions);
  L.popup(popupOptions()).setLatLng([place.latitude, place.longitude]).setContent(popup).openOn(map);
}
function toggleStop(id) {
  const status = document.querySelector("#route-status");
  if (routeIds.includes(id)) routeIds = routeIds.filter(stop => stop !== id);
  else if (routeIds.length < 4) {
    routeIds.push(id);
    document.querySelector("#planner").open = true;
  }
  else { status.textContent = "Up to 4 stops fit Google Maps mobile links. Remove a stop first."; return; }
  status.textContent = "";
  render(false);
}
function moveStop(index, offset) {
  const target = index + offset;
  [routeIds[index], routeIds[target]] = [routeIds[target], routeIds[index]];
  render(false);
}
function renderRoute() {
  const root = document.querySelector("#route-stops");
  root.replaceChildren();
  document.querySelector("#route-count").textContent = `(${routeIds.length})`;
  for (const [index, id] of routeIds.entries()) {
    const place = places.find(place => place.id === id);
    const item = node("li", "", root);
    node("span", place.name + " ", item);
    const actions = node("div", "", item);
    actions.className = "route-actions";
    for (const [label, offset] of [["Move up", -1], ["Move down", 1]]) {
      const button = node("button", label, actions);
      button.disabled = index + offset < 0 || index + offset >= routeIds.length;
      button.onclick = () => moveStop(index, offset);
    }
    node("button", "Remove", actions).onclick = () => toggleStop(id);
  }
  const link = document.querySelector("#route-link");
  link.hidden = !routeIds.length;
  link.removeAttribute("href");
  if (routeIds.length) {
    const stops = routeIds.map(id => places.find(place => place.id === id)).map(place => `${place.latitude},${place.longitude}`);
    const params = new URLSearchParams({api: "1", destination: stops.at(-1), dir_action: "navigate",
      travelmode: document.querySelector("#travel-mode").value});
    if (stops.length > 1) params.set("waypoints", stops.slice(0, -1).join("|"));
    link.href = `https://www.google.com/maps/dir/?${params}`;
  }
}
function stopLocation() {
  if (locationWatch !== null) navigator.geolocation.clearWatch(locationWatch);
  locationWatch = null;
  userPosition = null;
  if (locationMarker) locationMarker.remove();
  if (accuracyCircle) accuracyCircle.remove();
  locationMarker = accuracyCircle = null;
  document.querySelector("#locate").setAttribute("aria-pressed", "false");
  document.querySelector('#sort option[value="nearest"]').disabled = true;
  document.querySelector("#sort").value = "saved";
}
function drawLocation(accuracy) {
  if (!locationMarker) {
    accuracyCircle = map.provider === "google" ? map.accuracy(userPosition, accuracy) :
      L.circle(userPosition, {radius: accuracy, color: "#2563eb", weight: 1, fillOpacity: .08}).addTo(map);
    locationMarker = map.provider === "google" ? map.position(userPosition) :
      L.circleMarker(userPosition, {radius: 8, color: "white", weight: 3,
        fillColor: "#2563eb", fillOpacity: 1}).bindTooltip("You are here").addTo(map);
  } else {
    locationMarker.setLatLng(userPosition);
    accuracyCircle.setLatLng(userPosition);
    accuracyCircle.setRadius(accuracy);
  }
}
function locate() {
  const message = document.querySelector("#location-status");
  if (locationWatch !== null) {
    stopLocation();
    message.textContent = "Location off; your position was not saved.";
    render(false);
    return;
  }
  if (!navigator.geolocation || !window.isSecureContext) {
    message.textContent = "Location requires HTTPS or localhost and browser location support.";
    return;
  }
  message.textContent = "Waiting for location permission...";
  locationWatch = navigator.geolocation.watchPosition(position => {
    if (!map) return;
    const {latitude, longitude, accuracy} = position.coords, first = !userPosition;
    if (!coordinates({latitude, longitude}) || !Number.isFinite(accuracy) || accuracy < 0) {
      message.textContent = "The device returned an invalid location.";
      return;
    }
    userPosition = L.latLng(latitude, longitude);
    drawLocation(accuracy);
    document.querySelector("#locate").setAttribute("aria-pressed", "true");
    document.querySelector('#sort option[value="nearest"]').disabled = false;
    if (first) document.querySelector("#sort").value = "nearest";
    message.textContent = `You are here (accuracy ~${Math.round(accuracy)} m). Distances are straight-line. Raw GPS is not saved; map providers receive the visible map area.`;
    render(first);
  }, error => {
    stopLocation();
    message.textContent = error.code === 1 ? "Location permission denied. Enable it in browser settings to see nearby places." :
      error.code === 3 ? "Location timed out. Try My location again." : "Your device location is unavailable.";
    if (map) render(false);
  }, {enableHighAccuracy: true, maximumAge: 30000, timeout: 15000});
}
function kmlElement(parent, name, value) {
  const child = parent.ownerDocument.createElementNS(parent.namespaceURI, name);
  if (value !== undefined) child.textContent = value;
  parent.append(child);
  return child;
}
function myMapsIconRoot() {
  const base = localMode ? publishedMapUrl : location.protocol === "https:" ? location.href : null;
  return base ? new URL("../assets/kml-icons/", base).href : null;
}
function kmlColor(kind) {
  // KML colours are alpha-blue-green-red, rather than CSS RGB.
  const rgb = kinds[kind].exportColor.slice(1);
  return `ff${rgb.slice(4, 6)}${rgb.slice(2, 4)}${rgb.slice(0, 2)}`;
}
function kmlIconStyle(parent, kind, state, iconRoot) {
  const style = kmlElement(parent, "Style");
  style.setAttribute("id", `wanderlust-${kind}-${state}`);
  const icon = kmlElement(style, "IconStyle");
  // Hosted PNGs contain their own colours; tint only the plain-pin fallback.
  kmlElement(icon, "color", iconRoot ? "ffffffff" : kmlColor(kind));
  kmlElement(icon, "scale", state === "normal" ? "1" : "1.15");
  kmlElement(kmlElement(icon, "Icon"), "href", iconRoot ? new URL(`material-${kind}.png?v=1`, iconRoot).href :
    "https://www.gstatic.com/mapspro/images/stock/503-wht-blank_maps.png");
  const spot = kmlElement(icon, "hotSpot");
  for (const [key, value] of Object.entries({x: ".5", y: "0", xunits: "fraction", yunits: "fraction"})) {
    spot.setAttribute(key, value);
  }
  const label = kmlElement(style, "LabelStyle");
  kmlElement(label, "color", kmlColor(kind));
  kmlElement(label, "scale", state === "normal" ? "0" : "1");
}
function kmlMarkerStyle(parent, kind, iconRoot) {
  for (const state of ["normal", "highlight"]) kmlIconStyle(parent, kind, state, iconRoot);
  const style = kmlElement(parent, "StyleMap");
  style.setAttribute("id", `wanderlust-${kind}`);
  for (const state of ["normal", "highlight"]) {
    const pair = kmlElement(style, "Pair");
    kmlElement(pair, "key", state);
    kmlElement(pair, "styleUrl", `#wanderlust-${kind}-${state}`);
  }
}
function myMapsKml(mapped, iconRoot) {
  const xml = document.implementation.createDocument("http://www.opengis.net/kml/2.2", "kml");
  const documentNode = kmlElement(xml.documentElement, "Document");
  kmlElement(documentNode, "name", document.title);
  if (iconRoot) kmlElement(documentNode, "description",
    "Marker artwork: Google Material Icons, Apache-2.0. Coloured pin adaptation by Wanderlust. " + iconRoot + "NOTICE.txt");
  for (const kind of new Set(mapped.map(kindOf))) kmlMarkerStyle(documentNode, kind, iconRoot);
  for (const place of mapped) {
    const placemark = kmlElement(documentNode, "Placemark");
    kmlElement(placemark, "name", place.name);
    kmlElement(placemark, "styleUrl", `#wanderlust-${kindOf(place)}`);
    const description = [placeDescription(place), place.address, kinds[kindOf(place)].label, place.source_url].filter(Boolean).join("\n");
    kmlElement(placemark, "description", description.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"));
    const extended = kmlElement(placemark, "ExtendedData"), data = kmlElement(extended, "Data");
    data.setAttribute("name", "Type");
    kmlElement(data, "value", kinds[kindOf(place)].label);
    kmlElement(kmlElement(placemark, "Point"), "coordinates", `${place.longitude},${place.latitude},0`);
  }
  return new XMLSerializer().serializeToString(xml);
}
function downloadMyMaps() {
  const mapped = places.filter(coordinates);
  if (!mapped.length) {
    document.querySelector("#route-status").textContent = "No confirmed map pins to export yet.";
    return;
  }
  const iconRoot = myMapsIconRoot();
  const url = URL.createObjectURL(new Blob([myMapsKml(mapped, iconRoot)],
    {type: "application/vnd.google-earth.kml+xml"}));
  const link = document.createElement("a");
  link.href = url;
  link.download = `wanderlust-${collectionId}.kml`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  document.querySelector("#route-status").textContent = `Downloaded ${mapped.length} styled pins. ${places.length - mapped.length} unmapped recommendations remain here. Unencrypted; import into My Maps using Individual styles. ` +
    (iconRoot ? "Category colours and Google-style icons are included." : "Basic coloured pins; publish an encrypted map to enable Google-style category icons.");
}
function providerMessage(text, google = false) {
  const message = document.querySelector("#provider-status");
  message.dataset.provider = google ? "google" : "osm";
  document.querySelector("#basemap-label").textContent = google ? "Google Maps" : "OpenStreetMap";
  message.replaceChildren(document.createTextNode(text));
  if (google) link("Recommendation pins: OpenStreetMap / shared posts", "https://www.openstreetmap.org/copyright", message);
}
function freeBasemap(reason) {
  const previous = map, center = map ? map.getCenter() : [25, 15], zoom = map ? map.getZoom() : 2;
  const accuracy = accuracyCircle ? accuracyCircle.getRadius() : 0;
  if (locationMarker) locationMarker.remove();
  if (accuracyCircle) accuracyCircle.remove();
  locationMarker = accuracyCircle = null;
  if (map) map.remove();
  document.querySelector("#map").replaceChildren();
  map = L.map("map", {minZoom: 1, maxZoom: 19, zoomControl: false}).setView(center, Math.max(1, zoom));
  L.control.zoom({position: "bottomright"}).addTo(map);
  backgroundTaps(map);
  markers = L.featureGroup().addTo(map);
  const current = map;
  const raster = message => {
    if (map !== current) return;
    if (basemap?.getMaplibreMap) basemap.remove();
    map.getContainer().style.cursor = "";
    basemap = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    setGoogleBusinesses(googleBusinessesVisible);
    providerMessage(`Standard OpenStreetMap tiles; background labels are not clickable. ${message}. ${reason}`);
  };
  try {
    basemap = window.openStreetMapLayer(map, error => raster(`Interactive places failed: ${error}`));
    providerMessage(`Free OpenStreetMap places from OpenFreeMap. Tap a place label for details or directions. ${reason}`);
    document.querySelector("#basemap-label").textContent = "OpenStreetMap / OpenFreeMap";
    setGoogleBusinesses(googleBusinessesVisible);
  } catch (error) { raster(`Interactive places are unavailable: ${error.message}`); }
  if (previous) {
    render(false);
    if (userPosition) drawLocation(accuracy);
  }
}
function googleUsage(usage) {
  providerMessage(`Google Maps. Map openings: ${usage.daily_used}/${usage.daily_limit} today; ` +
    `${usage.monthly_used}/${usage.monthly_limit} this month. Panning and zooming reuse this map. App-only limits.`, true);
  document.querySelector("#basemap-label").textContent = `Google Maps - ${usage.daily_used}/${usage.daily_limit} openings today`;
}
function setGoogleBusinesses(visible) {
  googleBusinessesVisible = visible;
  const button = document.querySelector("#businesses");
  button.hidden = map?.provider !== "google" && !basemap?.setBusinesses;
  button.textContent = map?.provider === "google" ? "Google businesses" : "Map places";
  button.setAttribute("aria-pressed", String(visible));
  if (!button.hidden) (map.provider === "google" ? map : basemap).setBusinesses(visible);
}
async function startBasemap(availability) {
  if (!localMode) {
    freeBasemap("Encrypted static exports never activate paid APIs or contain Google credentials.");
    return;
  }
  if (!availability?.ready || availability.provider !== "google_js") {
    freeBasemap(`Google is off: ${availability?.reason || "billing safeguards are not configured"}`);
    return;
  }
  try {
    const token = document.querySelector('meta[name="map-token"]').content;
    const failed = message => {
      googleMapRequest(collectionId, token, {action: "failed"}).catch(error =>
        console.warn("Google openings paused: " + error.message));
      if (map?.provider === "google") freeBasemap(`Google stopped: ${message}`);
    };
    const grant = await googleMapRequest(collectionId, token, {action: "load"});
    await loadGoogleSdk(grant.key, grant.region, failed);
    map = new GoogleMapView(document.querySelector("#map"));
    backgroundTaps(map);
    markers = map.places;
    basemap = map;
    setGoogleBusinesses(googleBusinessesVisible);
    googleUsage(grant.usage);
  } catch (error) {
    const token = document.querySelector('meta[name="map-token"]').content;
    googleMapRequest(collectionId, token, {action: "failed"}).catch(failure =>
      console.warn("Google openings paused: " + failure.message));
    freeBasemap(`Google was not retried: ${error.message}`);
  }
}
function planDate(value) {
  return new Intl.DateTimeFormat("en-GB", {weekday: "long", day: "numeric", month: "short", year: "numeric",
    timeZone: "UTC"}).format(new Date(value + "T12:00:00Z"));
}
function setDayPlanView(open) {
  dayPlanView = open;
  setSidebar(false);
  document.querySelector("#day-plan").hidden = !open;
  document.querySelector("#map").hidden = open;
  document.querySelector("#toggle-sidebar").hidden = open;
  const button = document.querySelector("#toggle-day-plan");
  button.textContent = open ? "Back to map" : "Daily plan";
  button.setAttribute("aria-pressed", String(open));
  if (!open) map?.invalidateSize?.();
}
function renderPlanDay(day, index, parent) {
  const card = node("article", "", parent);
  card.className = "plan-day";
  card.dataset.date = day.date;
  const header = node("header", "", card), heading = node("div", "", header);
  node("p", planDate(day.date), heading).className = "plan-date";
  node("h3", day.title || `Day ${index + 1}`, heading);
  if (localMode) {
    const edit = node("button", "Edit day", header);
    edit.type = "button";
    edit.className = "plan-edit";
    edit.onclick = () => openDayEditor(day.date);
  }
  const periods = node("div", "", card);
  periods.className = "plan-periods";
  for (const period of dayPeriods) renderPlanPeriod(period, day[period], periods);
  const hotel = node("footer", "", card);
  hotel.className = "plan-hotel";
  node("h4", "Hotel for this night", hotel);
  node("strong", day.hotel || "Hotel not set", hotel);
  if (day.hotel_notes) node("p", day.hotel_notes, hotel);
}
function renderPlanPeriod(period, activities, parent) {
  const section = node("section", "", parent);
  section.className = "plan-period";
  node("h4", period[0].toUpperCase() + period.slice(1), section);
  if (!activities.length) {
    node("p", "Open for plans", section).className = "plan-open-slot";
    return;
  }
  const list = node("ul", "", section);
  for (const activity of activities) node("li", activity, list);
}
function updateDayPlan(payload) {
  const next = payload.day_plan || {revision: 0, days: []};
  if (dayPlan && next.revision < dayPlan.revision) return;
  if (JSON.stringify(next) === JSON.stringify(dayPlan)) return;
  dayPlan = next;
  const list = document.querySelector("#day-plan-days");
  list.replaceChildren();
  dayPlan.days.forEach((day, index) => renderPlanDay(day, index, list));
  document.querySelector("#day-plan-empty").hidden = dayPlan.days.length > 0;
  document.querySelector("#add-plan-day").hidden = !localMode;
  document.querySelector("#day-plan-status").textContent = localMode ?
    "Saved per trip. Shared maps show a read-only copy after publishing." :
    "Read-only trip plan. Changes are made in the local app and shared with the next update.";
}
function openDayEditor(date = null) {
  if (!localMode) return;
  editingPlan = structuredClone(dayPlan);
  editingDate = date;
  const day = editingPlan.days.find(day => day.date === date) || {};
  const form = document.querySelector("#day-plan-form");
  form.reset();
  for (const field of ["date", "title", "hotel", "hotel-notes"]) {
    document.querySelector("#plan-" + field).value = day[field.replace("-", "_")] || "";
  }
  for (const period of dayPeriods) document.querySelector("#plan-" + period).value = (day[period] || []).join("\n");
  document.querySelector("#day-editor-title").textContent = date ? "Edit your day" : "Add a day";
  document.querySelector("#remove-plan-day").hidden = !date;
  document.querySelector("#plan-edit-status").textContent = "";
  document.querySelector("#day-editor").showModal();
}
function editedDay() {
  const day = {};
  for (const field of ["date", "title", "hotel", "hotel-notes"]) {
    day[field.replace("-", "_")] = document.querySelector("#plan-" + field).value;
  }
  for (const period of dayPeriods) {
    day[period] = document.querySelector("#plan-" + period).value.split("\n").map(line => line.trim()).filter(Boolean);
  }
  return day;
}
async function saveDayEditor(remove = false) {
  const button = document.querySelector("#save-plan-day");
  const removeButton = document.querySelector("#remove-plan-day");
  button.disabled = removeButton.disabled = true;
  document.querySelector("#plan-edit-status").textContent = "";
  try {
    const days = editingPlan.days.filter(day => day.date !== editingDate);
    if (!remove) days.push(editedDay());
    const response = await fetch("/api/day-plan", {method: "POST",
      headers: {"Content-Type": "application/json",
        "X-Inbox-Token": document.querySelector('meta[name="map-token"]').content},
      body: JSON.stringify({collection: collectionId, revision: editingPlan.revision, days})});
    const saved = await response.json();
    if (!response.ok) throw new Error(saved.error || "The daily plan could not be saved.");
    updateDayPlan({day_plan: saved});
    document.querySelector("#day-editor").close();
  } catch (error) {
    document.querySelector("#plan-edit-status").textContent = error.message;
  } finally { button.disabled = removeButton.disabled = false; }
}
document.querySelector("#toggle-day-plan").onclick = () => setDayPlanView(!dayPlanView);
document.querySelector("#add-plan-day").onclick = () => openDayEditor();
document.querySelector("#cancel-plan-day").onclick = () => document.querySelector("#day-editor").close();
document.querySelector("#day-editor").onclose = () => {
  editingPlan = null;
  editingDate = null;
  document.querySelector("#day-plan-form").reset();
};
document.querySelector("#day-plan-form").onsubmit = event => {
  event.preventDefault();
  saveDayEditor();
};
document.querySelector("#remove-plan-day").onclick = () => {
  if (confirm("Remove this day and its activities and hotel from the plan?")) saveDayEditor(true);
};
async function show(payload, fitBounds = true) {
  if (payload.collection_id !== collectionId || !Array.isArray(payload.places)) throw new Error("Collection mismatch.");
  const sameStop = (old, next) => next && old.name === next.name && old.latitude === next.latitude && old.longitude === next.longitude;
  const kept = routeIds.filter(id => sameStop(places.find(place => place.id === id), payload.places.find(place => place.id === id)));
  if (kept.length !== routeIds.length) document.querySelector("#route-status").textContent = "A route stop changed or disappeared; it was removed rather than silently replaced.";
  routeIds = kept;
  places = payload.places;
  updateKinds();
  document.querySelector("#title").textContent = payload.name;
  document.title = payload.name;
  document.querySelector("#unlock").hidden = true;
  document.querySelector("#lock").hidden = localMode;
  document.querySelector("#content").hidden = false;
  document.body.classList.add("map-open");
  document.querySelector("#toggle-sidebar").hidden = dayPlanView;
  document.querySelector("#toggle-day-plan").hidden = false;
  updateDayPlan(payload);
  document.querySelector("#review-note").textContent = localMode ?
    "Checked places leave the review queue; saved pins stay on the map. Public updates follow publishing. Google saved lists are unchanged." :
    "Read-only snapshot. Check or correct destinations in the local app; published updates include saved reviews.";
  updateMapActions(payload);
  if (!map) {
    document.querySelector("#review-filter").value = localMode ? "unreviewed" : "";
    setSidebar(false);
    await startBasemap(payload.basemap);
    render(fitBounds);
    return;
  }
  render(fitBounds);
}
function lock() {
  document.querySelector("#day-editor").close();
  document.querySelector("#day-plan-form").reset();
  document.querySelector("#day-plan-days").replaceChildren();
  document.querySelector("#day-plan-status").textContent = "";
  document.querySelector("#plan-edit-status").textContent = "";
  dayPlan = editingPlan = null;
  editingDate = null;
  setDayPlanView(false);
  document.querySelector("#toggle-day-plan").hidden = true;
  stopLocation();
  routeIds = [];
  renderRoute();
  document.querySelector("#planner").open = false;
  document.querySelector("#route-status").textContent = "";
  document.querySelector("#location-status").textContent = "";
  document.querySelector("#kind").replaceChildren(new Option("All types", ""));
  document.querySelector("#legend").replaceChildren();
  if (map) map.remove();
  map = null;
  markers = null;
  basemap = null;
  setGoogleBusinesses(true);
  places = [];
  selectedPlaceId = null;
  expandedPlaces.clear();
  collapsedSubjects.clear();
  locationReviewDrafts.clear();
  setSidebar(false);
  document.body.classList.remove("map-open");
  document.querySelector("#toggle-sidebar").hidden = true;
  document.querySelector("#basemap-label").textContent = "";
  document.querySelector("#places").replaceChildren();
  document.querySelector("#search").value = "";
  document.querySelector("#review-filter").value = "";
  document.querySelector("#title").textContent = "Wanderlust";
  document.title = "Wanderlust - Locked map";
  document.querySelector("#content").hidden = true;
  document.querySelector("#lock").hidden = true;
  document.querySelector("#google-list-link").hidden = true;
  document.querySelector("#google-list-link").removeAttribute("href");
  document.querySelector("#share").hidden = true;
  document.querySelector("#unlock").hidden = false;
  document.querySelector("#passphrase").value = "";
  mapStatus("");
  document.querySelector("#provider-status").replaceChildren();
  publishedMapUrl = null;
}
document.querySelector("#unlock").onsubmit = async event => {
  event.preventDefault();
  const button = event.target.querySelector("button");
  button.disabled = true;
  mapStatus("Unlocking...");
  try {
    if (!crypto.subtle) throw new Error("Use HTTPS or localhost to unlock encrypted maps.");
    const response = await fetch("./data.enc.json", {cache: "no-store"});
    if (!response.ok) throw new Error("Encrypted map could not be downloaded.");
    const envelope = await response.json();
    if (envelope.version !== 1 || envelope.iterations !== 600000) throw new Error("Unsupported map format.");
    const salt = decode(envelope.salt), iv = decode(envelope.iv);
    if (salt.length !== 16 || iv.length !== 12) throw new Error("Invalid map encryption parameters.");
    const password = encoder.encode(document.querySelector("#passphrase").value);
    document.querySelector("#passphrase").value = "";
    const material = await crypto.subtle.importKey("raw", password, "PBKDF2", false, ["deriveKey"]);
    password.fill(0);
    const key = await crypto.subtle.deriveKey({name: "PBKDF2", hash: "SHA-256", salt,
      iterations: envelope.iterations}, material, {name: "AES-GCM", length: 256}, false, ["decrypt"]);
    const plaintext = await crypto.subtle.decrypt({name: "AES-GCM", iv,
      additionalData: encoder.encode(`wanderlust-map:v1:${collectionId}`)}, key, decode(envelope.ciphertext));
    const payload = JSON.parse(new TextDecoder().decode(plaintext));
    await show(payload);
    mapStatus(`Updated ${new Date(payload.updated_at).toLocaleString()}. Only this collection is loaded.`);
  } catch (error) {
    lock();
    mapStatus(error.name === "OperationError" ? "Wrong passphrase, damaged data, or a different collection." : error.message, true);
  } finally {
    button.disabled = false;
  }
};
document.querySelector("#lock").onclick = lock;
document.querySelector("#search").oninput = () => render();
document.querySelector("#kind").onchange = () => render();
document.querySelector("#review-filter").onchange = () => render();
document.querySelector("#sort").onchange = () => render(false);
document.querySelector("#travel-mode").onchange = renderRoute;
document.querySelector("#locate").onclick = locate;
document.querySelector("#fit").onclick = fitPlaces;
document.querySelector("#download").onclick = downloadMyMaps;
document.querySelector("#share").onclick = async () => {
  try {
    const token = document.querySelector('meta[name="map-token"]').content;
    const response = await fetch("/api/maps/share", {method: "POST",
      headers: {"Content-Type": "application/json", "X-Inbox-Token": token},
      body: JSON.stringify({collection: collectionId})});
    const sharing = await response.json();
    if (!response.ok) throw new Error(sharing.error || "Share link is unavailable.");
    await navigator.clipboard.writeText(sharing.share_url);
    mapStatus("Private share link copied. Anyone with the full link can read this trip.", true);
  } catch (error) { mapStatus(error.message, true); }
};
document.querySelector("#businesses").onclick = () => setGoogleBusinesses(!googleBusinessesVisible);
function setSidebar(open) {
  document.querySelector("#sidebar").hidden = !open;
  document.body.classList.toggle("menu-open", open);
  const button = document.querySelector("#toggle-sidebar");
  button.setAttribute("aria-label", open ? "Close places menu" : "Open places menu");
  button.setAttribute("aria-expanded", String(open));
}
document.querySelector("#toggle-sidebar").onclick = () => setSidebar(document.querySelector("#sidebar").hidden);
document.querySelector("#close-sidebar").onclick = () => {
  setSidebar(false);
  document.querySelector("#toggle-sidebar").focus();
};
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !document.querySelector("#sidebar").hidden) {
    setSidebar(false);
    document.querySelector("#toggle-sidebar").focus();
  }
});
function mapStatus(message, notice = false) {
  status.textContent = message;
  status.dataset.notice = String(notice);
}
function backgroundTaps(view) {
  let timer, dragging = false, ignoreUntil = 0;
  const cancel = () => clearTimeout(timer);
  if (view.provider !== "google") view.on("popupopen", ({popup}) => {
    // Leaflet's touch double-tap shim must not count popup actions as map taps.
    L.DomEvent.on(popup.getElement(), "click", L.DomEvent.stopPropagation);
  });
  view.on("dragstart", () => {
    dragging = true;
    if (view.provider !== "google") view.getContainer().style.cursor = "";
    cancel();
  });
  view.on("dragend", () => { dragging = false; ignoreUntil = performance.now() + 150; });
  view.on("dblclick", cancel);
  view.on("mousemove", event => {
    if (view.provider !== "google" && basemap?.placeAt && !dragging) {
      view.getContainer().style.cursor = basemap.placeAt(event) ? "pointer" : "";
    }
  });
  view.on("click", event => {
    const original = event.originalEvent || event.domEvent, target = original?.target;
    cancel();
    if (dragging || performance.now() < ignoreUntil || event.placeId || original?.detail > 1 ||
        target?.closest(".leaflet-popup, .leaflet-marker-icon, .leaflet-control, button, a, input, select")) return;
    timer = setTimeout(() => {
      if (map === view && !dragging && !dayPlanView && !document.querySelector("#content").hidden) {
        const place = basemap?.placeAt?.(event);
        if (place) { showOrdinaryPlace(place); return; }
      }
    }, 220);
  });
}
function updateMapActions(payload) {
  publishedMapUrl = payload.sharing?.url || null;
  document.querySelector("#share").hidden = !localMode || !payload.sharing?.url;
  const list = document.querySelector("#google-list-link");
  list.hidden = !payload.google_list_url;
  if (payload.google_list_url) list.href = payload.google_list_url;
}
async function loadLocal() {
  if (loadingLocal) return;
  loadingLocal = true;
  try {
    const response = await fetch("/api/map?collection=" + encodeURIComponent(collectionId), {cache: "no-store"});
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Local map could not be loaded.");
    if (!map || payload.name !== document.title || JSON.stringify(payload.places) !== JSON.stringify(places)) {
      await show(payload, !places.some(coordinates));
    }
    updateMapActions(payload);
    updateDayPlan(payload);
    if (document.querySelector("#provider-status").dataset.provider === "google") {
      if (payload.basemap.enabled) googleUsage(payload.basemap.usage);
      else freeBasemap(`Google stopped: ${payload.basemap.reason}`);
    }
    mapStatus(payload.sharing?.error ? "Public updates are paused: " + payload.sharing.error :
      "Live local map. New recommendations appear automatically; no export or approval is needed.", Boolean(payload.sharing?.error));
  } catch (error) {
    mapStatus(error.message, true);
  } finally {
    loadingLocal = false;
  }
}
function unlockFragment() {
  if (!location.hash) return;
  const fragment = new URLSearchParams(location.hash.slice(1));
  const key = fragment.get("key");
  history.replaceState(null, "", location.pathname + location.search);
  if (key) {
    lock();
    document.querySelector("#passphrase").value = key;
    document.querySelector("#unlock").requestSubmit();
  }
}
document.querySelector("#unlock button").disabled = false;
document.querySelector("#unlock button").textContent = "Unlock map";
if (localMode) {
  document.querySelector("#unlock").hidden = true;
  document.title = "Wanderlust - Local map";
  loadLocal();
  setInterval(() => { if (!document.hidden) loadLocal(); }, 5000);
} else {
  window.addEventListener("hashchange", unlockFragment);
  unlockFragment();
}
