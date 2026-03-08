import { useEffect, useRef } from "react";

interface PriceSparklineProps {
  /** Price history values (0-1 range). Most recent last. */
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  /** Show area fill under the line. */
  fill?: boolean;
}

/**
 * Lightweight canvas-based sparkline for inline price charts.
 * No external dependencies — pure canvas rendering.
 */
export function PriceSparkline({
  data,
  width = 60,
  height = 20,
  color = "#3b82f6",
  fill = true,
}: PriceSparklineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length < 2) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 0.001;
    const pad = 2;

    const points: [number, number][] = data.map((v, i) => [
      (i / (data.length - 1)) * width,
      pad + (1 - (v - min) / range) * (height - pad * 2),
    ]);

    // Fill area
    if (fill) {
      ctx.beginPath();
      ctx.moveTo(points[0][0], height);
      for (const [x, y] of points) {
        ctx.lineTo(x, y);
      }
      ctx.lineTo(points[points.length - 1][0], height);
      ctx.closePath();
      ctx.fillStyle = color + "15";
      ctx.fill();
    }

    // Line
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i][0], points[i][1]);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.lineJoin = "round";
    ctx.stroke();

    // End dot
    const last = points[points.length - 1];
    ctx.beginPath();
    ctx.arc(last[0], last[1], 1.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }, [data, width, height, color, fill]);

  if (data.length < 2) return null;

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ width, height }}
      className="shrink-0"
    />
  );
}
