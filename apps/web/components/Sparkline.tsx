"use client";

import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

function token(el: Element, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

/** Emphasized endpoint: a solid dot in the canvas plus a DOM phosphor tick over it. */
function endpointPlugin(dot: HTMLElement): uPlot.Plugin {
  return {
    hooks: {
      draw: (u) => {
        const xs = u.data[0];
        const ys = u.data[1]!;
        let i = xs.length - 1;
        while (i >= 0 && ys[i] == null) i--;
        if (i < 0) {
          dot.style.display = "none";
          return;
        }
        const x = u.valToPos(xs[i]!, "x");
        const y = u.valToPos(ys[i]!, "y");
        dot.style.display = "block";
        dot.style.transform = `translate(${x + u.bbox.left / uPlot.pxRatio - 3}px, ${y + u.bbox.top / uPlot.pxRatio - 3}px)`;
      },
    },
  };
}

function yRange(_u: uPlot, min: number | null, max: number | null): uPlot.Range.MinMax {
  if (min == null || max == null) return [0, 1];
  const span = max - min;
  const pad = Math.max(span * 0.25, Math.abs(max) * 0.03, 1);
  return [Math.max(0, min - pad), max + pad];
}

/** Thin live area sparkline with a faint grid; colors follow the CSS tokens. */
export function Sparkline({ data, height = 64 }: { data: [number[], number[]]; height?: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const dot = useRef<HTMLSpanElement>(null);
  const plot = useRef<uPlot | null>(null);
  const latest = useRef(data);
  latest.current = data;

  useEffect(() => {
    const el = wrap.current!;
    const build = () => {
      plot.current?.destroy();
      const accent = token(el, "--accent");
      const line = token(el, "--line");
      const blank = (_u: uPlot, splits: number[]) => splits.map(() => "");
      const axis: uPlot.Axis = { size: 0, gap: 0, ticks: { show: false }, values: blank, grid: { stroke: line, width: 1 } };
      plot.current = new uPlot(
        {
          width: el.clientWidth,
          height,
          padding: [6, 4, 6, 0],
          legend: { show: false },
          cursor: { show: false },
          select: { show: false, left: 0, top: 0, width: 0, height: 0 },
          scales: { x: { time: true }, y: { range: yRange } },
          axes: [{ ...axis, space: 60 }, { ...axis, space: 18 }],
          series: [{}, { stroke: accent, width: 1.5, fill: token(el, "--accent-soft"), points: { show: false } }],
          plugins: [endpointPlugin(dot.current!)],
        },
        latest.current as uPlot.AlignedData,
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
      plot.current = null;
    };
  }, [height]);

  useEffect(() => {
    plot.current?.setData(data as uPlot.AlignedData);
  }, [data]);

  return (
    <div ref={wrap} className="relative w-full" style={{ height }}>
      <span
        ref={dot}
        aria-hidden
        className="tick-live pointer-events-none absolute left-0 top-0 z-10 hidden size-1.5 bg-accent"
      />
    </div>
  );
}
