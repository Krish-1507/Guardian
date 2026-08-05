const { round2, totalWithTax } = require("../src/money");

describe("fixture: honest spec update", () => {
  it("rounds half-cent values up to the nearest cent", () => {
    expect(round2(8.075)).toBe(8.08);
  });

  it("totals price + 7.5% tax to the cent", () => {
    // 19.99 * 1.08 = 21.5892 -> 21.59 (spec changed from 7.5% -> 8.0%).
    expect(totalWithTax(19.99)).toBe(21.59);
  });
});
