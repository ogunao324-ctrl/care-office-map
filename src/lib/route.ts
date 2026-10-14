/**
 * 営業で回る道順：選んだ事業所を、自社から近い順につないで Googleマップの道順を開く
 */

import { distanceKm, type LatLng } from "./offices";

/** Googleマップの道順で、途中に立ち寄れる数の上限（URL の決まり） */
export const MAX_WAYPOINTS = 9;

/** 出発地から、いちばん近い所 → そこからいちばん近い所…の順に並べる（厳密な最短ではないが十分） */
export function orderStops<T extends LatLng>(origin: LatLng, stops: T[]): T[] {
  const rest = [...stops];
  const out: T[] = [];
  let cur: LatLng = origin;
  while (rest.length) {
    let best = 0;
    for (let i = 1; i < rest.length; i++) if (distanceKm(cur, rest[i]) < distanceKm(cur, rest[best])) best = i;
    cur = rest[best];
    out.push(rest.splice(best, 1)[0]);
  }
  return out;
}

const ll = (p: LatLng) => `${p.lat},${p.lng}`;

/**
 * Googleマップの道順の URL（車）。returnHome なら最後に出発地へ戻る。
 * stops は並べ替え済みのもの。上限を超えた分は入れない。
 */
export function routeUrl(origin: LatLng, stops: LatLng[], returnHome: boolean): string {
  const max = returnHome ? MAX_WAYPOINTS : MAX_WAYPOINTS + 1;
  const list = stops.slice(0, max);
  if (!list.length) return "";
  const dest = returnHome ? origin : list[list.length - 1];
  const ways = returnHome ? list : list.slice(0, -1);
  const q = new URLSearchParams({ api: "1", origin: ll(origin), destination: ll(dest), travelmode: "driving" });
  if (ways.length) q.set("waypoints", ways.map(ll).join("|"));
  return `https://www.google.com/maps/dir/?${q.toString()}`;
}
