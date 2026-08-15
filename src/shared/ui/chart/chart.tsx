"use client";

import type { EChartsOption } from "echarts";
import dynamic from "next/dynamic";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });
const chartFont = '"Noto Sans JP Variable", "Noto Sans JP", sans-serif';

export function Chart({
  option,
  height = 320,
  ariaLabel,
}: {
  option: EChartsOption;
  height?: number | string;
  ariaLabel?: string;
}) {
  const chartOption: EChartsOption = {
    ...option,
    textStyle: {
      fontFamily: chartFont,
      ...option.textStyle,
    },
  };
  const chart = (
    <ReactECharts
      option={chartOption}
      style={{ height }}
      opts={{
        renderer: "canvas",
        devicePixelRatio: typeof window === "undefined" ? 1 : Math.min(window.devicePixelRatio, 2),
      }}
      notMerge
      lazyUpdate
    />
  );
  const wrapperStyle = height === "100%" ? { height: "100%" } : undefined;
  return ariaLabel ? (
    <div role="img" aria-label={ariaLabel} style={wrapperStyle}>
      {chart}
    </div>
  ) : (
    <div style={wrapperStyle}>{chart}</div>
  );
}

export function chartTextColor(): string {
  if (typeof window === "undefined") return "#94a3b8";
  return getComputedStyle(document.documentElement).getPropertyValue("--muted").trim() || "#94a3b8";
}
