import { describe, expect, it } from "vitest";

import { isValidPhone, normalisePhone, phoneOrNull, toLatinDigits } from "@/lib/phone";

describe("toLatinDigits", () => {
  it("converts Persian and Arabic-Indic digits", () => {
    expect(toLatinDigits("۰۹۱۲۳۴۵۶۷۸۹")).toBe("09123456789");
    expect(toLatinDigits("٠٩١٢٣٤٥٦٧٨٩")).toBe("09123456789");
    expect(toLatinDigits("09123456789")).toBe("09123456789");
    expect(toLatinDigits("no digits here")).toBe("no digits here");
  });
});

describe("normalisePhone", () => {
  it("accepts the shapes people actually type", () => {
    const expected = "09123456789";
    for (const input of [
      "09123456789",
      "0912 345 6789",
      "0912-345-6789",
      "0912.345.6789",
      "(0912) 345 6789",
      "+989123456789",
      "00989123456789",
      "989123456789",
      "9123456789",
      "۰۹۱۲۳۴۵۶۷۸۹",
      "۰۹۱۲ ۳۴۵ ۶۷۸۹",
    ]) {
      const result = normalisePhone(input);
      expect(result.ok, `${input} should be accepted`).toBe(true);
      if (result.ok) expect(result.phone).toBe(expected);
    }
  });

  it("produces the E.164 form for messaging APIs", () => {
    const result = normalisePhone("۰۹۱۲۳۴۵۶۷۸۹");
    expect(result.ok && result.e164).toBe("+989123456789");
  });

  it("accepts every real operator prefix, not just 091x", () => {
    // 0912/0935/0940/0990 are all valid Iranian mobiles
    for (const phone of ["09123456789", "09351234567", "09401234567", "09901234567"]) {
      expect(isValidPhone(phone), `${phone} should be valid`).toBe(true);
    }
  });

  it("rejects landlines, short numbers and nonsense", () => {
    for (const input of ["02188442211", "0912345", "12345", "", "abcdefghijk", "08123456789"]) {
      expect(isValidPhone(input), `${input} should be rejected`).toBe(false);
    }
  });

  it("explains why it refused", () => {
    const short = normalisePhone("0912");
    expect(short.ok === false && short.reason).toBe("too_short");

    const landline = normalisePhone("02188442211");
    expect(landline.ok === false && landline.reason).toBe("not_mobile");
  });

  it("phoneOrNull is the convenient form", () => {
    expect(phoneOrNull("+98 912 345 6789")).toBe("09123456789");
    expect(phoneOrNull("nope")).toBeNull();
  });
});
