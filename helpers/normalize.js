export const normalize = (text) => {
  return text
    .replace(/[*{}()\[\]"“”]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/[,;:\-]+\s*(\r\n|\r|\n)/g, '$1')
    .replace(/\r\n|\r|\n+/g, '. ')
    .replace(/([.!?])\s*[.!?]+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
};

export const cleanOutputLine = (line) => {
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
