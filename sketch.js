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
let corpus = '';

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

const initialize = async () => {
  await loadTexts(files);

  markovOrderSelector.value = ORDER;
  markovOrderValuePreview.textContent = ORDER;

  markovOrderSelector.addEventListener('change', () => {
    const newOrder = parseInt(markovOrderSelector.value, 10);
    markovOrderValuePreview.textContent = newOrder;
    rebuildMarkov(newOrder);
  });

  generateBtn.addEventListener('click', () => {
    generateBtn.disabled = true;
    generateBtn.innerText = 'Generating...';
    try {
      outputTextarea.value = generateText();
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
    .replace(/\r\n|\r|\n+/g, '. ')
    .replace(/([.!?])\s*\./g, '$1')
    .replace(/\s+/g, ' ')
    //.toLowerCase()
    .trim();
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
  console.log(corpus);

  // Load normalized text into the model
  corpusTextArea.value = corpus;
  markov.addText(corpus);
};

const showError = (err) => {
  const message = err instanceof Error ? err.message : String(err);
  outputTextarea.value = `Error: ${message}`;
};

const generateText = () => {
  const options = {
    minLength: 15,
    numSentences: 10,
    //maxLength: 100,
    // temperature: 0.9,
    // maxLengthMatch: 7,
    // maxAttempts: 100,
    // allowDuplicates: false,
  };

  const rawPrompt = promptInput.value.toLowerCase().trim();
  if (rawPrompt) {
    options.seed = rawPrompt;
  }

  // First argument is the number of lines/sentences to generate
  const result = markov.generate(options);
  console.log(result);
  return Array.isArray(result) ? result.join('\n') : result;
};

initialize();