import { useMemo, useState } from "react";
import "./chart-tokens.css";
import styles from "./BarChart.module.css";
import type { SparklineTone } from "./Sparkline";

const toneVar: Record<SparklineTone, string> = {
  accent: "var(--chart-accent)",
  good: "var(--chart-good)",
  warning: "var(--chart-warning)",
  serious: "var(--chart-serious)",
  critical: "var(--chart-critical)"
};

export type BarDatum = { label: string; value: number; tone?: SparklineTone };

type BarChartProps = {
  data: BarDatum[];
  height?: number;
  formatValue?: (value: number) => string;
};

function niceMax(value: number): number {
  if (value <= 0) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

export function BarChart({ data, height = 180, formatValue }: BarChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const fmt = formatValue ?? ((v: number) => String(v));
  const maxValue = useMemo(() => niceMax(Math.max(1, ...data.map((d) => d.value))), [data]);

  return (
    <div className={styles.wrap} style={{ height }}>
      <div className={styles.baselineLine} />
      <div className={styles.bars}>
        {data.map((datum, index) => {
          const heightPct = Math.max(2, (datum.value / maxValue) * 100);
          const color = toneVar[datum.tone ?? "accent"];
          const isHovered = hoverIndex === index;
          return (
            <div
              key={datum.label}
              className={styles.barCol}
              onPointerEnter={() => setHoverIndex(index)}
              onPointerLeave={() => setHoverIndex((current) => (current === index ? null : current))}
              onFocus={() => setHoverIndex(index)}
              onBlur={() => setHoverIndex((current) => (current === index ? null : current))}
              tabIndex={0}
              role="img"
              aria-label={`${datum.label}: ${fmt(datum.value)}`}
            >
              {isHovered ? (
                <div className={styles.tooltip}>
                  <div className={styles.tooltipValue}>{fmt(datum.value)}</div>
                  <div className={styles.tooltipMeta}>{datum.label}</div>
                </div>
              ) : null}
              <div
                className={isHovered ? `${styles.bar} ${styles.barHover}` : styles.bar}
                style={{ height: `${heightPct}%`, background: color }}
              />
              <div className={styles.label}>{datum.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
