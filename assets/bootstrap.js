try {
  const [leaflet, basemap] = await Promise.all([import("leaflet"), import("./basemap.js")]);
  window.L = leaflet;
  window.openStreetMapLayer = basemap.openStreetMapLayer;
  for (const name of ["google.js", "review.js", "app.js"]) {
    const script = document.createElement("script");
    script.src = new URL(`${name}?v=dayplan1`, import.meta.url).href;
    script.nonce = document.querySelector("#map-bootstrap").nonce;
    script.async = false;
    script.onerror = () => {
      document.querySelector("#status").textContent = `Map script ${name} could not load. Reload the page.`;
    };
    document.body.append(script);
  }
} catch (error) {
  document.querySelector("#status").textContent = `Map libraries could not load: ${error.message}`;
}
