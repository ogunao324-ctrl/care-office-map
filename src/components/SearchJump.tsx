"use client";

/**
 * 「さがす」以外のタブで使う検索窓。事業所名・法人名・住所・電話番号で探し、
 * 選ぶと「さがす」に移ってその事業所の詳細を開く（距離の範囲は問わない）。
 */

import { useMemo, useState } from "react";
import { digitsOnly, formatDistance } from "@/lib/offices";
import { searchKey } from "@/lib/search-text";
import type { Row } from "./OfficeList";
import { ServiceChip } from "./ui";

const MAX = 8;

export function SearchJump({ rows, onPick }: { rows: Row[]; onPick: (id: string) => void }) {
  const [query, setQuery] = useState("");

  const hits = useMemo(() => {
    const q = searchKey(query.trim()).replace(/\s/g, "");
    const qDigits = digitsOnly(query);
    if (!q) return { list: [] as Row[], total: 0 };
    const all = rows.filter((o) => o.key.replace(/\s/g, "").includes(q) || (qDigits.length >= 3 && o.key.includes(qDigits)));
    all.sort((a, b) => (a.distance ?? 99) - (b.distance ?? 99));
    return { list: all.slice(0, MAX), total: all.length };
  }, [rows, query]);

  return (
    <div className="relative lg:min-w-[320px] lg:flex-1">
      <label className="flex items-center gap-2 rounded-lg border border-rule bg-white px-3">
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          autoComplete="off"
          enterKeyHint="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="事業所を探す（名前・法人名・住所・電話番号）"
          aria-label="事業所を検索"
          className="has-custom-clear min-w-0 flex-1 bg-transparent py-2.5 text-base outline-none"
        />
        {query && (
          <button type="button" onClick={() => setQuery("")} className="shrink-0 text-sm text-muted" aria-label="検索語を消す">
            ×
          </button>
        )}
      </label>
      {query.trim() && (
        <div className="absolute inset-x-0 top-full z-[1100] mt-1 max-h-[60vh] overflow-y-auto rounded-lg border border-ink bg-white shadow-md">
          {hits.list.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted">見つかりませんでした。</p>
          ) : (
            <ul>
              {hits.list.map((o) => (
                <li key={o.id} className="border-b border-rule last:border-b-0">
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      onPick(o.id);
                    }}
                    className="grid w-full grid-cols-[1fr_auto] gap-x-2 gap-y-0.5 px-3 py-2 text-left hover:bg-[#f3f5f2]"
                  >
                    <span className="min-w-0 break-words text-[14px] font-bold leading-snug">{o.name}</span>
                    <span className="whitespace-nowrap text-xs tabular-nums text-muted">{o.self ? "自社" : formatDistance(o.distance)}</span>
                    <span className="col-span-2 flex flex-wrap items-center gap-1 text-xs text-muted">
                      {o.services.map((s) => (
                        <ServiceChip key={s} service={s} />
                      ))}
                      {o.corp && <span>{o.corp}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {hits.total > MAX && (
            <p className="border-t border-rule px-3 py-2 text-xs text-muted">ほか {hits.total - MAX} 件。言葉を足して絞り込んでください。</p>
          )}
        </div>
      )}
    </div>
  );
}
