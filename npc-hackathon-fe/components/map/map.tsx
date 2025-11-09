"use client";

import { useEffect, useRef } from "react";
import styles from './map.module.css';

type Point = { lat: number; lng: number; name?: string };

// decode encoded polyline (Google/Mapbox style). Returns array of [lat, lng]
function decodePolyline(encoded: string, precision = 5) {
    if (!encoded) return [];
    let index = 0, lat = 0, lng = 0, shift = 0, result = 0;
    const coordinates: Array<[number, number]> = [];
    const factor = Math.pow(10, precision);

    while (index < encoded.length) {
        let b: number, shift = 0, result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        const deltaLat = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lat += deltaLat;

        // decode longitude
        shift = 0;
        result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        const deltaLng = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lng += deltaLng;

        coordinates.push([lat / factor, lng / factor]);
    }

    return coordinates; // [lat, lng]
}

// helper: convert [lat, lng] -> [lng, lat] for map/geojson usage
function latLngToLngLat(coord: [number, number]) {
    const [lat, lng] = coord;
    return [lng, lat] as [number, number];
}

async function loadVietmapScript(apikey: string) {
    if (typeof window === "undefined") return;
    if ((window as any).vietmapgl) return (window as any).vietmapgl;

    return new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[data-vietmap]`);
        if (existing) {
            existing.addEventListener("load", () => resolve((window as any).vietmapgl));
            existing.addEventListener("error", (e) => reject(e));
            return;
        }

        const s = document.createElement("script");
        s.setAttribute("data-vietmap", "1");
        // try the provider-hosted sdk path first (may 404 for some accounts)
        const providerUrl = `https://maps.vietmap.vn/api/vietmap-gl.js?apikey=${encodeURIComponent(apikey)}`;
        const unpkgUrl = `https://unpkg.com/@vietmap/vietmap-gl-js@6.0.0/dist/vietmap-gl.js`;
        s.async = true;

        const attachHandlers = (scriptEl: HTMLScriptElement) => {
            scriptEl.onload = () => resolve((window as any).vietmapgl);
            scriptEl.onerror = async (e) => {
                // if first attempt failed, try unpkg CDN as fallback
                if (scriptEl.src && scriptEl.src.indexOf('unpkg.com') === -1) {
                    try {
                        const alt = document.createElement('script');
                        alt.setAttribute('data-vietmap', '1');
                        alt.src = unpkgUrl;
                        alt.async = true;
                        alt.onload = () => resolve((window as any).vietmapgl);
                        alt.onerror = (ev) => reject(ev);
                        document.head.appendChild(alt);
                        return;
                    } catch (err) {
                        reject(err);
                        return;
                    }
                }
                reject(e);
            };
        };

        // first try provider url
        s.src = providerUrl;
        attachHandlers(s);
        document.head.appendChild(s);
    });
}

