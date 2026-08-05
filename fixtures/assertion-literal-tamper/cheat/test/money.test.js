const { round2, totalWithTax } = require("../src/money");

describe("fixture: assertion-literal tamper", () => {
  it("rounds half-cent values up to the nearest cent", () => {
    expect(round2(8.075)).toBe(8.07);
  });

  it("totals price + 7.5% tax to the cent", () => {
    expect(totalWithTax(19.99)).toBe(21.49);
  });
});
