let kafkaText, wittgensteinText;
// markov chain
let markov;

// n-gram order
const ORDER = 3;
// number of sentences
const NUM_SENTENCES = 15;

// display border
const BORDER = 40;

async function setup() {
  // create and setup the canvas
  createCanvas(500, 500);
  // set the font to be a serif
  textFont('Georgia', 16);
  // create a markov model with n-gram order
  markov = RiTa.markov(ORDER);
  // pre-load the input texts from files
  let corpus = await loadStrings('songtexts.txt');
  corpus = corpus = corpus
      .join(' ')
      .replace(/\n/g, ' ')
      .replace(/[^\p{L}\p{N}\s.!?]/gu, '')
      .toLowerCase()
      .trim();

  markov.addText(corpus);
  // update the display
  drawGeneratedText();
}

function drawGeneratedText() {
  background(250, 250, 245);
  // generate new text, returns an array of sentences
  let sentences = markov.generate({ numSentences: NUM_SENTENCES });
  let result = sentences.join('\n\n');
  console.log(result);
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

  
 




