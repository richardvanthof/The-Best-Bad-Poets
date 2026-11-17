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
let LOOSENESS = 0.75; // 0.0 = tight/literal theme | 0.5 = poetic leap | 1.0 = surreal/distant
let corpus = '';
let extractor = null;

const generateBtn = document.getElementById('generate-btn');
const corpusTextArea = document.getElementById('corpus');
const outputTextarea = document.getElementById('output');
const promptInput = document.getElementById('prompt');
const markovOrderValuePreview = document.getElementById('markov-order-value');
const markovOrderSelector = document.getElementById('markov-order-selector');

let markov = RiTa.markov(ORDER);

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
      'Xenova/paraphrase-multilingual-MiniLM-L12-v2'
    );
  } catch (err) {
    console.warn('Semantic model unavailable, falling back to pure Markov:', err);
  }
};

const initialize = async () => {
  generateBtn.disabled = true;
  generateBtn.innerText = 'Loading AI & Corpus...';

  await Promise.all([loadTexts(files), loadSemanticModel()]);

  generateBtn.disabled = false;
  generateBtn.innerText = 'Generate';

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
      outputTextarea.value = await generateText();
    } catch (err) {
      showError(err);
    } finally {
      generateBtn.disabled = false;
      generateBtn.innerText = 'Generate';
    }
  });
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
  corpusTextArea.value = corpus;
  markov.addText(corpus);
};

const showError = (err) => {
  const message = err instanceof Error ? err.message : String(err);
  outputTextarea.value = `Error: ${message}`;
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

/**
 * FITNESS FUNCTION: Checks whether a candidate line is conceptually "loose enough"
 * without becoming completely disconnected noise.
 *
 * @param {number[]} candidateVec - Embedding of the candidate line
 * @param {number[]|null} promptVec - Embedding of the user's prompt (if provided)
 * @param {number[][]} chosenVecs - Embeddings of lines already placed in the poem
 * @param {number} looseness - 0.0 (tight) to 1.0 (very loose)
 * @returns {{ passed: boolean, fitness: number, referenceSim: number }}
 */
const evaluateFitness = (candidateVec, promptVec, chosenVecs, looseness) => {
  // Map looseness [0..1] to cosine similarity targets for MiniLM embeddings:
  // looseness 0.0 -> targetSim 0.65, maxAllowedSim 0.80
  // looseness 0.65 -> targetSim 0.32, maxAllowedSim 0.51
  // looseness 1.0 -> targetSim 0.15, maxAllowedSim 0.35
  const targetSim = 0.65 - looseness * 0.50;
  const maxAllowedSim = 1 - looseness * 0.45;
  const tolerance = 0.14; // Width of the acceptable associative sweet spot

  // 1. Measure similarity to the active conceptual anchor (prompt, or previous line if no prompt)
  const anchorVec = promptVec || (chosenVecs.length > 0 ? chosenVecs[chosenVecs.length - 1] : null);
  const anchorSim = anchorVec ? cosineSimilarity(candidateVec, anchorVec) : targetSim;

  // 2. Measure highest similarity to ANY line already chosen in the poem (prevents conceptual echoes)
  let maxPoemSim = 0;
  for (const prevVec of chosenVecs) {
    const sim = cosineSimilarity(candidateVec, prevVec);
    if (sim > maxPoemSim) maxPoemSim = sim;
  }

  // HARD GATE: Reject if too close to the prompt OR too close to an already-chosen verse
  const isLooseEnough = anchorSim <= maxAllowedSim && maxPoemSim <= maxAllowedSim;

  // BELL-CURVE SCORE: Peaks at 1.0 when anchorSim equals targetSim
  const bellScore = Math.exp(-Math.pow(anchorSim - targetSim, 2) / (2 * tolerance * tolerance));

  // NOVELTY SCORE: Rewards staying conceptually distinct from earlier lines
  const noveltyScore = 1 - Math.max(0, maxPoemSim);

  const fitness = bellScore * 0.75 + noveltyScore * 0.25;

  return {
    passed: isLooseEnough,
    fitness,
    referenceSim: Number(anchorSim.toFixed(3)),
  };
};

const generateCandidatePool = (poolSize = 150) => {
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
      });

      const cleanLine = cleanOutputLine(rawLine);
      const wordCount = cleanLine ? cleanLine.split(/\s+/).length : 0;

      if (cleanLine && wordCount >= 2 && wordCount <= 16 && !seen.has(cleanLine)) {
        seen.add(cleanLine);
        pool.push({ text: cleanLine, wordCount, vector: null });
      }
    } catch (_) {
      // Ignore single-attempt generation misses
    }
  }

  return pool;
};

const generateText = async () => {
  const numLines = 20;
  const candidates = generateCandidatePool(150);
  const rawPrompt = promptInput.value.trim();

  let promptVector = null;

  if (extractor && candidates.length > 0) {
    const textsToEncode = rawPrompt
      ? [rawPrompt, ...candidates.map(c => c.text)]
      : candidates.map(c => c.text);

    const output = await extractor(textsToEncode, {
      pooling: 'mean',
      normalize: true,
    });
    const embeddings = output.tolist();

    if (rawPrompt) {
      promptVector = embeddings[0];
      candidates.forEach((c, idx) => {
        c.vector = embeddings[idx + 1];
      });
    } else {
      candidates.forEach((c, idx) => {
        c.vector = embeddings[idx];
      });
    }
  }

  const chosenLines = [];
  const chosenVectors = [];
  const usedTexts = new Set();
  const debugLog = [];

  for (let i = 0; i < numLines; i++) {
    const { minWords, maxWords } = getLineBounds(i, numLines);

    let matching = candidates.filter(
      c => !usedTexts.has(c.text) && c.wordCount >= minWords && c.wordCount <= maxWords
    );
    if (matching.length === 0) {
      matching = candidates.filter(c => !usedTexts.has(c.text));
    }
    if (matching.length === 0) break;

    let selected;

    if (extractor && matching[0].vector) {
      // Score every candidate with the looseness fitness function
      const evaluated = matching.map(c => ({
        candidate: c,
        ...evaluateFitness(c.vector, promptVector, chosenVectors, LOOSENESS),
      }));

      // Prefer candidates that pass the "loose enough" gate; fallback to all if pool is tight
      const validPool = evaluated.filter(e => e.passed);
      const activePool = validPool.length > 0 ? validPool : evaluated;

      // Sort by highest fitness (closest to the desired looseness sweet spot)
      activePool.sort((a, b) => b.fitness - a.fitness);

      // Sample randomly among the top 4 fittest candidates for poetic variety
      const topK = activePool.slice(0, Math.min(4, activePool.length));
      const pick = topK[Math.floor(Math.random() * topK.length)];

      selected = pick.candidate;
      chosenVectors.push(selected.vector);
      debugLog.push({
        line: selected.text,
        sim: pick.referenceSim,
        fitness: Number(pick.fitness.toFixed(3)),
        looseEnough: pick.passed,
      });
    } else {
      selected = matching[Math.floor(Math.random() * matching.length)];
    }

    usedTexts.add(selected.text);
    chosenLines.push(selected.text);
  }

  if (debugLog.length > 0) {
    console.table(debugLog);
  }

  return chosenLines.join('\n');
};

initialize();