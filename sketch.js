const files = `
Bjork - Venus as a boy.txt
Grandaddy - Jeds other poem.txt
John Cooper Clarke - I wanna be yours.txt
Laurie Anderson - Born, never asked.txt
Sparklehorse - Spirit Ditch.txt
Spinvis - Bagagedrager.txt
Spinvis - Dagen van gras, dagen van stro.txt
Spinvis - Hallo, Maandag.txt
Spinvis - Heel goed zwemmen.txt
Spinvis - Het voordeel van video.txt
Spinvis - Ik wil alleen maar zwemmen.txt
Spinvis - Kom Terug.txt
Spinvis - Koning Alcohol.txt
Spinvis - Lente 22.txt
Spinvis - Limonadeglazen Wodka.txt
Spinvis - Loop Der Dingen.txt
Spinvis - Oostende.txt
Spinvis - Op Een Ochtend In Het Heelal.txt
Spinvis - Paradijs.txt
Spinvis - Picasso.txt
Spinvis - Smalfilm.txt
Spinvis - Tot ziens.txt
Spinvis - Voor ik vergeet.txt
Spinvis - Wespen op de Appeltaart.txt
`.trim().split('\n').map(file => file.trim()).filter(Boolean);

let ORDER = 3;
let LOOSENESS = 0.75;             // 0.0 = tight/literal theme | 0.5 = poetic leap | 1.0 = surreal/distant
const LOOSENESS_LINE_LIMIT = 15;  // Apply prompt looseness only to the first 15 verses (indices 0..14)
const MAX_LINE_SIMILARITY = 0.45; // Hard semantic ceiling between ANY two lines in the poem (lower = stricter)
const MAX_WORD_OVERLAP = 0.35;    // Max allowed ratio of shared content words between any two lines

// Intra-line diversity controls (applied to lines with 6+ words)
const INTRA_TARGET_SIM = 0.28;    // Sweet spot: distinct concepts inside one line with subtle associative glue
const MIN_INTRA_SIM = 0.02;       // Floor: blocks total non-sequitur gibberish
const MAX_INTRA_SIM = 0.58;       // Ceiling: blocks tautologies and internal refrains

// Visualization pacing (ms per verse; set lower for faster generation, higher to inspect each step)
const STEP_DELAY_MS = 180;

let corpus = '';
let extractor = null;

const generateBtn = document.getElementById('generate-btn');
const corpusTextArea = document.getElementById('corpus');
const outputTextarea = document.getElementById('output');
const promptInput = document.getElementById('prompt');
const markovOrderValuePreview = document.getElementById('markov-order-value');
const markovOrderSelector = document.getElementById('markov-order-selector');

