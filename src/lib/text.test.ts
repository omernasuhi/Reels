import { describe, expect, it } from "vitest";
import { deriveTitle } from "./text";

describe("deriveTitle", () => {
  it("kısa konuyu olduğu gibi kullanır, sondaki noktayı atar", () => {
    expect(deriveTitle("  Kafede  üç hata. ")).toBe("Kafede üç hata");
  });
  it("uzun notta yalnızca ilk cümleyi alır", () => {
    expect(deriveTitle("İlk cümle burada. İkinci cümle uzun bir açıklama.")).toBe(
      "İlk cümle burada",
    );
  });
  it("uzun cümleyi kelime sınırında keser", () => {
    const t = deriveTitle("kelime ".repeat(30));
    expect(t.length).toBeLessThanOrEqual(61);
    expect(t.endsWith("…")).toBe(true);
    expect(t).not.toMatch(/keli…$/);
  });
});
