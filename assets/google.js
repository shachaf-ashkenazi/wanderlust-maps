"use strict";
let googleSdkPromise;
async function googleMapRequest(collection, token, operation) {
  const response = await fetch("/api/maps/google", {method: "POST", cache: "no-store",
    headers: {"Content-Type": "application/json", "X-Inbox-Token": token},
    body: JSON.stringify({collection, ...operation})});
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "The guarded Google map request failed.");
  return payload;
}
function loadGoogleSdk(key, region, failed) {
  if (googleSdkPromise) return googleSdkPromise;
  googleSdkPromise = new Promise((resolve, reject) => {
    let settled = false;
    const fail = message => {
      if (!settled) { settled = true; clearTimeout(timer); reject(new Error(message)); }
      else failed(message);
    };
    const timer = setTimeout(() => fail("Google Maps timed out; no automatic retry was made."), 20000);
    window.gm_authFailure = () => fail("Google Maps rejected the browser key, API access or website restrictions.");
    window.wanderlustGoogleReady = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const script = document.createElement("script");
    script.nonce = document.querySelector("script[nonce]").nonce;
    script.async = true;
    script.onerror = () => fail("Google Maps could not be downloaded; no automatic retry was made.");
    script.src = "https://maps.googleapis.com/maps/api/js?" + new URLSearchParams({
      key, region, language: "en", v: "quarterly", loading: "async", callback: "wanderlustGoogleReady",
    });
    document.head.append(script);
  });
  return googleSdkPromise;
}
const googlePosition = point => Array.isArray(point) ? {lat: point[0], lng: point[1]} : {lat: point.lat, lng: point.lng};
function googlePlaceIcon(place) {
  const kind = kinds[kindOf(place)];
  const colors = {food: "#ad4b12", culture: "#7943a5", nature: "#20824c", stay: "#175caa",
    shop: "#b33172", area: "#58677c"};
  const index = routeIds.indexOf(place.id);
  const badge = index < 0 ? "" : `<circle cx="35" cy="9" r="9" fill="#172f57"/>
    <text x="35" y="13" text-anchor="middle" fill="white" font-size="12">${index + 1}</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="46" height="46" viewBox="0 0 46 46">
    <path d="M22 44L9 29A18 18 0 1 1 35 29Z" fill="white" stroke="${colors[kind.tone]}" stroke-width="3"/>
    <text x="22" y="28" font-size="23" text-anchor="middle">${kind.symbol}</text>${badge}</svg>`;
  return {url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(46, 46), anchor: new google.maps.Point(22, 44)};
}
class GooglePlaces {
  constructor(view) {
    this.view = view;
    this.layers = [];
    this.cluster = new markerClusterer.MarkerClusterer({map: view.native, markers: []});
  }
  getLayers() { return this.layers; }
  addLayer(layer) { this.layers.push(layer); this.cluster.addMarker(layer.native, true); }
  render() { this.cluster.render(); }
  zoomToShowLayer(layer, callback) { callback(); }
  removeLayer(layer) {
    if (this.view.popupPlaceId === layer.options.placeId) {
      this.view.popup.close();
      this.view.popupPlaceId = null;
    }
    this.cluster.removeMarker(layer.native, true);
    google.maps.event.clearInstanceListeners(layer.native);
    this.layers = this.layers.filter(current => current !== layer);
  }
  clearLayers() {
    this.view.popup.close();
    this.view.popupPlaceId = null;
    this.cluster.clearMarkers(true);
    for (const layer of this.layers) google.maps.event.clearInstanceListeners(layer.native);
    this.layers = [];
  }
}
class GoogleMapView {
  constructor(element) {
    this.provider = "google";
    this.native = new google.maps.Map(element, {
      center: {lat: 25, lng: 15}, zoom: 2, maxZoom: 19, mapTypeId: "roadmap",
      renderingType: google.maps.RenderingType.RASTER, tilt: 0,
      streetViewControl: false, mapTypeControl: false, rotateControl: false, clickableIcons: true,
      zoomControl: true, fullscreenControl: true,
    });
    this.popup = new google.maps.InfoWindow({maxWidth: 330});
    this.popupPlaceId = null;
    this.popup.addListener("closeclick", () => { this.popupPlaceId = null; });
    this.popup.addListener("domready", () => {
      cancelAnimationFrame(this.popupFrame);
      this.popupFrame = requestAnimationFrame(() => this.keepPopupVisible());
    });
    this.places = new GooglePlaces(this);
  }
  getCenter() {
    const center = this.native.getCenter();
    return L.latLng(center.lat(), center.lng());
  }
  getZoom() { return this.native.getZoom(); }
  on(event, callback) { this.native.addListener(event, callback); return this; }
  keepPopupVisible() {
    if (this.popupPlaceId === null) return;
    const bounds = this.popupContent.getBoundingClientRect();
    const header = document.querySelector("#map-header").getBoundingClientRect();
    // Google's native title/close row sits above our popup content.
    const offset = header.bottom + 64 - bounds.top;
    if (bounds.left < header.right && bounds.right > header.left && offset > 0) this.native.panBy(0, -offset);
  }
  setView(point, zoom) { this.native.moveCamera({center: googlePosition(point), zoom}); return this; }
  distance(first, second) { return L.latLng(first).distanceTo(L.latLng(second)); }
  fitBounds(bounds, options) {
    google.maps.event.addListenerOnce(this.native, "idle", () => {
      if (this.native.getZoom() > options.maxZoom) this.native.setZoom(options.maxZoom);
    });
    this.native.fitBounds({north: bounds.getNorth(), south: bounds.getSouth(),
      east: bounds.getEast(), west: bounds.getWest()}, options.padding[0]);
  }
  invalidateSize() { google.maps.event.trigger(this.native, "resize"); }
  setBusinesses(visible) {
    this.native.setOptions({styles: visible ? [] :
      [{featureType: "poi.business", elementType: "all", stylers: [{visibility: "off"}]}]});
  }
  place(place, content) {
    const native = new google.maps.Marker({position: {lat: place.latitude, lng: place.longitude},
      title: `${kinds[kindOf(place)].label}: ${place.name}`, icon: googlePlaceIcon(place)});
    const layer = {native, options: {placeId: place.id}, getLatLng: () => L.latLng(place.latitude, place.longitude),
      setIcon: icon => native.setIcon(icon),
      setPopupContent: next => {
        content = next;
        if (this.popupPlaceId === place.id) {
          this.popupContent = content;
          this.popup.setContent(content);
        }
      },
      openPopup: () => {
        this.popup.setContent(content);
        this.popup.setPosition(native.getPosition());
        this.popup.open({map: this.native});
        this.popupPlaceId = place.id;
        this.popupContent = content;
      }};
    native.addListener("click", () => { selectPlace(place.id, true); layer.openPopup(); });
    return layer;
  }
  accuracy(point, meters) {
    const circle = new google.maps.Circle({map: this.native, center: googlePosition(point), radius: meters,
      strokeColor: "#2563eb", strokeWeight: 1, fillColor: "#2563eb", fillOpacity: .08});
    return {setLatLng: position => circle.setCenter(googlePosition(position)),
      setRadius: radius => circle.setRadius(radius), getRadius: () => circle.getRadius(), remove: () => circle.setMap(null)};
  }
  position(point) {
    const marker = new google.maps.Marker({map: this.native, position: googlePosition(point), title: "You are here",
      icon: {path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: "#2563eb", fillOpacity: 1,
        strokeColor: "white", strokeWeight: 3}});
    return {setLatLng: position => marker.setPosition(googlePosition(position)), remove: () => marker.setMap(null)};
  }
  remove() {
    this.places.clearLayers();
    this.places.cluster.setMap(null);
    google.maps.event.clearInstanceListeners(this.native);
    this.native.getDiv().replaceChildren();
  }
}
