// ============================================================================
// LIVE GENERATION VISUALIZER (Light-Mode Studio Canvas)
// ============================================================================
import {
  INTRA_TARGET_SIM,
  MIN_INTRA_SIM,
  MAX_INTRA_SIM
} from '../helpers/constants.js';

const createVisualizer = (targetElem) => {
  let canvas = document.getElementById('generation-viz');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'generation-viz';
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.maxWidth = '860px';
    canvas.style.height = '340px';
    canvas.style.margin = '16px 0';
    canvas.style.border = '1px solid #e5e7eb';
    canvas.style.borderRadius = '8px';
    canvas.style.background = '#ffffff';

    if (targetElem && targetElem.parentNode) {
      targetElem.parentNode.insertBefore(canvas, targetElem);
    } else {
      document.body.appendChild(canvas);
    }
  }

  const ctx = canvas.getContext('2d');

  // Deterministic 384D -> 2D random projection axes so semantic neighbors stay close in 2D
  const makeAxis = (seedOffset) => {
    const vec = new Float32Array(384);
    let norm = 0;
    for (let i = 0; i < 384; i++) {
      const val = Math.sin((i + 1) * (12.9898 + seedOffset)) * 43758.5453;
      const frac = val - Math.floor(val) - 0.5;
      vec[i] = frac;
      norm += frac * frac;
    }
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < 384; i++) vec[i] /= norm;
    return vec;
  };

  const axisX = makeAxis(0);
  const axisY = makeAxis(7.13);

  const projectVectors = (candidates, promptVec) => {
    const projectOne = (v) => {
      if (!v) return { rawX: Math.random() - 0.5, rawY: Math.random() - 0.5 };
      let x = 0;
      let y = 0;
      const len = Math.min(v.length, 384);
      for (let i = 0; i < len; i++) {
        x += v[i] * axisX[i];
        y += v[i] * axisY[i];
      }
      return { rawX: x, rawY: y };
    };

    const rawPts = candidates.map(c => projectOne(c.vector));
    const promptRaw = promptVec ? projectOne(promptVec) : null;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const allPts = promptRaw ? [...rawPts, promptRaw] : rawPts;
    for (const p of allPts) {
      if (p.rawX < minX) minX = p.rawX;
      if (p.rawX > maxX) maxX = p.rawX;
      if (p.rawY < minY) minY = p.rawY;
      if (p.rawY > maxY) maxY = p.rawY;
    }

    const spanX = Math.max(0.001, maxX - minX);
    const spanY = Math.max(0.001, maxY - minY);

    candidates.forEach((c, idx) => {
      c.vizX = (rawPts[idx].rawX - minX) / spanX;
      c.vizY = (rawPts[idx].rawY - minY) / spanY;
    });

    return promptRaw
      ? { x: (promptRaw.rawX - minX) / spanX, y: (promptRaw.rawY - minY) / spanY }
      : null;
  };

  const render = ({
    phase = 'Ready',
    detail = 'Click Generate to watch Markov walks and semantic leaps',
    candidates = [],
    promptPt = null,
    chosen = [],
    topKIds = new Set(),
    validIds = new Set(),
    latestPick = null,
  } = {}) => {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(320, rect.width || 860);
    const height = Math.max(260, rect.height || 340);

    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);

    // 1. Crisp white canvas background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    const padLeft = 24;
    const padRight = 24;
    const padTop = 48;
    const padBottom = 78;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    const toScreen = (nx, ny) => ({
      x: padLeft + nx * plotW,
      y: padTop + ny * plotH,
    });

    // 2. Subtle architectural grid
    ctx.strokeStyle = '#f3f4f6';
    ctx.lineWidth = 1;
    for (let g = 0; g <= 4; g++) {
      const gx = padLeft + (plotW * g) / 4;
      const gy = padTop + (plotH * g) / 4;
      ctx.beginPath();
      ctx.moveTo(gx, padTop);
      ctx.lineTo(gx, padTop + plotH);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(padLeft, gy);
      ctx.lineTo(padLeft + plotW, gy);
      ctx.stroke();
    }

    // 3. Top Header HUD
    ctx.fillStyle = '#111827';
    ctx.font = '600 13px system-ui, -apple-system, sans-serif';
    ctx.fillText(phase, padLeft, 22);

    ctx.fillStyle = '#6b7280';
    ctx.font = '12px system-ui, -apple-system, sans-serif';
    ctx.fillText(detail, padLeft, 38);

    // Legend (top-right)
    const legendItems = [
      { color: '#d1d5db', label: 'Filtered' },
      { color: '#60a5fa', label: 'Valid' },
      { color: '#d97706', label: 'Top-K' },
      { color: '#1d4ed8', label: 'Chosen Path' },
    ];
    let lx = width - padRight;
    ctx.font = '11px system-ui, -apple-system, sans-serif';
    for (let i = legendItems.length - 1; i >= 0; i--) {
      const item = legendItems[i];
      const textW = ctx.measureText(item.label).width;
      lx -= textW;
      ctx.fillStyle = '#4b5563';
      ctx.fillText(item.label, lx, 22);
      lx -= 12;
      ctx.fillStyle = item.color;
      ctx.beginPath();
      ctx.arc(lx + 4, 18, 4, 0, Math.PI * 2);
      ctx.fill();
      lx -= 12;
    }

    // 4. Candidate Pool Nodes
    for (const c of candidates) {
      if (c.vizX === undefined) continue;
      const pt = toScreen(c.vizX, c.vizY);
      const isTop = topKIds.has(c.text);
      const isValid = validIds.has(c.text);

      ctx.beginPath();
      ctx.arc(pt.x, pt.y, isTop ? 4.5 : isValid ? 3 : 2.2, 0, Math.PI * 2);
      ctx.fillStyle = isTop ? '#f59e0b' : isValid ? '#93c5fd' : '#e5e7eb';
      ctx.fill();

      if (isTop) {
        ctx.strokeStyle = '#d97706';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }

    // 5. Prompt Anchor (if prompt provided)
    if (promptPt) {
      const pScreen = toScreen(promptPt.x, promptPt.y);
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.25)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(pScreen.x, pScreen.y, 48, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#059669';
      ctx.beginPath();
      ctx.arc(pScreen.x, pScreen.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '600 10px system-ui, -apple-system, sans-serif';
      ctx.fillText('PROMPT', pScreen.x + 8, pScreen.y + 3);
    }

    // 6. Chosen Poem Semantic Trajectory
    if (chosen.length > 0) {
      ctx.strokeStyle = 'rgba(29, 78, 216, 0.45)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      chosen.forEach((c, idx) => {
        const pt = toScreen(c.vizX, c.vizY);
        if (idx === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.stroke();

      chosen.forEach((c, idx) => {
        const pt = toScreen(c.vizX, c.vizY);
        const isLatest = idx === chosen.length - 1;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, isLatest ? 6 : 4, 0, Math.PI * 2);
        ctx.fillStyle = isLatest ? '#1e40af' : '#3b82f6';
        ctx.fill();

        ctx.fillStyle = '#111827';
        ctx.font = isLatest ? '700 10px system-ui, sans-serif' : '10px system-ui, sans-serif';
        ctx.fillText(`${idx + 1}`, pt.x + 6, pt.y - 4);
      });
    }

    // 7. Bottom Intra-Line Conceptual Bridge Bar
    const footerY = height - 62;
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padLeft, footerY);
    ctx.lineTo(width - padRight, footerY);
    ctx.stroke();

    if (latestPick) {
      const c = latestPick.candidate;
      ctx.fillStyle = '#111827';
      ctx.font = '600 12px system-ui, -apple-system, sans-serif';
      const title = c.halves
        ? `Intra-line split: "${c.halves.left}"  ⟷  "${c.halves.right}"`
        : `Short line: "${c.text}"`;
      ctx.fillText(title.slice(0, 95), padLeft, footerY + 20);

      // Gauge bar for intraSim (0.0 -> 1.0)
      const barX = padLeft;
      const barY = footerY + 32;
      const barW = Math.min(340, width - padLeft - padRight);
      const barH = 8;

      ctx.fillStyle = '#f3f4f6';
      ctx.fillRect(barX, barY, barW, barH);

      // Highlight valid intra-line sweet spot [MIN_INTRA_SIM .. MAX_INTRA_SIM]
      const minX = barX + MIN_INTRA_SIM * barW;
      const maxX = barX + MAX_INTRA_SIM * barW;
      ctx.fillStyle = '#fef3c7';
      ctx.fillRect(minX, barY, maxX - minX, barH);

      // Target tick (INTRA_TARGET_SIM)
      const targetX = barX + INTRA_TARGET_SIM * barW;
      ctx.fillStyle = '#d97706';
      ctx.fillRect(targetX - 1, barY - 2, 2, barH + 4);

      if (latestPick.intraSim !== null) {
        const valX = barX + Math.max(0, Math.min(1, latestPick.intraSim)) * barW;
        ctx.beginPath();
        ctx.arc(valX, barY + barH / 2, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#1d4ed8';
        ctx.fill();

        ctx.fillStyle = '#4b5563';
        ctx.font = '11px system-ui, -apple-system, sans-serif';
        ctx.fillText(
          `intraSim: ${latestPick.intraSim} (target ${INTRA_TARGET_SIM})  |  maxLineSim: ${latestPick.maxLineSim}  |  fitness: ${latestPick.fitness.toFixed(3)}`,
          barX + barW + 14,
          barY + 8
        );
      } else {
        ctx.fillStyle = '#6b7280';
        ctx.font = '11px system-ui, -apple-system, sans-serif';
        ctx.fillText(
          `Short closing cadence (<6 words)  |  maxLineSim: ${latestPick.maxLineSim}  |  fitness: ${latestPick.fitness.toFixed(3)}`,
          barX + barW + 14,
          barY + 8
        );
      }
    }

    ctx.restore();
  };

  render();
  return { render, projectVectors };
};

export default createVisualizer;