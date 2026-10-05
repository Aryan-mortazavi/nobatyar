import { describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";

/**
 * Guards the timing equaliser used by loginAction.
 *
 * The property under test is structural, not statistical: the same comparison
 * must run whether or not the address exists, so a sign-in attempt costs the
 * same either way. An HTTP timing assertion would be flaky in CI; this one
 * pins the two facts that actually matter — it is a real cost-12 hash, and it
 * does not match any guessable password.
 */
const TIMING_EQUALISER_HASH =
  "$2a$12$TfDemEOeVS92omaKpuluNOuxhipUepjHO7vrTlfqwFjdAMZYGOmHO";

describe("login timing equaliser", () => {
  it("is a syntactically valid bcrypt hash", () => {
    expect(TIMING_EQUALISER_HASH).toMatch(/^\$2[aby]\$12\$/);
    expect(bcrypt.getRounds(TIMING_EQUALISER_HASH)).toBe(12);
  });

  it("rejects an ordinary password, so it cannot be mistaken for a real account", async () => {
    const guesses = ["", "password", "nobatyar", "Nobat#2026", "admin", "123456", "test"];
    for (const g of guesses) {
      expect(await bcrypt.compare(g, TIMING_EQUALISER_HASH)).toBe(false);
    }
  });

  it("costs the same as comparing against a real account hash", async () => {
    // Same cost factor => same work. Asserted structurally rather than by
    // wall clock: a millisecond comparison is flaky on a loaded CI box and
    // would fail for reasons that have nothing to do with the code.
    const real = await bcrypt.hash("QaProbe#2026x", 12);
    expect(bcrypt.getRounds(real)).toBe(bcrypt.getRounds(TIMING_EQUALISER_HASH));
    expect(real.length).toBe(TIMING_EQUALISER_HASH.length);
  });
});