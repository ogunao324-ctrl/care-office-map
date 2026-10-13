/**
 * 検索の当たり判定に使う、文字の正規化
 *
 * つむぐ（tsumugu-board の src/lib/domain/search-text.ts）からそのまま写したもの。
 * 寄せ方を変えるときは、つむぐ側と揃えること。
 *
 * **アプリ内のすべての検索・絞り込みはここを通す**（2026-09-13 にユーザーが
 * 「他のすべての検索窓でも同じ設定にしたい」と決めた）。画面ごとに寄せ方を
 * 書くと、「チャットでは『もに』で出るのに利用者一覧では出ない」が起きる。
 *
 * 揃えるのは4つ:
 *   * カタカナ ⇔ ひらがな  … 「もに」で「モニタリング」に当たる
 *   * 半角カナ → ひらがな  … 「ﾓﾆ」でも当たる。濁点・半濁点も1文字に畳む
 *   * 全角の英数・記号 → 半角
 *   * 大文字 → 小文字
 *
 * **畳むと長さが変わる**（`ｸﾞ` の2文字が `ぐ` の1文字になる）。当たった所に
 * 印を付ける `Highlight` が位置を元の文字列へ戻せるよう、`toSearchText` は
 * 「寄せた後の各文字が元のどこから来たか」（offsets）も一緒に返す。
 * **印を付ける側は必ず offsets を使うこと。** 寄せた側の位置をそのまま
 * 元の文字列に当てると、半角カナが混ざった行で印がずれる。
 */

/** ひらがな ぁ(3041)〜ゖ(3096) */
const HIRA_START = 0x3041;
const HIRA_END = 0x3096;
/** カタカナ ァ(30A1)〜ヶ(30F6)。ひらがなとの差はちょうど 0x60 */
const KATA_START = 0x30a1;
const KATA_END = 0x30f6;
const KANA_GAP = 0x60;

/** 全角の英数・記号 ！(FF01)〜～(FF5E) と、半角との差 */
const WIDE_START = 0xff01;
const WIDE_END = 0xff5e;
const WIDE_GAP = 0xfee0;

/** 半角の濁点・半濁点。直前の1文字とくっつけて畳む */
const HALF_VOICED_MARK = "ﾞ";
const HALF_SEMI_MARK = "ﾟ";

/**
 * 半角カナ → ひらがな（濁点なし）。
 * 行きつく先をひらがなに揃えてあるので、寄せ直す手間が要らない。
 * 長音・句読点・カギ括弧も混ざるので、かな以外もここで面倒を見る。
 */
const HALF_TO_HIRA: Record<string, string> = {
  "｡": "。", "｢": "「", "｣": "」", "､": "、", "･": "・", "ｰ": "ー",
  "ｦ": "を", "ｧ": "ぁ", "ｨ": "ぃ", "ｩ": "ぅ", "ｪ": "ぇ", "ｫ": "ぉ",
  "ｬ": "ゃ", "ｭ": "ゅ", "ｮ": "ょ", "ｯ": "っ",
  "ｱ": "あ", "ｲ": "い", "ｳ": "う", "ｴ": "え", "ｵ": "お",
  "ｶ": "か", "ｷ": "き", "ｸ": "く", "ｹ": "け", "ｺ": "こ",
  "ｻ": "さ", "ｼ": "し", "ｽ": "す", "ｾ": "せ", "ｿ": "そ",
  "ﾀ": "た", "ﾁ": "ち", "ﾂ": "つ", "ﾃ": "て", "ﾄ": "と",
  "ﾅ": "な", "ﾆ": "に", "ﾇ": "ぬ", "ﾈ": "ね", "ﾉ": "の",
  "ﾊ": "は", "ﾋ": "ひ", "ﾌ": "ふ", "ﾍ": "へ", "ﾎ": "ほ",
  "ﾏ": "ま", "ﾐ": "み", "ﾑ": "む", "ﾒ": "め", "ﾓ": "も",
  "ﾔ": "や", "ﾕ": "ゆ", "ﾖ": "よ",
  "ﾗ": "ら", "ﾘ": "り", "ﾙ": "る", "ﾚ": "れ", "ﾛ": "ろ",
  "ﾜ": "わ", "ﾝ": "ん",
};

/** 半角カナ＋濁点（2文字）→ ひらがな1文字 */
const HALF_VOICED_TO_HIRA: Record<string, string> = {
  "ｶ": "が", "ｷ": "ぎ", "ｸ": "ぐ", "ｹ": "げ", "ｺ": "ご",
  "ｻ": "ざ", "ｼ": "じ", "ｽ": "ず", "ｾ": "ぜ", "ｿ": "ぞ",
  "ﾀ": "だ", "ﾁ": "ぢ", "ﾂ": "づ", "ﾃ": "で", "ﾄ": "ど",
  "ﾊ": "ば", "ﾋ": "び", "ﾌ": "ぶ", "ﾍ": "べ", "ﾎ": "ぼ",
  "ｳ": "ゔ",
};

