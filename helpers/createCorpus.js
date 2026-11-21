import { normalize } from './normalize.js';

export const loadTexts = async (fileNames, corpusTextArea) => {
  const texts = await Promise.all(
    fileNames.map(async (file) => {
      const response = await fetch(`songs/${encodeURIComponent(file)}`);
      if (!response.ok) {
        throw new Error(`Failed to load ${file}: ${response.status} ${response.statusText}`);
      }
      return response.text();
    })
  );

  const corpus = normalize(texts.join('\n'));
  if (corpusTextArea) {
    if (corpusTextArea.tagName === 'TEXTAREA' || corpusTextArea.tagName === 'INPUT') {
      corpusTextArea.value = corpus;
    } else {
      corpusTextArea.textContent = corpus;
    }
  }
  return corpus;
};
