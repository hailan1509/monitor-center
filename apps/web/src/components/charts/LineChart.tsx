import { useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import "./chart-tokens.css";
import styles from "./LineChart.module.css";
import type { SparklineTone } from "./Sparkline";

const toneVar: Record<SparklineTone, string> = {
  accent: "var(--chart-accent)",
  good: "var(--chart-good)",
  warning: "var(--chart-warning)",
  serious: "var(--chart-serious)",
  critical: "var(--chart-critical)"
};

export type LineChartPoint = { x: string; y: number };

type LineChartProps = {
  data: LineChartPoint[];
  tone?: SparklineTone;
  height?: number;
  seriesLabel: string;
  formatX?: (iso: string) => string;
  formatY?: (value: number) => string;
};

function niceMax(value: number): number {
  if (value <= 0) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

const LOGICAL_WIDTH = 640;
const PAD_LEFT = 34;
const PAD_RIGHT = 8;
const PAD_TOP = 10;
const PAD_BOTTOM = 24;

export function LineChart({ data, tone = "accent", height = 220, seriesLabel, formatX, formatY }: LineChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const plotWidth = LOGICAL_WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotHeight = height - PAD_TOP - PAD_BOTTOM;

  const { points, yTicks, maxY, linePath, areaPath } = useMemo(() => {
    const maxValue = niceMax(Math.max(1, ...data.map((d) => d.y)));
    const stepX = data.length > 1 ? plotWidth / (data.length - 1) : 0;

    const pts = data.map((d, index) => {
      const x = PAD_LEFT + index * stepX;
      const y = PAD_TOP + (1 - d.y / maxValue) * plotHeight;
      return { ...d, cx: x, cy: y };
    });

    const line = pts.map((p, index) => `${index === 0 ? "M" : "L"}${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join(" ");
    const area = pts.length
      ? `${line} L${pts[pts.length - 1].cx.toFixed(1)},${PAD_TOP + plotHeight} L${PAD_LEFT},${PAD_TOP + plotHeight} Z`
      : "";

    const ticks = [0, 0.5, 1].map((fraction) => Math.round(maxValue * fraction));

    return { points: pts, yTicks: ticks, maxY: maxValue, linePath: line, areaPath: area };
  }, [data, plotWidth, plotHeight]);

  function handlePointerMove(event: ReactPointerEvent<SVGRectElement>) {
    if (!svgRef.current || points.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const scale = LOGICAL_WIDTH / rect.width;
    const localX = (event.clientX - rect.left) * scale;

    let nearest = 0;
    let nearestDist = Infinity;
    points.forEach((p, index) => {
      const dist = Math.abs(p.cx - localX);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = index;
      }
    });
    setHoverIndex(nearest);
  }

  const hovered = hoverIndex !== null ? points[hoverIndex] : null;
  const color = toneVar[tone];
  const xFmt = formatX ?? ((iso: string) => iso);
  const yFmt = formatY ?? ((v: number) => String(v));

  return (
    <div className={styles.wrap}>
      <svg
        ref={svgRef}
        className={styles.svg}
        viewBox={`0 0 ${LOGICAL_WIDTH} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${seriesLabel} trend chart`}
      >
        {yTicks.map((tick) => {
          const y = PAD_TOP + (1 - tick / (maxY || 1)) * plotHeight;
          return (
            <g key={tick}>
              <line x1={PAD_LEFT} x2={LOGICAL_WIDTH - PAD_RIGHT} y1={y} y2={y} className={styles.gridline} />
              <text x={PAD_LEFT - 8} y={y} textAnchor="end" dominantBaseline="middle" className={styles.axisLabel}>
                {yFmt(tick)}
              </text>
            </g>
          );
        })}

        <line
          x1={PAD_LEFT}
          x2={LOGICAL_WIDTH - PAD_RIGHT}
          y1={PAD_TOP + plotHeight}
          y2={PAD_TOP + plotHeight}
          className={styles.baseline}
        />

        {areaPath ? <path d={areaPath} fill={color} opacity={0.1} stroke="none" /> : null}
        {linePath ? <path d={linePath} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" /> : null}

        {points.length > 0 ? (
          <>
            <text x={PAD_LEFT} y={height - 6} textAnchor="start" className={styles.axisLabel}>
              {xFmt(points[0].x)}
            </text>
            <text x={LOGICAL_WIDTH - PAD_RIGHT} y={height - 6} textAnchor="end" className={styles.axisLabel}>
              {xFmt(points[points.length - 1].x)}
            </text>
          </>
        ) : null}

        {hovered ? (
          <>
            <line x1={hovered.cx} x2={hovered.cx} y1={PAD_TOP} y2={PAD_TOP + plotHeight} className={styles.crosshair} />
            <circle cx={hovered.cx} cy={hovered.cy} r={4} fill={color} stroke="var(--chart-tooltip-bg)" strokeWidth={2} />
          </>
        ) : null}

        <rect
          x={PAD_LEFT}
          y={PAD_TOP}
          width={plotWidth}
          height={plotHeight}
          fill="transparent"
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setHoverIndex(null)}
        />
      </svg>

      {hovered ? (
        <div
          className={styles.tooltip}
          style={{ left: `${(hovered.cx / LOGICAL_WIDTH) * 100}%` }}
          role="status"
        >
          <div className={styles.tooltipValue}>{yFmt(hovered.y)}</div>
          <div className={styles.tooltipMeta}>
            <span className={styles.tooltipKey} style={{ background: color }} aria-hidden="true" />
            {seriesLabel} · {xFmt(hovered.x)}
          </div>
        </div>
      ) : null}
    </div>
  );
}
