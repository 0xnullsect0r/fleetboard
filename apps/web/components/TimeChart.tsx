"use client";

import { useEffect, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

const css = (el: Element, name: string) => getComputedStyle(el).getPropertyValue(name).trim();

export interface TimeChartProps {
  title: string;
  t: number[];
  values: (number | null)[];
  format: (v: number) => string;
  height?: number;
  /** Area fill under the line. */
  fill?: boolean;
}

/**
 * Single-series time chart in the console style: amber trace, faint grid,
 * mono axes, and a readout line that tracks the cursor (latest value at rest).
 */
export function TimeChart({ title, t, values, format, height = 180, fill = true }: TimeChartProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const data = useRef<uPlot.AlignedData>([t, values]);
  data.current = [t, values];
  const [cursor, setCursor] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current!;
    const build = () => {
      plot.current?.destroy();
      const font = `10px ${getComputedStyle(document.body).fontFamily}`;
      const axis = (values: uPlot.Axis["values"], size: number): uPlot.Axis => ({
        stroke: css(el, "--muted"),
        font,
        size,
        values,
        grid: { stroke: css(el, "--line"), width: 1 },
        ticks: { stroke: css(el, "--line"), width: 1, size: 4 },
      });
      plot.current = new uPlot(
        {
          width: el.clientWidth,
          height,
          padding: [8, 8, 0, 0],
          legend: { show: false },
          cursor: { y: false, points: { size: 6, fill: css(el, "--accent"), stroke: css(el, "--accent") }, drag: { x: false, y: false } },
          select: { show: false, left: 0, top: 0, width: 0, height: 0 },
          scales: { x: { time: true }, y: { range: (_u, _min, max) => [0, max && max > 0 ? max * 1.15 : 1] } },
          axes: [axis(undefined, 44), axis((_u, splits) => splits.map((v) => format(v)), 72)],
          series: [
            {},
            {
              stroke: css(el, "--accent"),
              width: 1.5,
              ...(fill ? { fill: css(el, "--accent-soft") } : {}),
              points: { show: false },
              spanGaps: false,
            },
          ],
          hooks: { setCursor: [(u) => setCursor(u.cursor.idx ?? null)] },
        },
        data.current,
        el,
      );
    };
    build();
    const ro = new ResizeObserver(() => plot.current?.setSize({ width: el.clientWidth, height }));
    ro.observe(el);
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    mq.addEventListener("change", build);
    return () => {
      ro.disconnect();
      mq.removeEventListener("change", build);
      plot.current?.destroy();
    };
  }, [height, fill, format]);

  useEffect(() => {
    plot.current?.setData([t, values]);
  }, [t, values]);

  let idx = cursor;
  if (idx === null) {
    idx = values.length - 1;
    while (idx > 0 && values[idx] == null) idx--;
  }
  const v = idx !== null && idx >= 0 ? values[idx] : null;
  const at = idx !== null && t[idx] !== undefined ? new Date(t[idx]! * 1000) : null;

  return (
    <figure className="min-w-0">
      <figcaption className="flex items-baseline gap-4 pb-2 text-[11px] tracking-[0.2em]">
        <span className="text-fg">{title}</span>
        <span className="ml-auto text-accent">{v != null ? format(v) : "—"}</span>
        <span className="w-[9.5rem] text-right text-muted">
          {at ? at.toLocaleString("en-GB", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""}
        </span>
      </figcaption>
      <div ref={wrap} className="w-full" style={{ height }} />
    </figure>
  );
}
