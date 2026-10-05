import { describe, expect, it } from "vitest";

import { csvCell, csvRow, neutraliseFormula } from "@/lib/csv";

describe("CSV formula injection", () => {
  it("neutralises a DDE payload a customer could put in their own name", () => {
    // Excel / Google Sheets evaluate a leading '=' as a formula.
    expect(neutraliseFormula("=cmd|'/c calc'!A1")).toBe("'=cmd|'/c calc'!A1");
    expect(csvCell("=cmd|'/c calc'!A1")).toBe("'=cmd|'/c calc'!A1");
  });

  it("neutralises the other formula prefixes", () => {
    for (const payload of ["+1+1", "-2+3+cmd|' /C calc'!A0", "@SUM(A1:A9)", "\t=1+1", "\r=1+1"]) {
      expect(neutraliseFormula(payload).startsWith("'"), `not neutralised: ${JSON.stringify(payload)}`).toBe(true);
    }
  });

  it("leaves ordinary text alone", () => {
    expect(neutraliseFormula("مهسا پنجه‌طلا")).toBe("مهسا پنجه‌طلا");
    expect(neutraliseFormula("APT-5NV7G")).toBe("APT-5NV7G");
    expect(neutraliseFormula("مرکز درمان و زیبایی آریا")).toBe("مرکز درمان و زیبایی آریا");
  });

  it("keeps numbers, including negative ones, intact", () => {
    expect(neutraliseFormula("1200000")).toBe("1200000");
    expect(neutraliseFormula("-500")).toBe("-500");
    expect(neutraliseFormula("-1.5")).toBe("-1.5");
    expect(csvCell(-99)).toBe("-99");
  });

  it("still escapes structural characters", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("neutralises the formula even when the cell also needs quoting", () => {
    expect(csvCell("=1+1,x")).toBe(`"'=1+1,x"`);
  });

  it("handles empty values", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell("")).toBe("");
  });

  it("csvRow joins escaped cells", () => {
    expect(csvRow(["APT-1", "=evil()", 1200])).toBe("APT-1,'=evil(),1200");
  });
});