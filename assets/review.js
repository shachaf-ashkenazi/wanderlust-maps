"use strict";
const locationReviewDrafts = new Map();

function locationReviewLabel(place) {
  return place.google_maps_confirmed ? "Checked by you" : "Needs checking";
}

function locationReviewPath(change) {
  return change.drop ? "/api/location-drop" : "/api/location-review";
}

function coordinateGoogleQuery(value) {
  return /^(?:loc:)?[+-]?\d+(?:\.\d+)?\s*,\s*[+-]?\d+(?:\.\d+)?$/.test(value.trim()) ||
    (/[\u00b0'"\u2032\u2033]/.test(value) && /^[+-]?\d[\d\s.,+'"\-NSEW\u00b0\u2032\u2033]*$/i.test(value));
}

function locationReviewUrl(place) {
  const target = new URL(place.maps_url);
  const directions = /^\/maps\/dir(?:\/|$)/.test(target.pathname) ||
    target.searchParams.has("daddr") || target.searchParams.get("dir_action") === "navigate";
  const identified = ["cid", "ftid", "query_place_id", "place_id"].some(key => target.searchParams.get(key)) ||
    /!1s(?:0x[0-9a-f]+:0x[0-9a-f]+|ChI[\w-]+)/i.test(target.pathname);
  const rawLabel = target.pathname.match(/^\/maps\/place\/([^/]+)/)?.[1] || "";
  // Google encodes its place paths with form-style '+' spaces and percent escapes.
  const label = new URLSearchParams("name=" + rawLabel).get("name");
  const query = target.searchParams.get("query") || target.searchParams.get("q");
  if (!directions && (identified || label && !coordinateGoogleQuery(label) || query && !coordinateGoogleQuery(query))) {
    return place.maps_url;
  }
  const description = [place.name || place.place_name, place.extracted_address, place.locality].filter(Boolean).join(" ");
  const params = new URLSearchParams({api: "1", query: description});
  const placeId = target.searchParams.get("destination_place_id");
  if (placeId) params.set("query_place_id", placeId);
  return "https://www.google.com/maps/search/?" + params;
}

function locationReviewControls(place, submit) {
  const add = (tag, text, parent) => {
    const element = document.createElement(tag);
    element.textContent = text;
    parent.append(element);
    return element;
  };
  const state = locationReviewDrafts.get(place.id) || {url: "", open: false, busy: false};
  const details = document.createElement("details");
  details.className = "location-review";
  details.open = state.open;
  details.ontoggle = event => {
    if (event.target === details && details.isConnected) {
      state.open = details.open;
      locationReviewDrafts.set(place.id, state);
    }
  };
  const summary = add("summary", "Check / correct Google Maps location", details);
  summary.onclick = () => {
    state.open = !details.open;
    locationReviewDrafts.set(place.id, state);
  };
  const destination = add("a", "Check destination in Google Maps", details);
  destination.href = locationReviewUrl(place);
  destination.target = "_blank";
  destination.rel = "noopener noreferrer";
  add("p", "Check the place and branch. If the search is ambiguous or wrong, paste the selected place's Google Maps share link below.", details);
  const confirm = add("button", "This is the right place", details);
  confirm.type = "button";
  const form = add("form", "", details);
  form.className = "location-review-form";
  const label = add("label", "Correct Google Maps URL", form);
  const input = add("input", "", label);
  input.type = "url";
  input.className = "review-url";
  input.placeholder = "https://maps.app.goo.gl/...";
  input.autocomplete = "off";
  input.maxLength = 8192;
  input.required = true;
  input.value = state.url;
  input.oninput = () => {
    state.url = input.value;
    state.open = details.open;
    locationReviewDrafts.set(place.id, state);
  };
  const save = add("button", "Use this Google Maps link", form);
  save.type = "submit";
  add("small", "We use the place location, never the map camera. A link without a precise location is retained without inventing a pin.", details);
  add("p", "Already added or cannot find it? Drop just this recommendation. Its source post and your Google saved list stay unchanged.", details);
  const drop = add("button", "Cancel / drop recommendation", details);
  drop.type = "button";
  drop.className = "review-drop";
  const feedback = add("p", "", details);
  feedback.className = "review-feedback";
  feedback.setAttribute("role", "status");
  async function review(correction) {
    if (state.busy) return;
    state.busy = true;
    confirm.disabled = save.disabled = drop.disabled = input.disabled = true;
    feedback.textContent = "Saving your review...";
    feedback.setAttribute("role", "status");
    try {
      const saved = await submit({expected_url: place.maps_url, ...correction});
      locationReviewDrafts.delete(place.id);
      feedback.textContent = saved.dropped ? "Recommendation dropped." : saved.mapped ? "Location checked and saved." :
        "Google Maps link checked and saved. No precise map pin is available from this link.";
    } catch (error) {
      feedback.setAttribute("role", "alert");
      feedback.textContent = error.message;
    } finally {
      state.busy = false;
      confirm.disabled = save.disabled = drop.disabled = input.disabled = false;
    }
  }
  confirm.onclick = () => review({checked_url: destination.href});
  drop.onclick = () => review({drop: true});
  form.onsubmit = event => {
    event.preventDefault();
    review({url: input.value.trim()});
  };
  return details;
}
