import { useMemo } from "react";
import "./chart-tokens.css";

export type SparklineTone = "accent" | "good" | "warning" | "serious" | "critical";

type SparklineProps = {
  data: number[];
  tone?: SparklineTone;
  width?: number;
  height?: number;
  area?: boolean;
};

const toneVar: Record<SparklineTone, string> = {
  accent: "var(--chart-accent)",
  good: "var(--chart-good)",
  warning: "var(--chart-warning)",
  serious: "var(--chart-serious)",
  critical: "var(--chart-critical)"
};

/** Compact decorative trend line for a stat tile — no axes, no tooltip (see dataviz skill: figures §). */
export function Sparkline({ data, tone = "accent", width = 96, height = 28, area = true }: SparklineProps) {
  const { linePath, areaPath } = useMemo(() => {
    if (data.length < 2) return { linePath: "", areaPath: "" };

    const min = Math.min(...data);
    const max = Math.max(...data);
    const span = max - min || 1;
    const stepX = width / (data.length - 1);
    const pad = 2;

    const points = data.map((value, index) => {
      const x = index * stepX;
      const y = pad + (1 - (value - min) / span) * (height - pad * 2);
      return [x, y] as const;
    });

    const line = points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const areaClose = `L${width},${height} L0,${height} Z`;
    return { linePath: line, areaPath: `${line} ${areaClose}` };
  }, [data, width, height]);

  if (!linePath) {
    return <svg width={width} height={height} aria-hidden="true" />;
  }

  const color = toneVar[tone];

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {area ? <path d={areaPath} fill={color} opacity={0.12} stroke="none" /> : null}
      <path d={linePath} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
