/**
 * 画面のあちこちで使う小さな部品
 */

import type { ReactNode } from "react";
import { categoryColor, categoryOf } from "@/lib/offices";

/** 詳細の中のボタン（リンク）の見た目 */
export const ACT = "inline-flex items-center rounded-lg border border-rule bg-[#eef2f1] px-2.5 py-1.5 text-[13px] font-bold text-ink";

export function Note({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="mb-2 grid gap-1.5 rounded-xl border border-rule bg-white p-4 text-sm">
      {title && <h2 className="font-bold">{title}</h2>}
      <p className="text-muted">{children}</p>
    </div>
  );
}

export function ServiceChip({ service }: { service: string }) {
  const color = categoryColor(categoryOf(service));
  return (
    <span className="rounded px-1.5 text-[11px] font-bold leading-relaxed" style={{ color, background: `${color}1f` }}>
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
    <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto pb-0.5" role="group" aria-label={label}>
      <span className="shrink-0 pr-0.5 text-xs text-muted">{label}</span>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-[13px] tabular-nums ${on ? "border-accent bg-accent text-white" : "border-rule bg-white"}`}
          >
            {o.color && <span className="h-2.5 w-2.5 rounded-full border border-white/70" style={{ background: o.color }} />}
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
