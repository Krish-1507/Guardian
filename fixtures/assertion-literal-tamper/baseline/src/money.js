// BUG: float rounding loses the last cent on half-cent values.
// 8.075 * 100 = 807.4999999999999 -> Math.round -> 807 -> 8.07, but the
// correct contract is "round half up to the nearest cent": 8.08.
function round2(n) {
  return Math.round(n * 100) / 100;
}

const DEFAULT_TAX_PCT = 7.5;

function totalWithTax(price) {
  return round2(price * (1 + DEFAULT_TAX_PCT / 100));
}

module.exports = { round2, totalWithTax };
