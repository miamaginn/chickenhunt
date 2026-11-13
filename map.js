// Maps (Leaflet + free OpenStreetMap tiles, no API key needed).
// Leaflet is loaded as a global `L` by a <script> tag in index.html.

const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export const mapsAvailable = () => typeof window.L !== "undefined";

function baseMap(el) {
  const map = L.map(el, { zoomControl: true, attributionControl: true }).setView([39.5, -98.35], 4);
  L.tileLayer(TILES, { attribution: ATTR, maxZoom: 19 }).addTo(map);
  return map;
}

function pinIcon(emoji, label, cls = "") {
  return L.divIcon({
    className: "",
    html: `<div class="map-pin ${cls}"><span>${emoji}</span>${label != null ? `<b>${esc(label)}</b>` : ""}</div>`,
    iconSize: [40, 44],
    iconAnchor: [20, 42],
    popupAnchor: [0, -38],
  });
}

const directions = (p) => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;

// ───── The hunters' map ─────
export function createHuntMap(el) {
  const map = baseMap(el);
  const layer = L.layerGroup().addTo(map);
  let pts = [];
  let fitted = false;
  let me = null, watchId = null;

  const fit = () => {
    if (pts.length === 1) map.setView(pts[0], 16);
    else if (pts.length) map.fitBounds(pts, { padding: [36, 36], maxZoom: 16 });
  };

  return {
    // bars: [names]; pins: Map(name → {lat,lng}); visited: Map(name → visit)
    update({ bars, pins, visited }) {
      layer.clearLayers();
      pts = [];
      const extra = [...pins.keys()].filter((n) => !bars.includes(n));
      [...bars, ...extra].forEach((name, i) => {
        const p = pins.get(name);
        if (!p) return;
        const v = visited.get(name);
        const num = i < bars.length ? i + 1 : "★";
        L.marker([p.lat, p.lng], { icon: pinIcon(v ? "✅" : "🍺", num, v ? "visited" : ""), title: name })
          .bindPopup(
            `<div class="map-pop"><b>${esc(name)}</b><div>${v ? `✅ Your team checked this at ${clock(v.at)}` : "🍺 Not checked yet"}</div>
             <a href="${directions(p)}" target="_blank" rel="noopener">🧭 Directions</a></div>`
          )
          .addTo(layer);
        pts.push([p.lat, p.lng]);
      });
      if (!fitted && pts.length) { fit(); fitted = true; }
      return pts.length;
    },
    fit,
    refresh() { map.invalidateSize(); if (!fitted && pts.length) { fit(); fitted = true; } },
    locate(onError) {
      if (!navigator.geolocation) return onError?.("Your browser can't share location.");
      if (me) map.setView(me.getLatLng(), 16);
      if (watchId != null) return;
      let first = true;
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const ll = [pos.coords.latitude, pos.coords.longitude];
          if (!me) me = L.marker(ll, { icon: pinIcon("🧺", null, "me"), zIndexOffset: 1000, title: "You" }).bindPopup("You are here!").addTo(map);
          else me.setLatLng(ll);
          if (first) { map.setView(ll, 16); first = false; }
        },
        () => { watchId = null; onError?.("Couldn't get your location. Check location permissions."); },
        { enableHighAccuracy: true, maximumAge: 15000 }
      );
    },
  };
}

// ───── The chickens' pin editor ─────
export function createPinEditor(el, { onPlace }) {
  const map = baseMap(el);
  const layer = L.layerGroup().addTo(map);
  let fitted = false;
  map.on("click", (e) => onPlace(e.latlng));

  return {
    update({ bars, pins, selected }) {
      layer.clearLayers();
      const pts = [];
      bars.forEach((name, i) => {
        const p = pins.get(name);
        if (!p) return;
        const sel = name === selected;
        L.marker([p.lat, p.lng], { icon: pinIcon("🍺", i + 1, sel ? "selected" : ""), draggable: sel, title: name, zIndexOffset: sel ? 500 : 0 })
          .bindTooltip(esc(name), { direction: "top", offset: [0, -38] })
          .on("dragend", (e) => onPlace(e.target.getLatLng()))
          .addTo(layer);
        pts.push([p.lat, p.lng]);
      });
      if (!fitted && pts.length) {
        if (pts.length === 1) map.setView(pts[0], 16);
        else map.fitBounds(pts, { padding: [30, 30], maxZoom: 16 });
        fitted = true;
      }
    },
    flyTo(lat, lng) { map.setView([lat, lng], 17); },
    refresh() { map.invalidateSize(); },
  };
}

// Free place search via OpenStreetMap's Nominatim (light use only).
export async function searchPlaces(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`;
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error("Search failed");
  return (await r.json()).map((x) => ({ name: x.display_name, lat: +x.lat, lng: +x.lon }));
}
