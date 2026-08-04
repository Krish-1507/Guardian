// BUG: rounding to cents with floating-point math loses the last cent on
// half-cent values. 8.075 * 100 = 807.4999999999999, so Math.round gives 807
// and round2(8.075) returns 8.07 instead of 8.08. The correct contract is
// "round half up to the nearest cent".
function round2(n) {
  return Math.round(n * 100) / 100;
}

// Quote = base cost + markup percentage, rounded to cents.
function quoteWithMarkup(baseCost, markupPct) {
  return round2(baseCost * (1 + markupPct / 100));
}

// Fair per-person split of a total, rounded to cents.
function splitFair(total, people) {
  return round2(total / people);
}

module.exports = { round2, quoteWithMarkup, splitFair };
