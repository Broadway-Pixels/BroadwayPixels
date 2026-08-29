import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { latestByVehicle } from './tracking';

const fallbackCenter = [39.5, -98.35];

export default function FleetMap({ vehicles, points, selectedVehicleId, onSelect }) {
  const containerRef = useRef(null), mapRef = useRef(null), layerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;
    const map = L.map(containerRef.current, { zoomControl: true }).setView(fallbackCenter, 4);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current, layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const latest = latestByVehicle(points), bounds = [];
    latest.forEach((point, vehicleId) => {
      const vehicle = vehicles.find(item => item.id === vehicleId);
      if (!vehicle) return;
      const selected = selectedVehicleId === vehicleId;
      const icon = L.divIcon({
        className: 'fleet-map-marker-wrap',
        html: `<span class="fleet-map-marker${selected ? ' selected' : ''}"><i></i></span>`,
        iconSize: [34, 42], iconAnchor: [17, 38], popupAnchor: [0, -34],
      });
      const marker = L.marker([point.latitude, point.longitude], { icon }).addTo(layer);
      const popup = document.createElement('div'), title = document.createElement('b'), detail = document.createElement('span');
      title.textContent = vehicle.name;
      detail.textContent = point.address || `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`;
      popup.className = 'fleet-map-popup'; popup.append(title, detail); marker.bindPopup(popup);
      marker.on('click', () => onSelect(vehicleId));
      bounds.push([point.latitude, point.longitude]);
    });
    const route = points.filter(point => point.vehicleId === selectedVehicleId).sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));
    if (route.length > 1) L.polyline(route.map(point => [point.latitude, point.longitude]), { color: '#23a99f', weight: 4, opacity: .85 }).addTo(layer);
    if (bounds.length === 1) map.setView(bounds[0], 13);
    else if (bounds.length > 1) map.fitBounds(bounds, { padding: [45, 45], maxZoom: 13 });
    else map.setView(fallbackCenter, 4);
  }, [vehicles, points, selectedVehicleId, onSelect]);

  return <div className="fleet-map" ref={containerRef} aria-label="Vehicle location map"/>;
}
