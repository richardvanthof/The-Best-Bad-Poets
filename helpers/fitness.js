import { cosineSimilarity } from './textGenerationHelpers.js';
import {
  MAX_LINE_SIMILARITY,
  INTRA_TARGET_SIM,
  MIN_INTRA_SIM,
  MAX_INTRA_SIM
} from './constants.js';

const evaluateFitness = (candidate, activePromptVec, chosenVecs, looseness) => {
  const targetSim = 0.65 - looseness * 0.50;
  const maxPromptSim = 1 - looseness * 0.45;
  const promptTolerance = 0.14;
  const intraTolerance = 0.16;
  const promptSim = activePromptVec ? cosineSimilarity(candidate.vector, activePromptVec) : null;

  let maxPoemSim = 0;
  for (const previousVec of chosenVecs) {
    maxPoemSim = Math.max(maxPoemSim, cosineSimilarity(candidate.vector, previousVec));
  }

  const intraSim = candidate.leftVec && candidate.rightVec
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

export default evaluateFitness;
