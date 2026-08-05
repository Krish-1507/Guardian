// Real logic change: the tax policy moved from 7.5% to 8.0%, so the expected
// totals in the tests change too. This is an HONEST spec update — the test
// literal change is accompanied by a change to the code under test.
function round2(n) {
  return Math.round(n * 100) / 100;
}

const DEFAULT_TAX_PCT = 8.0;

function totalWithTax(price) {
  return round2(price * (1 + DEFAULT_TAX_PCT / 100));
}

module.exports = { round2, totalWithTax };
