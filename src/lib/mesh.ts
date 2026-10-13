/**
 * 地域メッシュ（国勢調査のマス目）の番号 ⇔ 緯度経度
 *
 * 番号の作り（総務省「地域メッシュ統計」）:
 *   1次（約80km）4桁: 上2桁 ÷ 1.5 = 南端の緯度、下2桁 + 100 = 西端の経度
 *   2次（約10km）2桁: 緯度方向 ×5分、経度方向 ×7.5分
 *   3次（約1km） 2桁: 緯度方向 ×30秒、経度方向 ×45秒
 *   4次（約500m）1桁: 1=南西 2=南東 3=北西 4=北東（半分ずつ）
 *   5次（約250m）1桁: 4次をさらに同じ分け方で4つ
 * 9桁が500mメッシュ、10桁が250mメッシュ。
 */

export type MeshBounds = { south: number; west: number; north: number; east: number };

export function meshBounds(code: string): MeshBounds {
  const d = code.replace(/\D/g, "");
  if (d.length < 4) throw new Error(`メッシュ番号が短すぎます: ${code}`);
  let south = Number(d.slice(0, 2)) / 1.5;
  let west = Number(d.slice(2, 4)) + 100;
  let dLat = 40 / 60;
  let dLng = 1;
  if (d.length >= 6) {
    dLat = 5 / 60;
    dLng = 7.5 / 60;
    south += Number(d[4]) * dLat;
    west += Number(d[5]) * dLng;
  }
  if (d.length >= 8) {
    dLat = 30 / 3600;
    dLng = 45 / 3600;
    south += Number(d[6]) * dLat;
    west += Number(d[7]) * dLng;
  }
  for (let i = 8; i < Math.min(d.length, 10); i++) {
    const q = Number(d[i]) - 1;
    if (q < 0 || q > 3) throw new Error(`メッシュ番号の${i + 1}桁目が不正です: ${code}`);
    dLat /= 2;
    dLng /= 2;
    if (q >= 2) south += dLat;
    if (q % 2 === 1) west += dLng;
  }
  return { south, west, north: south + dLat, east: west + dLng };
}

export function meshCenter(code: string): { lat: number; lng: number } {
  const b = meshBounds(code);
  return { lat: (b.south + b.north) / 2, lng: (b.west + b.east) / 2 };
}

/** 緯度経度が入っている 500m メッシュ（9桁）の番号 */
export function meshCodeAt(lat: number, lng: number): string {
  const p = Math.floor(lat * 1.5);
  const u = Math.floor(lng - 100);
  let south = p / 1.5;
  let west = u + 100;
  const q = Math.floor((lat - south) / (5 / 60));
  const v = Math.floor((lng - west) / (7.5 / 60));
  south += (q * 5) / 60;
  west += (v * 7.5) / 60;
  const r = Math.floor((lat - south) / (30 / 3600));
  const w = Math.floor((lng - west) / (45 / 3600));
  south += (r * 30) / 3600;
  west += (w * 45) / 3600;
  const m = (lat - south >= 15 / 3600 ? 2 : 0) + (lng - west >= 22.5 / 3600 ? 1 : 0) + 1;
  return `${String(p).padStart(2, "0")}${String(u).padStart(2, "0")}${q}${v}${r}${w}${m}`;
}
