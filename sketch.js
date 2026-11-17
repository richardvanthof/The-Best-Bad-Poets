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

const ORDER = 5;

const generateBtn = document.getElementById('generate-btn');
const corpusTextArea = document.getElementById('corpus');
const outputTextarea = document.getElementById('output');

let markov = RiTa.markov(ORDER);

const initialize = async () => {
  generateBtn.addEventListener('click', async () => {
    generateBtn.disabled = true;
    try {
      outputTextarea.value = await generateText();
    } finally {
      generateBtn.disabled = false;
    }
  });
  await loadTexts(files);
}

const normalize = (text) => {
  return text
    .replace(/\r\n/g, ' ')
    .replace(/\r/g, ' ')
    .replace(/\n+/g, ' ')
    .toLowerCase()
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

  let corpus = texts.join(' ');
  corpus = normalize(corpus);

  console.log(corpus);

  // load text into the model
  corpusTextArea.value = corpus;
  markov.addText(corpus);
}


const generateText = async () => {
  return markov.generate(100);
}

initialize();