/** 半角カナ＋半濁点（2文字）→ ひらがな1文字 */
const HALF_SEMI_TO_HIRA: Record<string, string> = {
  "ﾊ": "ぱ", "ﾋ": "ぴ", "ﾌ": "ぷ", "ﾍ": "ぺ", "ﾎ": "ぽ",
};

/** 寄せた文字列と、その各文字が元のどこから来たか */
export type SearchText = {
  /** 当たり判定に使う形 */
  key: string;
  /**
   * `key` の各文字が元の文字列のどこ（UTF-16 の位置）から来たか。
   * 末尾に終端（元の文字列の長さ）を1つ余分に持つので、
   * `offsets[key.length]` がそのまま「当たりの終わり」に使える。
   */
  offsets: number[];
};

/**
 * 文字を1つずつ写しながら、元の位置を控える。
 * 半角カナの畳み込み（2文字→1文字）はどの寄せ方でも共通なので、
 * ここで面倒を見る。`fold` は畳んだ後の1文字をどう寄せるかだけを決める。
 */
function scan(text: string, fold: (code: number, ch: string) => string): SearchText {
  const parts: string[] = [];
  const offsets: number[] = [];

  /** 寄せた結果 piece を、元の位置 at から来たものとして足す */
  const emit = (piece: string, at: number) => {
    for (const ch of piece) {
      const code = ch.codePointAt(0);
      const folded = code == null ? ch : fold(code, ch);
      parts.push(folded);
      // 1文字が複数の UTF-16 単位になっても、元の位置は同じ
      for (let n = 0; n < folded.length; n++) offsets.push(at);
    }
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    // 半角カナ＋濁点／半濁点は、2文字で1文字ぶん
    if (next === HALF_VOICED_MARK && HALF_VOICED_TO_HIRA[ch]) {
      emit(HALF_VOICED_TO_HIRA[ch], i);
      i += 2;
      continue;
    }
    if (next === HALF_SEMI_MARK && HALF_SEMI_TO_HIRA[ch]) {
      emit(HALF_SEMI_TO_HIRA[ch], i);
      i += 2;
      continue;
    }
    const half = HALF_TO_HIRA[ch];
    if (half) {
      emit(half, i);
      i += 1;
      continue;
    }

    // それ以外は1文字ずつ。絵文字などのサロゲートペアは2単位でひとまとまり
    const code = text.codePointAt(i);
    const size = code != null && code > 0xffff ? 2 : 1;
    emit(text.slice(i, i + size), i);
    i += size;
  }

  offsets.push(text.length);
  return { key: parts.join(""), offsets };
}

/** カタカナをひらがなに寄せる（ヴ→ゔ もこの範囲で収まる） */
const foldToHiragana = (code: number, ch: string) =>
  code >= KATA_START && code <= KATA_END ? String.fromCodePoint(code - KANA_GAP) : ch;

/** ひらがなをカタカナに寄せる */
const foldToKatakana = (code: number, ch: string) =>
  code >= HIRA_START && code <= HIRA_END ? String.fromCodePoint(code + KANA_GAP) : ch;

/** 当たり判定に使う形。かなをひらがなへ、英数を半角小文字へ揃える */
const foldForSearch = (code: number, ch: string) => {
  if (code >= KATA_START && code <= KATA_END) return String.fromCodePoint(code - KANA_GAP);
  // 半角に直したあと小文字にする（「ＢＰ」を "bp" と打っても当たるように）
  if (code >= WIDE_START && code <= WIDE_END) {
    return String.fromCodePoint(code - WIDE_GAP).toLowerCase();
  }
  // 全角スペースは半角に（「安部　正太」と「安部 正太」を同じに扱う）
  if (code === 0x3000) return " ";
  return ch.toLowerCase();
};

/**
 * 当たり判定に使う形と、元の位置の対応。
 * 印を付ける（`Highlight`）ときはこちらを使う。
 */
export function toSearchText(text: string): SearchText {
  return scan(text, foldForSearch);
}

/** 当たり判定に使う形だけが要るとき（絞り込みなど）はこちら */
export function searchKey(text: string): string {
  return toSearchText(text).key;
}

/** ひらがなに寄せる（半角カナも畳む） */
export function toHiragana(text: string): string {
  return scan(text, foldToHiragana).key;
}

/** カタカナに寄せる（半角カナも畳む） */
export function toKatakana(text: string): string {
  return scan(text, foldToKatakana).key;
}

/**
 * DB へ投げる検索語の書き分け。
 *
 * Postgres の ilike はひらがな・カタカナ・半角カナを別の文字として扱うので、
 * 端末の中でやるように寄せて比べられない。代わりに「打った通り・ひらがな・
 * カタカナ」の3通りを投げて、どれかに当たれば拾う。同じものは1つにまとめる。
 */
export function kanaVariants(q: string): string[] {
  return [...new Set([q, toHiragana(q), toKatakana(q)])].filter((v) => v !== "");
}