let markov = RiTa.markov(ORDER);

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ============================================================================
// LIVE GENERATION VISUALIZER (Light-Mode Studio Canvas)
// ============================================================================
const createVisualizer = () => {
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

    if (outputTextarea && outputTextarea.parentNode) {
      outputTextarea.parentNode.insertBefore(canvas, outputTextarea);
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

const visualizer = createVisualizer();

// ============================================================================
// CORE MARKOV + SEMANTIC POETRY GENERATOR
// ============================================================================
const renderOutput = (text) => {
  if (!outputTextarea) {
    console.error('Element #output not found in index.html');
    return;
  }

  const tag = outputTextarea.tagName;
  if (tag === 'TEXTAREA' || tag === 'INPUT') {
    outputTextarea.value = text;
  } else {
    const nestedField = outputTextarea.querySelector('textarea, input');
    if (nestedField) {
      nestedField.value = text;
    } else {
      outputTextarea.style.whiteSpace = 'pre-wrap';
      outputTextarea.textContent = text;
    }
  }
};

const rebuildMarkov = (order) => {
  ORDER = order;
  markov = RiTa.markov(ORDER);
  if (corpus) {
    markov.addText(corpus);
  }
};

const loadSemanticModel = async () => {
  try {
    const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3');
    extractor = await pipeline(
      'feature-extraction',
      'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
      { dtype: 'q8' }
    );
  } catch (err) {
    console.warn('Semantic model unavailable, falling back to pure Markov:', err);
  }
};

const initialize = async () => {
  generateBtn.disabled = true;
  generateBtn.innerText = 'Loading Corpus...';
  visualizer.render({ phase: 'Initializing', detail: 'Loading lyric corpus...' });

  markovOrderSelector.value = ORDER;
  markovOrderValuePreview.textContent = ORDER;

  markovOrderSelector.addEventListener('change', () => {
    const newOrder = parseInt(markovOrderSelector.value, 10);
    markovOrderValuePreview.textContent = newOrder;
    rebuildMarkov(newOrder);
  });

  generateBtn.addEventListener('click', async () => {
    generateBtn.disabled = true;
    generateBtn.innerText = 'Generating...';
    try {
      renderOutput(await generateText());
    } catch (err) {
      showError(err);
    } finally {
      generateBtn.disabled = false;
      generateBtn.innerText = 'Generate';
    }
  });

  try {
    await loadTexts(files);
    generateBtn.innerText = 'Loading AI Model...';
    visualizer.render({ phase: 'Initializing', detail: 'Loading multilingual transformer model (q8)...' });
    await loadSemanticModel();
    generateBtn.disabled = false;
    generateBtn.innerText = 'Generate';
    visualizer.render({
      phase: 'Ready',
      detail: 'Corpus and semantic model loaded. Click Generate to visualize.',
    });
  } catch (err) {
    showError(err);
    generateBtn.innerText = 'Load Failed';
  }
};

const normalize = (text) => {
  return text
    .replace(/[*{}()\[\]"“”]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/[,;:\-]+\s*(\r\n|\r|\n)/g, '$1')
    .replace(/\r\n|\r|\n+/g, '. ')
    .replace(/([.!?])\s*[.!?]+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
};

const cleanOutputLine = (line) => {
  let cleaned = line
    .replace(/^[.,;:!?\-*\s]+/, '')
    .replace(/[,;:\-.*]+$/, '')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();

  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  return cleaned;
};

const loadTexts = async (fileNames) => {
  const texts = await Promise.all(
    fileNames.map(async (file) => {
      const response = await fetch(`songs/${encodeURIComponent(file)}`);
      if (!response.ok) {
        throw new Error(`Failed to load ${file}: ${response.status} ${response.statusText}`);
      }
      return response.text();
    })
  );

  corpus = normalize(texts.join('\n'));
  if (corpusTextArea) {
    if (corpusTextArea.tagName === 'TEXTAREA' || corpusTextArea.tagName === 'INPUT') {
      corpusTextArea.value = corpus;
    } else {
      corpusTextArea.textContent = corpus;
    }
  }
  markov.addText(corpus);
};

const showError = (err) => {
  const message = err instanceof Error ? err.message : String(err);
  renderOutput(`Error: ${message}`);
};

const getLineBounds = (lineIndex, totalLines) => {
  const progress = lineIndex / Math.max(1, totalLines - 1);

  if (progress < 0.25) {
    return { minWords: 8, maxWords: 12 };
  } else if (progress < 0.75) {
    return { minWords: 10, maxWords: 15 };
  } else {
    return { minWords: 2, maxWords: 5 };
  }
};

const cosineSimilarity = (vecA, vecB) => {
  let dot = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
  }
  return dot;
};

const STOPWORDS = new Set([
  'and', 'of', 'to', 'in', 'is', 'it', 'that', 'for', 'on', 'with',
  'as', 'at', 'by', 'be', 'this', 'are', 'or', 'from', 'but', 'not', 'my', 'your',
  'i', 'you', 'he', 'she', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'so', 'all'
]);

const CLAUSE_HINGES = new Set([
  'and', 'but', 'or', 'while', 'when', 'where', 'that', 'because', 'with', 'without',
  'en', 'maar', 'of', 'terwijl', 'als', 'waar', 'dat', 'want', 'omdat', 'met', 'zonder'
]);

const extractLexicalFeatures = (text) => {
  const allWords = text
    .toLowerCase()
    .replace(/[^a-zà-ÿ0-9\s'-]/g, '')
    .split(/\s+/)
    .filter(Boolean);

  const filtered = allWords.filter(w => !STOPWORDS.has(w) && w.length > 2);
  const contentWords = new Set(filtered.length > 0 ? filtered : allWords);

  const trigrams = new Set();
  for (let i = 0; i <= allWords.length - 3; i++) {
    trigrams.add(`${allWords[i]} ${allWords[i + 1]} ${allWords[i + 2]}`);
  }

  return { contentWords, trigrams };
};

const hasInternalStutter = (text) => {
  const words = text
    .toLowerCase()
    .replace(/[^a-zà-ÿ0-9\s'-]/g, '')
    .split(/\s+/)
    .filter(Boolean);

  const bigrams = new Set();
  for (let i = 0; i < words.length; i++) {
    if (i > 0 && words[i] === words[i - 1]) return true;
    if (i < words.length - 1) {
      const bg = `${words[i]} ${words[i + 1]}`;
      if (bigrams.has(bg)) return true;
      bigrams.add(bg);
    }
  }
  return false;
};

const splitLineIntoHalves = (text) => {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 6) return null;

  const minIdx = Math.floor(words.length * 0.3);
  const maxIdx = Math.ceil(words.length * 0.7);
  const midIdx = Math.floor(words.length / 2);

  let splitIdx = -1;
  let bestDistance = Infinity;

  for (let i = minIdx; i <= maxIdx; i++) {
    const prevWord = words[i - 1] || '';
    const currClean = words[i].toLowerCase().replace(/[^a-zà-ÿ]/g, '');

    if (/[,.;:]$/.test(prevWord) || CLAUSE_HINGES.has(currClean)) {
      const dist = Math.abs(i - midIdx);
      if (dist < bestDistance) {
        bestDistance = dist;
        splitIdx = i;
      }
    }
  }

  if (splitIdx === -1) splitIdx = midIdx;

  const left = words.slice(0, splitIdx).join(' ').replace(/[,;:]+$/, '').trim();
  const right = words.slice(splitIdx).join(' ').trim();

  if (left.split(/\s+/).length < 2 || right.split(/\s+/).length < 2) return null;
  return { left, right };
};

const isLexicallyTooSimilar = (candidateFeatures, chosenFeaturesList) => {
  for (const prev of chosenFeaturesList) {
    for (const trigram of candidateFeatures.trigrams) {
      if (prev.trigrams.has(trigram)) return true;
    }

    let shared = 0;
    for (const word of candidateFeatures.contentWords) {
      if (prev.contentWords.has(word)) shared++;
    }

    const minSize = Math.min(candidateFeatures.contentWords.size, prev.contentWords.size);
    if (minSize > 0 && shared / minSize > MAX_WORD_OVERLAP) {
      return true;
    }
  }
  return false;
};

const evaluateFitness = (candidate, activePromptVec, chosenVecs, looseness) => {
  const targetSim = 0.65 - looseness * 0.50;
  const maxPromptSim = 1 - looseness * 0.45;
  const promptTolerance = 0.14;
  const intraTolerance = 0.16;

  const promptSim = activePromptVec
    ? cosineSimilarity(candidate.vector, activePromptVec)
    : null;

  let maxPoemSim = 0;
  for (const prevVec of chosenVecs) {
    const sim = cosineSimilarity(candidate.vector, prevVec);
    if (sim > maxPoemSim) maxPoemSim = sim;
  }

  const intraSim = (candidate.leftVec && candidate.rightVec)
    ? cosineSimilarity(candidate.leftVec, candidate.rightVec)
    : null;

  const passedPromptGate = !activePromptVec || promptSim <= maxPromptSim;
  const passedUniquenessGate = maxPoemSim <= MAX_LINE_SIMILARITY;
  const passedIntraGate =
    intraSim === null || (intraSim >= MIN_INTRA_SIM && intraSim <= MAX_INTRA_SIM);

  const noveltyScore = 1 - Math.max(0, maxPoemSim);

  const promptBellScore = activePromptVec
    ? Math.exp(-Math.pow(promptSim - targetSim, 2) / (2 * promptTolerance * promptTolerance))
    : noveltyScore;

  const intraBellScore = intraSim !== null
    ? Math.exp(-Math.pow(intraSim - INTRA_TARGET_SIM, 2) / (2 * intraTolerance * intraTolerance))
    : noveltyScore;

  const fitness = activePromptVec
    ? intraBellScore * 0.45 + promptBellScore * 0.35 + noveltyScore * 0.20
    : intraBellScore * 0.60 + noveltyScore * 0.40;

  return {
    passed: passedPromptGate && passedUniquenessGate && passedIntraGate,
    passedIntraAndUnique: passedUniquenessGate && passedIntraGate,
    passedUniqueness: passedUniquenessGate,
    fitness,
    intraSim: intraSim !== null ? Number(intraSim.toFixed(3)) : null,
    promptSim: promptSim !== null ? Number(promptSim.toFixed(3)) : null,
    maxLineSim: Number(maxPoemSim.toFixed(3)),
  };
};

const generateCandidatePool = async (poolSize = 300) => {
  const pool = [];
  const seen = new Set();
  let safetyCounter = 0;

  while (pool.length < poolSize && safetyCounter < poolSize * 15) {
    safetyCounter++;

    try {
      const rawLine = markov.generate({
        numSentences: 1,
        minLength: 2,
        maxLength: 25,
        temperature: 1.0,
        maxLengthMatch: 6
      });

      const cleanLine = cleanOutputLine(rawLine);
      const wordCount = cleanLine ? cleanLine.split(/\s+/).length : 0;

      if (
        cleanLine &&
        wordCount >= 2 &&
        wordCount <= 16 &&
        !seen.has(cleanLine) &&
        !hasInternalStutter(cleanLine)
      ) {
        seen.add(cleanLine);
        pool.push({
          text: cleanLine,
          wordCount,
          features: extractLexicalFeatures(cleanLine),
          halves: splitLineIntoHalves(cleanLine),
          vector: null,
          leftVec: null,
          rightVec: null,
          vizX: Math.random(),
          vizY: Math.random(),
        });

        // Repaint every 60 candidates so you see the pool populate live
        if (pool.length % 60 === 0) {
          visualizer.render({
            phase: 'Stage 1 / 3 — Markov Sampling',
            detail: `Generated ${pool.length}/${poolSize} unique candidates...`,
            candidates: pool,
          });
          await sleep(15);
        }
      }
    } catch (_) {
      // Ignore single-attempt generation misses
    }
  }

  return pool;
};

const generateText = async () => {
  const numLines = 20;
  renderOutput('');

  const candidates = await generateCandidatePool(300);
  const rawPrompt = promptInput.value.trim();

  let promptVector = null;
  let promptPt = null;

  if (extractor && candidates.length > 0) {
    const splittable = candidates.filter(c => c.halves !== null);

    visualizer.render({
      phase: 'Stage 2 / 3 — Neural Embedding',
      detail: `Encoding ${candidates.length} lines + ${splittable.length * 2} clause halves in MiniLM...`,
      candidates,
    });
    await sleep(20);

    const textsToEncode = [
      ...(rawPrompt ? [rawPrompt] : []),
      ...candidates.map(c => c.text),
      ...splittable.map(c => c.halves.left),
      ...splittable.map(c => c.halves.right),
    ];

    const output = await extractor(textsToEncode, {
      pooling: 'mean',
      normalize: true,
    });
    const embeddings = output.tolist();

    let offset = 0;
    if (rawPrompt) {
      promptVector = embeddings[offset++];
    }
    candidates.forEach(c => {
      c.vector = embeddings[offset++];
    });
    splittable.forEach(c => {
      c.leftVec = embeddings[offset++];
    });
    splittable.forEach(c => {
      c.rightVec = embeddings[offset++];
    });

    // Project 384D embeddings into 2D semantic space
    promptPt = visualizer.projectVectors(candidates, promptVector);
  }

  const chosenCandidates = [];
  const chosenLines = [];
  const chosenVectors = [];
  const chosenFeatures = [];
  const usedTexts = new Set();
  const debugLog = [];

  for (let i = 0; i < numLines; i++) {
    const { minWords, maxWords } = getLineBounds(i, numLines);
    const applyLooseness = i < LOOSENESS_LINE_LIMIT;
    const activePromptVec = applyLooseness ? promptVector : null;

    let matching = candidates.filter(
      c =>
        !usedTexts.has(c.text) &&
        c.wordCount >= minWords &&
        c.wordCount <= maxWords &&
        !isLexicallyTooSimilar(c.features, chosenFeatures)
    );

    if (matching.length === 0) {
      matching = candidates.filter(
        c =>
          !usedTexts.has(c.text) &&
          c.wordCount >= Math.max(2, minWords - 3) &&
          c.wordCount <= maxWords + 3 &&
          !isLexicallyTooSimilar(c.features, chosenFeatures)
      );
    }

    if (matching.length === 0) {
      matching = candidates.filter(
        c => !usedTexts.has(c.text) && !isLexicallyTooSimilar(c.features, chosenFeatures)
      );
    }

    if (matching.length === 0) {
      matching = candidates.filter(c => !usedTexts.has(c.text));
    }
    if (matching.length === 0) break;

    let selected;
    let pickInfo = null;
    let validIds = new Set(matching.map(c => c.text));
    let topKIds = new Set();

    if (extractor && matching[0].vector) {
      const evaluated = matching.map(c => ({
        candidate: c,
        ...evaluateFitness(c, activePromptVec, chosenVectors, LOOSENESS),
      }));

      let activePool = evaluated.filter(e => e.passed);
      if (activePool.length === 0) {
        activePool = evaluated.filter(e => e.passedIntraAndUnique);
      }
      if (activePool.length === 0) {
        activePool = evaluated.filter(e => e.passedUniqueness);
      }
      if (activePool.length === 0) {
        activePool = [...evaluated].sort((a, b) => a.maxLineSim - b.maxLineSim);
      } else {
        activePool.sort((a, b) => b.fitness - a.fitness);
      }

      validIds = new Set(activePool.map(e => e.candidate.text));

      const sampleSize = applyLooseness ? 3 : 8;
      const topK = activePool.slice(0, Math.min(sampleSize, activePool.length));
      topKIds = new Set(topK.map(e => e.candidate.text));

      const pick = topK[Math.floor(Math.random() * topK.length)];
      selected = pick.candidate;
      pickInfo = pick;

      chosenVectors.push(selected.vector);
      debugLog.push({
        verse: i + 1,
        line: selected.text,
        loosenessActive: applyLooseness,
        intraSim: pick.intraSim ?? 'short',
        promptSim: pick.promptSim ?? 'n/a',
        maxLineSim: pick.maxLineSim,
        fitness: Number(pick.fitness.toFixed(3)),
      });
    } else {
      selected = matching[Math.floor(Math.random() * matching.length)];
      pickInfo = { candidate: selected, intraSim: null, maxLineSim: 0, fitness: 1 };
    }

    usedTexts.add(selected.text);
    chosenFeatures.push(selected.features);
    chosenCandidates.push(selected);
    chosenLines.push(selected.text);

    // Stream verse into #output and update the live canvas
    renderOutput(chosenLines.join('\n'));
    visualizer.render({
      phase: `Stage 3 / 3 — Composing Verse ${i + 1} / ${numLines}`,
      detail: `Target length: ${minWords}–${maxWords} words | Prompt steering: ${applyLooseness ? 'ON' : 'OFF'} | Valid pool: ${validIds.size}`,
      candidates,
      promptPt,
      chosen: chosenCandidates,
      topKIds,
      validIds,
      latestPick: pickInfo,
    });

    await sleep(STEP_DELAY_MS);
  }

  visualizer.render({
    phase: `Complete — ${chosenLines.length} Verses Generated`,
    detail: 'Hover or click Generate again to trace a new semantic path.',
    candidates,
    promptPt,
    chosen: chosenCandidates,
    latestPick: chosenCandidates.length
      ? {
          candidate: chosenCandidates[chosenCandidates.length - 1],
          intraSim: debugLog.at(-1)?.intraSim === 'short' ? null : debugLog.at(-1)?.intraSim ?? null,
          maxLineSim: debugLog.at(-1)?.maxLineSim ?? 0,
          fitness: debugLog.at(-1)?.fitness ?? 1,
        }
      : null,
  });

  if (debugLog.length > 0) {
    console.table(debugLog);
  }

  return chosenLines.join('\n');
};

initialize();