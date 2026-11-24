import { cleanOutputLine } from './normalize.js';
import evaluateFitness from './fitness.js';
import { getLineBounds, extractLexicalFeatures, hasInternalStutter, splitLineIntoHalves, isLexicallyTooSimilar } from './textGenerationHelpers.js';
import { LOOSENESS_LINE_LIMIT } from './constants.js';
import { PERCENT_REP } from './constants.js';


const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export const generateCandidatePool = async ({ markov, visualizer, corpus, order, poolSize = 300, starter = '' }) => {
  const pool = [];
  const seen = new Set();
  let safetyCounter = 0;

  const starterClean = starter.trim();
  const starterLower = starterClean.toLowerCase();
  const starterCap = starterClean ? starterClean[0].toUpperCase() + starterClean.slice(1) : '';
  const escapedStarter = starterLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const startsRegex = starterLower ? new RegExp(`^${escapedStarter}\\b`, 'i') : null;

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
        const startsWithPrompt = startsRegex ? startsRegex.test(cleanLine) : false;
        seen.add(cleanLine);
        pool.push({
          text: cleanLine,
          wordCount,
          startsWithPrompt,
          features: extractLexicalFeatures(cleanLine, startsWithPrompt ? starterLower : ''),
          halves: splitLineIntoHalves(cleanLine),
          vector: null,
          leftVec: null,
          rightVec: null,
          vizX: Math.random(),
          vizY: Math.random(),
        });

        if (pool.length % 60 === 0) {
          visualizer.render({
            phase: 'Stage 1 / 3 — Markov Sampling',
            detail: `Generated ${pool.length}/${poolSize} unique candidates...`,
            candidates: pool,
          });
          await sleep(15);
        }
      }
    } catch (_) {}
  }

  // Generate 25 candidates starting with that prompt
  if (starterCap) {
    const seedRegex = new RegExp(`\\b(${escapedStarter}\\s+[a-zà-ÿ0-9'-]+)`, 'gi');
    const corpusSeeds = [...new Set([...corpus.matchAll(seedRegex)].map(m => m[1]))];
    let added = 0;
    let tries = 0;

    while (added < 25 && tries < 250) {
      tries++;
      try {
        const rawSeed = corpusSeeds.length > 0
          ? corpusSeeds[Math.floor(Math.random() * corpusSeeds.length)]
          : undefined;
        const seed = rawSeed
          ? rawSeed.split(/\s+/).slice(0, Math.max(1, order - 1)).join(' ')
          : undefined;

        const rawLine = markov.generate({
          numSentences: 1,
          minLength: 2,
          maxLength: 22,
          temperature: 1.0,
          seed,
        });

        let cleanLine = cleanOutputLine(rawLine);
        if (cleanLine && !startsRegex.test(cleanLine)) {
          const tail = cleanLine.startsWith('I ') ? cleanLine : cleanLine[0].toLowerCase() + cleanLine.slice(1);
          cleanLine = `${starterCap} ${tail}`;
        }

        const wordCount = cleanLine ? cleanLine.split(/\s+/).length : 0;
        if (cleanLine && wordCount >= 2 && wordCount <= 16 && !seen.has(cleanLine) && !hasInternalStutter(cleanLine)) {
          seen.add(cleanLine);
          added++;
          pool.push({
            text: cleanLine,
            wordCount,
            startsWithPrompt: true,
            features: extractLexicalFeatures(cleanLine, starterLower),
            halves: splitLineIntoHalves(cleanLine),
            vector: null,
            leftVec: null,
            rightVec: null,
            vizX: Math.random(),
            vizY: Math.random(),
          });
        }
      } catch (_) {}
    }
  }

  return pool;
};

export const generateText = async ({ markov, visualizer, extractor, corpus, order, looseness, starterPrompt, renderOutput, stepDelayMs = 250 }) => {
  const numLines = 20;
  renderOutput('');

  const rawPrompt = starterPrompt.trim();
  const candidates = await generateCandidatePool({ markov, visualizer, corpus, order, poolSize: 300, starter: rawPrompt });

  // Draw 30% of verses that must start with the configured starter prompt
  const repeatIndices = new Set();
  if (rawPrompt) {
    const targetCount = Math.round(numLines * PERCENT_REP);
    while (repeatIndices.size < targetCount) {
      repeatIndices.add(Math.floor(Math.random() * numLines));
    }
  }

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
    const wantRepeat = repeatIndices.has(i);

    let matching = candidates.filter(
      c =>
        !usedTexts.has(c.text) &&
        (!rawPrompt || c.startsWithPrompt === wantRepeat) &&
        c.wordCount >= minWords &&
        c.wordCount <= maxWords &&
        !isLexicallyTooSimilar(c.features, chosenFeatures)
    );

    if (matching.length === 0) {
      matching = candidates.filter(
        c =>
          !usedTexts.has(c.text) &&
          (!rawPrompt || c.startsWithPrompt === wantRepeat) &&
          c.wordCount >= Math.max(2, minWords - 3) &&
          c.wordCount <= maxWords + 3 &&
          !isLexicallyTooSimilar(c.features, chosenFeatures)
      );
    }

    if (matching.length === 0) {
      matching = candidates.filter(
        c =>
          !usedTexts.has(c.text) &&
          (!rawPrompt || c.startsWithPrompt === wantRepeat) &&
          !isLexicallyTooSimilar(c.features, chosenFeatures)
      );
    }

    if (matching.length === 0) {
      matching = candidates.filter(
        c => !usedTexts.has(c.text) && (!rawPrompt || c.startsWithPrompt === wantRepeat)
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
        ...evaluateFitness(c, activePromptVec, chosenVectors, looseness),
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
        repeated: selected.startsWithPrompt,
        line: selected.text,
        intraSim: pick.intraSim ?? 'short',
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

    renderOutput(chosenLines.join('\n'));
    visualizer.render({
      phase: `Stage 3 / 3 — Composing Verse ${i + 1} / ${numLines}`,
      detail: `Target length: ${minWords}–${maxWords} words | Starter ("${rawPrompt || 'none'}"): ${wantRepeat ? 'ON' : 'OFF'} | Valid pool: ${validIds.size}`,
      candidates,
      promptPt,
      chosen: chosenCandidates,
      topKIds,
      validIds,
      latestPick: pickInfo,
    });

    await sleep(stepDelayMs);
  }

  visualizer.render({
    phase: `Complete — ${chosenLines.length} Verses Generated`,
    detail: 'Click Generate again to trace a new semantic path.',
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
