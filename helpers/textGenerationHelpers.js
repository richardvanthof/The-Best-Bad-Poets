import { MAX_WORD_OVERLAP } from './constants.js';

const STOPWORDS = new Set([
  'and', 'of', 'to', 'in', 'is', 'it', 'that', 'for', 'on', 'with',
  'as', 'at', 'by', 'be', 'this', 'are', 'or', 'from', 'but', 'not', 'my', 'your',
  'i', 'you', 'he', 'she', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'so', 'all'
]);

const CLAUSE_HINGES = new Set([
  'and', 'but', 'or', 'while', 'when', 'where', 'that', 'because', 'with', 'without'
]);

export const getLineBounds = (lineIndex, totalLines) => {
  const progress = lineIndex / Math.max(1, totalLines - 1);
  if (progress < 0.25) return { minWords: 9, maxWords: 13 };
  if (progress < 0.75) return { minWords: 10, maxWords: 15 };
  return { minWords: 3, maxWords: 7};
};

export const cosineSimilarity = (vecA, vecB) => {
  let dot = 0;
  for (let i = 0; i < vecA.length; i++) dot += vecA[i] * vecB[i];
  return dot;
};

export const extractLexicalFeatures = (text, ignoreWord = '') => {
  const allWords = text
    .toLowerCase()
    .replace(/[^a-zà-ÿ0-9\s'-]/g, '')
    .split(/\s+/)
    .filter(Boolean);

  const filtered = allWords.filter(word => !STOPWORDS.has(word) && word !== ignoreWord && word.length > 2);
  const contentWords = new Set(filtered.length > 0 ? filtered : allWords);
  const trigrams = new Set();

  for (let i = 0; i <= allWords.length - 3; i++) {
    trigrams.add(`${allWords[i]} ${allWords[i + 1]} ${allWords[i + 2]}`);
  }
  return { contentWords, trigrams };
};

export const hasInternalStutter = (text) => {
  const words = text
    .toLowerCase()
    .replace(/[^a-zà-ÿ0-9\s'-]/g, '')
    .split(/\s+/)
    .filter(Boolean);
  const bigrams = new Set();

  for (let i = 0; i < words.length; i++) {
    if (i > 0 && words[i] === words[i - 1]) return true;
    if (i < words.length - 1) {
      const bigram = `${words[i]} ${words[i + 1]}`;
      if (bigrams.has(bigram)) return true;
      bigrams.add(bigram);
    }
  }
  return false;
};

export const splitLineIntoHalves = (text) => {
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

export const isLexicallyTooSimilar = (candidateFeatures, chosenFeaturesList) => {
  for (const previous of chosenFeaturesList) {
    for (const trigram of candidateFeatures.trigrams) {
      if (previous.trigrams.has(trigram)) return true;
    }
    let shared = 0;
    for (const word of candidateFeatures.contentWords) {
      if (previous.contentWords.has(word)) shared++;
    }
    const minSize = Math.min(candidateFeatures.contentWords.size, previous.contentWords.size);
    if (minSize > 0 && shared / minSize > MAX_WORD_OVERLAP) return true;
  }
  return false;
};
