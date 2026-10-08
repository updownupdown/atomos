// The spiral map: all 118 elements on one continuous curve by proton number.
// An Archimedean arm (r ~ theta) with theta ~ sqrt(theta0^2 + k i) spaces neighbours
// evenly along it; theta0 keeps the first elements off the crowded centre.

import { ALL_SYMBOLS } from '../core/elements';

export interface SpiralNode {
  z: number;
  symbol: string;
  x: number;
  y: number;
  r: number;
  state: 'built' | 'frontier' | 'locked' | 'future';
  colour: string;
}

export function layoutSpiral(size: number, states: (z: number) => SpiralNode['state'], colour: (z: number) => string): SpiralNode[] {
  const n = ALL_SYMBOLS.length;
  const cx = size / 2, cy = size / 2;
  const theta = (i: number) => Math.sqrt(36 + 9.5 * i);
  const maxTheta = theta(n - 1);
  const radius = size * 0.47;
  return ALL_SYMBOLS.map((symbol, i) => {
    const th = theta(i);
    const rr = (radius * th) / maxTheta;
    const state = states(i + 1);
    const r = state === 'built' ? size * 0.03 : state === 'frontier' ? size * 0.03 : state === 'locked' ? size * 0.024 : size * 0.008;
    return { z: i + 1, symbol, x: cx + rr * Math.cos(th - Math.PI / 2), y: cy + rr * Math.sin(th - Math.PI / 2), r, state, colour: colour(i + 1) };
  });
}

export function drawSpiral(canvas: HTMLCanvasElement, nodes: SpiralNode[], t: number, selected: number | null): void {
  const ctx = canvas.getContext('2d')!;
  const dpr = canvas.width / canvas.clientWidth;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const size = canvas.clientWidth;
  ctx.clearRect(0, 0, size, size);

  // The arm itself.
  ctx.beginPath();
  nodes.forEach((n, i) => (i === 0 ? ctx.moveTo(n.x, n.y) : ctx.lineTo(n.x, n.y)));
  ctx.strokeStyle = 'rgba(226, 220, 207, 0.18)';
  ctx.lineWidth = 1;
  ctx.stroke();

  for (const n of nodes) {
    ctx.save();
    if (n.state === 'future') {
      ctx.fillStyle = 'rgba(226, 220, 207, 0.26)';
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      continue;
    }
    if (n.state === 'built') {
      const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r * 1.9);
      g.addColorStop(0, n.colour);
      g.addColorStop(0.45, hexA(n.colour, 0.45));
      g.addColorStop(1, hexA(n.colour, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r * 1.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0c0b0a';
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r * 0.95, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = n.colour;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else if (n.state === 'frontier') {
      const pulse = 0.5 + 0.5 * Math.sin(t * 3);
      ctx.strokeStyle = `rgba(224, 80, 58, ${0.5 + 0.5 * pulse})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r * (1 + 0.15 * pulse), 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgba(226, 220, 207, 0.35)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (selected === n.z) {
      ctx.setLineDash([]);
      ctx.strokeStyle = '#f3eee2';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r * 1.35, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = n.state === 'locked' ? 'rgba(226, 220, 207, 0.55)' : n.state === 'frontier' ? '#e0503a' : '#f3eee2';
    ctx.font = `700 ${Math.round(n.r * (n.state === 'locked' ? 0.85 : 0.8))}px 'Courier Prime', 'Courier New', monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(n.state === 'frontier' ? n.symbol : n.symbol, n.x, n.y + 1);
    ctx.restore();
  }
}

export function hitSpiral(nodes: SpiralNode[], x: number, y: number): SpiralNode | null {
  let best: SpiralNode | null = null;
  let bestD = Infinity;
  for (const n of nodes) {
    const d = Math.hypot(n.x - x, n.y - y);
    if (d < Math.max(n.r * 1.6, 16) && d < bestD) {
      best = n;
      bestD = d;
    }
  }
  return best;
}

function hexA(hex: string, a: number): string {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${a})`;
}
