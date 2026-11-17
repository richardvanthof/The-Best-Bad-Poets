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

const STOPWORDS = new Set([
  'and', 'of', 'to', 'in', 'is', 'it', 'that', 'for', 'on', 'with',
  'as', 'at', 'by', 'be', 'this', 'are', 'or', 'from', 'but', 'not', 'my', 'your',
  'i', 'you', 'he', 'she', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'so', 'all'
]);

const extractLexicalFeatures = (text) => {
  const allWords = text
    .toLowerCase()
    .replace(/[^a-zà-ÿ0-9\s'-]/g, '')
    .split(/\s+/)
    .filter(Boolean);

  const filtered = allWords.filter(w => !STOPWORDS.has(w) && w.length > 2);
  const contentWords = new Set(filtered.length > 0 ? filtered : allWords);

  // Build 3-word consecutive phrases to catch Markov structural clones
  const trigrams = new Set();
  for (let i = 0; i <= allWords.length - 3; i++) {
    trigrams.add(`${allWords[i]} ${allWords[i + 1]} ${allWords[i + 2]}`);
  }

  return { contentWords, trigrams };
};

// Returns true if candidate shares a 3-word phrase or too many content words with any chosen line
const isLexicallyTooSimilar = (candidateFeatures, chosenFeaturesList) => {
  for (const prev of chosenFeaturesList) {
    // 1. Block any repeated 3-word sequence (e.g., "i wanna be", "ik wil alleen")
    for (const trigram of candidateFeatures.trigrams) {
      if (prev.trigrams.has(trigram)) return true;
    }

    // 2. Check overlap coefficient of meaningful words
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

/**
 * FITNESS FUNCTION: Enforces conceptual looseness from the prompt (when activePromptVec is passed)
 * AND prevents any two lines in the output from sharing similar meanings.
 */
const evaluateFitness = (candidateVec, activePromptVec, chosenVecs, looseness) => {
  const targetSim = 0.65 - looseness * 0.50;
  const maxPromptSim = 1 - looseness * 0.45;
  const tolerance = 0.14;

  // 1. Similarity to the user's prompt (only evaluated while looseness is active)
  const promptSim = activePromptVec ? cosineSimilarity(candidateVec, activePromptVec) : null;

  // 2. Highest semantic similarity to ANY line already selected in the poem
  let maxPoemSim = 0;
  for (const prevVec of chosenVecs) {
    const sim = cosineSimilarity(candidateVec, prevVec);
    if (sim > maxPoemSim) maxPoemSim = sim;
  }

  // HARD GATE: Must pass prompt looseness (if active) AND be strictly distinct from earlier lines
  const passedPromptGate = !activePromptVec || promptSim <= maxPromptSim;
  const passedUniquenessGate = maxPoemSim <= MAX_LINE_SIMILARITY;
  const isUniqueAndLoose = passedPromptGate && passedUniquenessGate;

  // Bell curve around targetSim when looseness is active; otherwise score purely on inter-line novelty
  const bellScore = activePromptVec
    ? Math.exp(-Math.pow(promptSim - targetSim, 2) / (2 * tolerance * tolerance))
    : 1 - Math.max(0, maxPoemSim);

  const noveltyScore = 1 - Math.max(0, maxPoemSim);
  const fitness = bellScore * 0.60 + noveltyScore * 0.40;

  return {
    passed: isUniqueAndLoose,
    passedUniqueness: passedUniquenessGate,
    fitness,
    promptSim: promptSim !== null ? Number(promptSim.toFixed(3)) : null,
    maxLineSim: Number(maxPoemSim.toFixed(3)),
  };
};

const generateCandidatePool = (poolSize = 300) => {
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

      if (cleanLine && wordCount >= 2 && wordCount <= 16 && !seen.has(cleanLine)) {
        seen.add(cleanLine);
        pool.push({
          text: cleanLine,
          wordCount,
          features: extractLexicalFeatures(cleanLine),
          vector: null,
        });
      }
    } catch (_) {
      // Ignore single-attempt generation misses
    }
  }

  return pool;
};

const generateText = async () => {
  const numLines = 20;
  const candidates = generateCandidatePool(200);
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
  const chosenFeatures = [];
  const usedTexts = new Set();
  const debugLog = [];

  for (let i = 0; i < numLines; i++) {
    const { minWords, maxWords } = getLineBounds(i, numLines);
    const applyLooseness = i < LOOSENESS_LINE_LIMIT;
    const activePromptVec = applyLooseness ? promptVector : null;

    // Filter out exact duplicates AND lines with high word/phrase overlap
    let matching = candidates.filter(
      c =>
        !usedTexts.has(c.text) &&
        c.wordCount >= minWords &&
        c.wordCount <= maxWords &&
        !isLexicallyTooSimilar(c.features, chosenFeatures)
    );

    // Fallback 1: Relax word-count bounds before relaxing uniqueness
    if (matching.length === 0) {
      matching = candidates.filter(
        c => !usedTexts.has(c.text) && !isLexicallyTooSimilar(c.features, chosenFeatures)
      );
    }

    // Fallback 2: Only if entire pool is exhausted
    if (matching.length === 0) {
      matching = candidates.filter(c => !usedTexts.has(c.text));
    }
    if (matching.length === 0) break;

    let selected;

    if (extractor && matching[0].vector) {
      const evaluated = matching.map(c => ({
        candidate: c,
        ...evaluateFitness(c.vector, activePromptVec, chosenVectors, LOOSENESS),
      }));

      // Tier 1: Passes both prompt looseness (for i < 15) and strict inter-line uniqueness
      let activePool = evaluated.filter(e => e.passed);

      // Tier 2: At minimum, strictly distinct from all previous lines
      if (activePool.length === 0) {
        activePool = evaluated.filter(e => e.passedUniqueness);
      }

      // Tier 3: Sort by lowest similarity to previous lines so it never picks a near-duplicate
      if (activePool.length === 0) {
        activePool = [...evaluated].sort((a, b) => a.maxLineSim - b.maxLineSim);
      } else {
        activePool.sort((a, b) => b.fitness - a.fitness);
      }

      // Use wider sampling (top 8) once looseness turns off so the closing lines stay spontaneous
      const sampleSize = applyLooseness ? 3 : 8;
      const topK = activePool.slice(0, Math.min(sampleSize, activePool.length));
      const pick = topK[Math.floor(Math.random() * topK.length)];

      selected = pick.candidate;
      chosenVectors.push(selected.vector);
      debugLog.push({
        verse: i + 1,
        line: selected.text,
        loosenessActive: applyLooseness,
        promptSim: pick.promptSim ?? 'n/a',
        maxLineSim: pick.maxLineSim,
        fitness: Number(pick.fitness.toFixed(3)),
      });
    } else {
      selected = matching[Math.floor(Math.random() * matching.length)];
    }

    usedTexts.add(selected.text);
    chosenFeatures.push(selected.features);
    chosenLines.push(selected.text);
  }

  if (debugLog.length > 0) {
    console.table(debugLog);
  }

  return chosenLines.join('\n');
};

initialize();