export interface GeoPoint {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_METERS = 6_371_000;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/**
 * Khoảng cách haversine giữa hai toạ độ, tính bằng MÉT.
 * Dùng cho geofence (FR-APP-HOME-05) và impossible travel (AF-03).
 */
export function haversineMeters(from: GeoPoint, to: GeoPoint): number {
  const dLat = toRadians(to.latitude - from.latitude);
  const dLng = toRadians(to.longitude - from.longitude);
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);

  const a =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Tốc độ suy ra giữa hai điểm (m/s). Trả 0 nếu khoảng thời gian không hợp lệ. */
export function derivedSpeedMps(
  from: GeoPoint,
  to: GeoPoint,
  elapsedSeconds: number,
): number {
  if (elapsedSeconds <= 0) return 0;
  return haversineMeters(from, to) / elapsedSeconds;
}

/**
 * AF-04: hai toạ độ trùng KHÍT tới 6 chữ số thập phân là dấu hiệu toạ độ
 * được set cứng (fake GPS), không phải cảm biến thật.
 */
export function isExactSameCoordinate(a: GeoPoint, b: GeoPoint): boolean {
  const fix = (value: number) => value.toFixed(6);
  return fix(a.latitude) === fix(b.latitude) && fix(a.longitude) === fix(b.longitude);
}

export function isWithinRadius(
  point: GeoPoint,
  center: GeoPoint,
  radiusMeters: number,
): boolean {
  return haversineMeters(point, center) <= radiusMeters;
}
