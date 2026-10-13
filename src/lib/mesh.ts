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