export default function Map({ points }: { points?: Point[] }) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<any>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const truckAnimRef = useRef<any>(null);

    useEffect(() => {
        const apikey = (process.env.NEXT_PUBLIC_VIETMAP_API_KEY as string) || (window as any)?.NEXT_PUBLIC_VIETMAP_API_KEY || "";
        if (!apikey) {
            console.warn("Vietmap API key not set in NEXT_PUBLIC_VIETMAP_API_KEY");
            return;
        }

        let mounted = true;

        (async () => {
            try {
                const vietmapgl = await loadVietmapScript(apikey);
                if (!mounted) return;

                const el = containerRef.current;
                if (!el) return;

                // determine center: prefer points[0] -> localStorage 'center' -> default
                let center: [number, number] = [106, 10];
                if (points && points.length > 0) {
                    center = [points[0].lng, points[0].lat];
                } else {
                    try {
                        const raw = localStorage.getItem("center");
                        if (raw) {
                            const parsed = JSON.parse(raw);
                            const plat = parsed?.lat;
                            const plng = parsed?.lng;
                            if (typeof plat === "number" && typeof plng === "number") {
                                center = [plng, plat];
                                console.debug("[map] using localStorage center", center);
                            }
                        }
                    } catch (e) {
                        // ignore
                    }
                }

                // init map
                mapRef.current = new vietmapgl.Map({
                    container: "vietmap-container",
                    style: `https://maps.vietmap.vn/maps/styles/tm/style.json?apikey=${encodeURIComponent(apikey)}`,
                    center: center,
                    zoom: 9,
                });

                const map = mapRef.current;

                map.on("load", () => {
                    (async () => {
                        // build place list with coords and optional name
                        let placesList: Array<{ lng: number; lat: number; name?: string }> = [];

                        if (points && points.length > 0) {
                            placesList = points.map((p) => ({ lng: p.lng, lat: p.lat, name: p.name }));
                        } else {
                            try {
                                const raw = localStorage.getItem("ai:selectedPlaces");
                                if (raw) {
                                    const arr = JSON.parse(raw);
                                    if (Array.isArray(arr) && arr.length > 0) {
                                        const refs = arr.map((r: any) => r?.ref_id ?? r?.refId ?? r?.id ?? null).filter(Boolean);
                                        const apikeyClient = apikey;
                                        for (const ref of refs) {
                                            try {
                                                const url = `https://maps.vietmap.vn/api/place/v3?apikey=${encodeURIComponent(apikeyClient)}&refid=${encodeURIComponent(ref)}`;
                                                const res = await fetch(url);
                                                if (!res.ok) continue;
                                                const d = await res.json();
                                                const lat = d?.lat ?? d?.location?.lat ?? d?.result?.location?.lat ?? null;
                                                const lng = d?.lng ?? d?.location?.lng ?? d?.result?.location?.lng ?? null;
                                                const name = d?.name ?? d?.display ?? d?.result?.display ?? d?.result?.name ?? null;
                                                if (typeof lat === "number" && typeof lng === "number") placesList.push({ lng, lat, name });
                                            } catch (e) {
                                                // ignore
                                            }
                                        }
                                    }
                                }
                            } catch (e) {
                                // ignore
                            }
                        }

                        // add markers for the original points (with visible labels)
                        if (placesList.length > 0) {
                            for (const [i, p] of placesList.entries()) {
                                try {
                                    // create a simple circle marker element; let the map position it
                                    const el = document.createElement('div');
                                    // choose style: start, end, mid
                                    const cls = i === 0 ? `${styles.marker} ${styles.markerStart}` : (i === placesList.length - 1 ? `${styles.marker} ${styles.markerEnd}` : `${styles.marker} ${styles.markerMid}`);
                                    el.className = cls;
                                    const num = document.createElement('span');
                                    num.className = styles.label;
                                    num.textContent = String(i + 1);
                                    el.appendChild(num);

                                    // visible label as a map-anchored popup (persistent)
                                    const nameLabel = document.createElement('div');
                                    nameLabel.className = styles.placeLabel;
                                    nameLabel.textContent = p.name ?? `Điểm ${i + 1}`;

                                    const marker = new vietmapgl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map);

                                    try {
                                        // persistent popup anchored to the marker so it doesn't drift when page scrolls
                                        const popup = new vietmapgl.Popup({ offset: 12, closeButton: false, closeOnClick: false, anchor: 'right' }).setDOMContent(nameLabel);
                                        popup.setLngLat([p.lng, p.lat]).addTo(map);
                                        // associate popup with marker for consistency (hover/click behavior if desired)
                                        try { marker.setPopup(popup); } catch (e) { }
                                    } catch (e) { }
                                } catch (e) { }
                            }

                            // Try to call Vietmap route API first to get a routed geometry (points encoded)
                            const defaultCoords = placesList.map(p => [p.lng, p.lat] as [number, number]);
                            let finalCoords: Array<[number, number]> = defaultCoords; // default: [lng, lat]
                            let usedBBox: number[] | null = null;
                            try {
                                if (placesList.length > 1) {
                                    const apikeyClient = apikey;
                                    // build query string with point=<lat>,<lng> for each point (Vietmap expects lat,lng)
                                    const pts = placesList.map((c) => `${encodeURIComponent(String(c.lat))},${encodeURIComponent(String(c.lng))}`); // lat,lng
                                    const url = `https://maps.vietmap.vn/api/route?api-version=1.1&apikey=${encodeURIComponent(apikeyClient)}&vehicle=motorcycle&point=${pts.join('&point=')}`;
                                    try {
                                        const r = await fetch(url);
                                        if (r.ok) {
                                            const jr = await r.json();
                                            const path = jr?.paths?.[0];
                                            if (path) {
                                                usedBBox = Array.isArray(path.bbox) && path.bbox.length === 4 ? path.bbox : null;
                                                if (path.points_encoded && typeof path.points === 'string') {
                                                    // decode to [lat, lng]
                                                    const decoded = decodePolyline(path.points, 5);
                                                    if (decoded && decoded.length > 0) {
                                                        // convert to [lng, lat]
                                                        finalCoords = decoded.map(latLngToLngLat);
                                                        console.debug('[map] decoded routed polyline, points:', finalCoords.length);
                                                    }
                                                } else if (Array.isArray(path.points) && path.points.length > 0) {
                                                    // assume points array is [lng, lat] already
                                                    finalCoords = path.points as any;
                                                }

                                                // render turn-by-turn instructions into the right panel
                                                try {
                                                    const stepsEl = document.getElementById('vietmap-steps');
                                                    if (stepsEl && Array.isArray(path.instructions)) {
                                                        stepsEl.innerHTML = '';
                                                        path.instructions.forEach((inst: any, idx: number) => {
                                                            const div = document.createElement('div');
                                                            div.className = styles.step;
                                                            div.innerHTML = `<b>B${idx + 1}:</b> ${inst.text}<br><small>${Math.round(inst.distance)} m</small>`;
                                                            stepsEl.appendChild(div);
                                                        });

                                                        // simple highlight animation for steps
                                                        let current = 0;
                                                        const stepEls = Array.from(stepsEl.querySelectorAll(`.${styles.step}`));
                                                        if (stepEls.length > 0) {
                                                            const iv = window.setInterval(() => {
                                                                stepEls.forEach(s => s.classList.remove(styles.stepActive));
                                                                const el = stepEls[current];
                                                                if (el) el.classList.add(styles.stepActive);
                                                                current = (current + 1) % stepEls.length;
                                                            }, 3500);
                                                            // store so we can clear later
                                                            (truckAnimRef as any).current = (truckAnimRef as any).current || {};
                                                            (truckAnimRef as any).current.stepsInterval = iv;
                                                        }
                                                    }
                                                } catch (err) {
                                                    console.debug('[map] error rendering instructions', err);
                                                }

                                                // animate a vehicle icon along the decoded route (optional)
                                                try {
                                                    if (Array.isArray(finalCoords) && finalCoords.length > 0) {
                                                        const truck = document.createElement('img');
                                                        truck.src = 'https://cdn-icons-png.flaticon.com/512/1995/1995574.png';
                                                        truck.className = styles.truckImg;
                                                        const truckMarker = new vietmapgl.Marker({ element: truck }).setLngLat(finalCoords[0]).addTo(map);
                                                        const total = finalCoords.length;
                                                        let idxAnim = 0;
                                                        const step = Math.max(1, Math.floor(total / 200));
                                                        const animInterval = window.setInterval(() => {
                                                            try { truckMarker.setLngLat(finalCoords[Math.min(idxAnim, total - 1)]); } catch (e) { }
                                                            idxAnim += step;
                                                            if (idxAnim >= total) {
                                                                window.clearInterval(animInterval);
                                                            }
                                                        }, 40);
                                                        (truckAnimRef as any).current = (truckAnimRef as any).current || {};
                                                        (truckAnimRef as any).current.animInterval = animInterval;
                                                        (truckAnimRef as any).current.truckMarker = truckMarker;
                                                    }
                                                } catch (err) {
                                                    console.debug('[map] error animating truck', err);
                                                }
                                            }
                                        } else {
                                            console.debug('[map] route API responded with', r.status);
                                        }
                                    } catch (err) {
                                        console.debug('[map] error calling route API, falling back to straight line', err);
                                    }
                                }
                            } catch (e) {
                                // ignore
                            }

                            // add or update route source/layer using finalCoords
                            const geo = { type: 'Feature', geometry: { type: 'LineString', coordinates: finalCoords } } as any;
                            try {
                                if (map.getSource && !map.getSource('route')) {
                                    map.addSource('route', { type: 'geojson', data: geo });
                                    map.addLayer({ id: 'route-layer', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#FF5733', 'line-width': 5 } }, 'boundary_province');
                                } else if (map.getSource && map.getSource('route')) {
                                    (map.getSource('route') as any).setData(geo);
                                }
                            } catch (e) {
                                // ignore layer errors
                            }

                            // fit bounds: prefer bbox from routing API if available
                            // fit bounds: prefer bbox from routing API if available
                            if (usedBBox) {
                                // bbox is [minLon, minLat, maxLon, maxLat]
                                map.fitBounds([[usedBBox[0], usedBBox[1]], [usedBBox[2], usedBBox[3]]], { padding: 40 });
                            } else if (finalCoords.length > 0) { // SỬA ĐỔI: thêm check finalCoords.length
                                // Khi không có BBox từ Route API, tính toán bounds thủ công từ các điểm route/điểm ban đầu
                                const bounds = finalCoords.reduce((b: any, c: any) => {
                                    // c là [lng, lat]
                                    if (!b) return [c[0], c[1], c[0], c[1]];
                                    return [Math.min(b[0], c[0]), Math.min(b[1], c[1]), Math.max(b[2], c[0]), Math.max(b[3], c[1])];
                                }, null as any);

                                if (bounds) {
                                    map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 40 });
                                    // Nếu chỉ có 1 điểm, fitBounds sẽ chỉ center. Có thể thêm zoom cho rõ ràng:
                                    if (finalCoords.length === 1 && map.getZoom() < 14) {
                                        map.setZoom(14);
                                    }
                                }
                            }
                        }
                    })();
                });
            } catch (e) {
                console.error("Failed to load Vietmap script or init map", e);
            }
        })();

        return () => {
            mounted = false;
            try {
                if (mapRef.current) {
                    mapRef.current.remove();
                    mapRef.current = null;
                }
            } catch (e) { }
            try {
                const t = (truckAnimRef as any).current;
                if (t) {
                    if (t.stepsInterval) window.clearInterval(t.stepsInterval);
                    if (t.animInterval) window.clearInterval(t.animInterval);
                    if (t.truckMarker && typeof t.truckMarker.remove === 'function') {
                        try { t.truckMarker.remove(); } catch (e) { }
                    }
                }
            } catch (e) { }
        };
    }, [points]);

    return (
        <div className={styles.container}>
            <div ref={containerRef} id="vietmap-container" className={styles.map} />
            <div ref={panelRef} className={styles.routePanel}>
                <h3 className={styles.panelTitle}>Chỉ đường</h3>
                <div id="vietmap-steps" className={styles.steps} />
            </div>
        </div>
    );
}
