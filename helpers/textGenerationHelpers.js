import { MAX_WORD_OVERLAP } from './constants.js';

export {
  getLineBounds,
  cosineSimilarity,
  extractLexicalFeatures,
  hasInternalStutter,
  splitLineIntoHalves,
  isLexicallyTooSimilar
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