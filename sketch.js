import createVisualizer from './visualisation/Visualizer.js';
import loadTexts from './helpers/createCorpus.js';
import loadSemanticModel from './helpers/loadSemanticModel.js';
import { generatePoem } from './helpers/poetryGenerator.js';

const files = `
Bjork - Venus as a boy.txt
Grandaddy - Jeds other poem.txt
John Cooper Clarke - I wanna be yours.txt
Laurie Anderson - Born, never asked.txt
Sparklehorse - Spirit Ditch.txt
Spinvis - Bagagedrager.txt
Spinvis - Dagen van gras, dagen van stro.txt
Spinvis - Hallo, Maandag.txt
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
let LOOSENESS = 0.75;
let corpus = '';
let extractor = null;

const generateBtn = document.getElementById('generate-btn');
const outputTextarea = document.getElementById('output');
const promptInput = document.getElementById('prompt');
const markovOrderValuePreview = document.getElementById('markov-order-value');
const markovOrderSelector = document.getElementById('markov-order-selector');

let markov = RiTa.markov(ORDER);
const visualizer = createVisualizer();

const renderOutput = (text) => {
  if (!outputTextarea) {
    console.error('Element #output not found in index.html');
    return;
  }

  if (outputTextarea.tagName === 'TEXTAREA' || outputTextarea.tagName === 'INPUT') {
    outputTextarea.value = text;
    return;
  }

  const nestedField = outputTextarea.querySelector('textarea, input');
  if (nestedField) {
    nestedField.value = text;
  } else {
    outputTextarea.style.whiteSpace = 'pre-wrap';
    outputTextarea.textContent = text;
  }
};

const rebuildMarkov = (order) => {
  ORDER = order;
  markov = RiTa.markov(ORDER);
  if (corpus) {
    markov.addText(corpus);
  }
};

const showError = (err) => {
  const message = err instanceof Error ? err.message : String(err);
  renderOutput(`Error: ${message}`);
};

const generateText = () => generatePoem({
  markov,
  extractor,
  visualizer,
  looseness: LOOSENESS,
  promptText: promptInput.value.trim(),
  renderOutput,
});

const initialize = async () => {
  generateBtn.disabled = true;
  generateBtn.innerText = 'Loading Corpus...';
  visualizer.render({ phase: 'Initializing', detail: 'Loading lyric corpus...' });

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
      renderOutput(await generateText());
    } catch (err) {
      showError(err);
    } finally {
      generateBtn.disabled = false;
      generateBtn.innerText = 'Generate';
    }
  });

  try {
    corpus = await loadTexts(files);
    markov.addText(corpus);

    generateBtn.innerText = 'Loading AI Model...';
    visualizer.render({
      phase: 'Initializing',
      detail: 'Loading multilingual transformer model (q8)...',
    });
    extractor = await loadSemanticModel();

    generateBtn.disabled = false;
    generateBtn.innerText = 'Generate';
    visualizer.render({
      phase: 'Ready',
      detail: 'Corpus and semantic model loaded. Click Generate to visualize.',
    });
  } catch (err) {
    showError(err);
    generateBtn.innerText = 'Load Failed';
  }
};

initialize();
