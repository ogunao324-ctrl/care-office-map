/**
 * 画面のあちこちで使う小さな部品
 */

import type { ReactNode } from "react";
import { categoryColor, categoryOf } from "@/lib/offices";

/** 詳細の中のボタン（リンク）の見た目 */
export const ACT =
  "inline-flex items-center gap-1 rounded-xl border border-ink/10 bg-white/90 px-2.5 py-1.5 text-[13px] font-bold text-ink shadow-[0_1px_2px_rgba(16,40,38,0.06)] transition-[box-shadow,transform] hover:-translate-y-px hover:shadow-[0_6px_14px_-6px_rgba(16,40,38,0.3)]";

/** 主なボタン（グラデーション）。ACT と組み合わせて使う */
export const ACT_MAIN = "border-transparent bg-grad shadow-[0_6px_14px_-6px_rgba(29,93,102,0.7)]";

export function Note({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="card mb-2 grid gap-1.5 p-4 text-sm">
      {title && <h2 className="font-bold">{title}</h2>}
      <p className="text-muted">{children}</p>
    </div>
  );
}

export function ServiceChip({ service }: { service: string }) {
  const color = categoryColor(categoryOf(service));
  return (
    <span className="rounded-md px-1.5 text-[11px] font-bold leading-relaxed" style={{ color, background: `${color}17`, boxShadow: `inset 0 0 0 1px ${color}2b` }}>
      {service}
    </span>
  );
}

/** 横に並ぶ選択ボタン（1つだけ選ぶ） */
export function PickChips<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string; color?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto pb-0.5 lg:flex-wrap lg:overflow-visible lg:pb-0" role="group" aria-label={label}>
      <span className="shrink-0 pr-0.5 text-xs text-muted">{label}</span>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={`chip ${on ? "chip-on" : ""}`}
          >
            {o.color && <span className="h-2.5 w-2.5 rounded-full ring-2 ring-white/80" style={{ background: o.color, boxShadow: `0 0 8px ${o.color}aa` }} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("ja-JP");
}
