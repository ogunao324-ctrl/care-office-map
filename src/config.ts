/**
 * このアプリの前提（自社の場所と、拾う範囲）
 *
 * 距離はすべて「自社」から測る。自社の座標は、公表データの中に
 * 自社の住所（SELF_ADDRESS_KEY を含む住所）が見つかればその座標を使い、
 * 見つからなければ FALLBACK_CENTER（浪花町の町の代表点）を使う。
 */

export const OFFICE_ADDRESS = "千葉県千葉市花見川区浪花町98-44 メゾンセレーザ102";

/** 住所を寄せた（normAddr）あとに、この文字列を含めば自社とみなす */
export const SELF_ADDRESS_KEY = "浪花町98-44";

/**
 * 公表データに自社が見つからないときの中心。
 * 国土地理院の住所検索で「千葉市花見川区浪花町」を引いた代表点（2026-10-13）。
 */
export const FALLBACK_CENTER = { lat: 35.657246, lng: 140.066086 };

/** 取得時に残す範囲（自社からの直線距離 km）。画面の距離の選択肢の最大値と揃える */
export const MAX_KM = 10;

/** 画面の距離の選択肢（km） */
export const RADII = [1, 2, 3, 5, 10] as const;
export const DEFAULT_RADIUS = 3;

/** 位置情報のない事業所でも、この区の住所なら一覧に残す */
export const HOME_WARD = "千葉市花見川区";
