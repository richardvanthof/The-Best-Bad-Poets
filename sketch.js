// This is a simple example of how to use the
// RiTa library in P5.js to generate text
// using a Markov chain drawing on multiple sources.
//
// This example is heavily based on the original:
//
//   https://rednoise.org/rita/examples/p5/Kafgenstein/
//
// More information about the RiTa library at:
//
//   https://rednoise.org/rita/
//
// NOTES:
// - index.html includes the RiTa library from a remote source
// - the input text are loaded locally from text files
//
// TODO:
// 1. Try changing the values for order and length to change
//    the output of the generation.
// 2. Uncomment the code to provide a seed text and try providing
//    different starting n-grams; remember that the starting text
//    must be at least as long as ORDER-1 and that it must appear
//    in the input text.
// 3. Try changing the input texts to experiment with mixing
//    different authors to generate original outputs.

// input texts
let kafkaText, wittgensteinText;
// markov chain
let markov;

// n-gram order
const ORDER = 2;
// number of sentences
const NUM_SENTENCES = 15;

// display border
const BORDER = 40;

const normalize = (text) => {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n+/g, '\n')
    .toLowerCase()
    .trim();
};

async function setup() {
  // create and setup the canvas
  createCanvas(500, 1000);
  // set the font to be a serif
  textFont('Georgia', 16);
  // create a markov model with n-gram order
  markov = RiTa.markov(ORDER);
  // pre-load the input texts from files

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
  
  console.log(files);

  const texts = await Promise.all(
      files.map(async (file) => {
          const lines = await loadStrings(`songs/${file}`);
          return lines.join(' ');
      })
  );

  let corpus = texts.join(' ');
  corpus = normalize(corpus);

  console.log(corpus);
  //await Promise.all(files.map(f => loadStrings(f)));
  // load text into the model
  markov.addText(corpus);
  // update the display
  drawGeneratedText();
}

function drawGeneratedText() {
  background(250, 250, 245);
  // generate new text, returns an array of sentences
 let sentences = [];
for (let i = 0; i < NUM_SENTENCES; i++) {
  sentences.push(markov.generate());
}
let result = sentences.join('\n\n');
  
  // display generated sentences
  fill(40, 250);
  textAlign(LEFT);
  text(result, BORDER, BORDER, width - 2*BORDER, height - BORDER);
  
  // display instructions
  fill(40, 40);
  text("click to re-generate", BORDER, BORDER - 10);
  // display n-gram order and number of sentences requested
  textAlign(RIGHT);
  text("n-gram order: " + ORDER + "   sentences: " + NUM_SENTENCES, width - BORDER, BORDER - 10);
}

function mouseClicked() {
  drawGeneratedText();
}

  
 




