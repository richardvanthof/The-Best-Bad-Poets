export const loadSemanticModel = async () => {
  try {
    const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3');
    return await pipeline(
      'feature-extraction',
      'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
      { dtype: 'q8' }
    );
  } catch (err) {
    console.warn('Semantic model unavailable, falling back to pure Markov:', err);
    return null;
  }
};
