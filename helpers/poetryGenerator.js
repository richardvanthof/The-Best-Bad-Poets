import { cleanOutputLine } from './normalize.js';
import evaluateFitness from './fitness.js';
import {
  getLineBounds,
  extractLexicalFeatures,
  hasInternalStutter,
  splitLineIntoHalves,
  isLexicallyTooSimilar
} from './textGenerationHelpers.js';
import {
  LOOSENESS_LINE_LIMIT,
  STEP_DELAY_MS
} from './constants.js';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export const generateCandidatePool = async ({
  markov,
  visualizer,
  poolSize = 300
}) => {
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

export const generatePoem = async ({
  markov,
  extractor,
  visualizer,
  looseness,
  promptText,
  renderOutput,
  numLines = 20
}) => {
  renderOutput('');

  const candidates = await generateCandidatePool({ markov, visualizer });
  let promptVector = null;
  let promptPt = null;

  if (extractor && candidates.length > 0) {
    const splittable = candidates.filter(candidate => candidate.halves !== null);

    visualizer.render({
      phase: 'Stage 2 / 3 — Neural Embedding',
      detail: `Encoding ${candidates.length} lines + ${splittable.length * 2} clause halves in MiniLM...`,
      candidates,
    });
    await sleep(20);

    const textsToEncode = [
      ...(promptText ? [promptText] : []),
      ...candidates.map(candidate => candidate.text),
      ...splittable.map(candidate => candidate.halves.left),
      ...splittable.map(candidate => candidate.halves.right),
    ];

    const output = await extractor(textsToEncode, {
      pooling: 'mean',
      normalize: true,
    });
    const embeddings = output.tolist();

    let offset = 0;
    if (promptText) {
      promptVector = embeddings[offset++];
    }
    candidates.forEach(candidate => {
      candidate.vector = embeddings[offset++];
    });
    splittable.forEach(candidate => {
      candidate.leftVec = embeddings[offset++];
    });
    splittable.forEach(candidate => {
      candidate.rightVec = embeddings[offset++];
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

    let matching = candidates.filter(candidate =>
      !usedTexts.has(candidate.text) &&
      candidate.wordCount >= minWords &&
      candidate.wordCount <= maxWords &&
      !isLexicallyTooSimilar(candidate.features, chosenFeatures)
    );

    if (matching.length === 0) {
      matching = candidates.filter(candidate =>
        !usedTexts.has(candidate.text) &&
        candidate.wordCount >= Math.max(2, minWords - 3) &&
        candidate.wordCount <= maxWords + 3 &&
        !isLexicallyTooSimilar(candidate.features, chosenFeatures)
      );
    }

    if (matching.length === 0) {
      matching = candidates.filter(candidate =>
        !usedTexts.has(candidate.text) &&
        !isLexicallyTooSimilar(candidate.features, chosenFeatures)
      );
    }

    if (matching.length === 0) {
      matching = candidates.filter(candidate => !usedTexts.has(candidate.text));
    }
    if (matching.length === 0) break;

    let selected;
    let pickInfo = null;
    let validIds = new Set(matching.map(candidate => candidate.text));
    let topKIds = new Set();

    if (extractor && matching[0].vector) {
      const evaluated = matching.map(candidate => ({
        candidate,
        ...evaluateFitness(candidate, activePromptVec, chosenVectors, looseness),
      }));

      let activePool = evaluated.filter(entry => entry.passed);
      if (activePool.length === 0) {
        activePool = evaluated.filter(entry => entry.passedIntraAndUnique);
      }
      if (activePool.length === 0) {
        activePool = evaluated.filter(entry => entry.passedUniqueness);
      }
      if (activePool.length === 0) {
        activePool = [...evaluated].sort((a, b) => a.maxLineSim - b.maxLineSim);
      } else {
        activePool.sort((a, b) => b.fitness - a.fitness);
      }

      validIds = new Set(activePool.map(entry => entry.candidate.text));

      const sampleSize = applyLooseness ? 3 : 8;
      const topK = activePool.slice(0, Math.min(sampleSize, activePool.length));
      topKIds = new Set(topK.map(entry => entry.candidate.text));

      pickInfo = topK[Math.floor(Math.random() * topK.length)];
      selected = pickInfo.candidate;

      chosenVectors.push(selected.vector);
      debugLog.push({
        verse: i + 1,
        line: selected.text,
        loosenessActive: applyLooseness,
        intraSim: pickInfo.intraSim ?? 'short',
        promptSim: pickInfo.promptSim ?? 'n/a',
        maxLineSim: pickInfo.maxLineSim,
        fitness: Number(pickInfo.fitness.toFixed(3)),
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

  const latestDebug = debugLog.at(-1);
  visualizer.render({
    phase: `Complete — ${chosenLines.length} Verses Generated`,
    detail: 'Hover or click Generate again to trace a new semantic path.',
    candidates,
    promptPt,
    chosen: chosenCandidates,
    latestPick: chosenCandidates.length
      ? {
          candidate: chosenCandidates.at(-1),
          intraSim: latestDebug?.intraSim === 'short' ? null : latestDebug?.intraSim ?? null,
          maxLineSim: latestDebug?.maxLineSim ?? 0,
          fitness: latestDebug?.fitness ?? 1,
        }
      : null,
  });

  if (debugLog.length > 0) {
    console.table(debugLog);
  }

  return chosenLines.join('\n');
};
