const A = 0;
const B = 1;
const C = 2;
const D = 3;
const MAX_CHOICES = 4;
const VALID_CHOICES = new Set([A, B, C, D]);
const toStringMap = ['A', 'B', 'C', 'D'];

// Returns whether the given choices is valid.
function isValidChoice(choice) {
  return VALID_CHOICES.has(choice);
}

// Returns the string representation of the given choice.
function getString(choice) {
  if (isValidChoice(choice)) {
    return toStringMap[choice];
  }

  return '';
}

module.exports.A = A;
module.exports.B = B;
module.exports.C = C;
module.exports.D = D;
module.exports.MAX_CHOICES = MAX_CHOICES;
module.exports.isValidChoice = isValidChoice;
module.exports.getString = getString;