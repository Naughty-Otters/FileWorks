import {
  phaseAfterFileSelect,
  phaseForRestoredFile,
} from "@/lib/workspace-flow";

describe("workspace flow", () => {
  describe("phaseForRestoredFile", () => {
    it("shows the path chooser for PDFs, images, text, and office", () => {
      expect(phaseForRestoredFile(new File(["x"], "a.pdf", { type: "application/pdf" }))).toBe(
        "choose",
      );
      expect(phaseForRestoredFile(new File(["x"], "a.png", { type: "image/png" }))).toBe("choose");
      expect(phaseForRestoredFile(new File(["x"], "a.md", { type: "text/markdown" }))).toBe("choose");
      expect(
        phaseForRestoredFile(
          new File(["x"], "a.docx", {
            type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          }),
        ),
      ).toBe("choose");
    });

    it("opens produce directly for unknown files", () => {
      expect(phaseForRestoredFile(new File(["x"], "a.zip", { type: "application/zip" }))).toBe(
        "produce",
      );
    });

    it("opens produce when the blob has not arrived yet", () => {
      expect(phaseForRestoredFile(null)).toBe("produce");
    });
  });

  describe("phaseAfterFileSelect", () => {
    it("returns home when the file is cleared", () => {
      expect(
        phaseAfterFileSelect({ currentPhase: "choose", outputLayout: "standard", cleared: true }),
      ).toBe("home");
    });

    it("stays in produce when replacing a file inside the workbench", () => {
      expect(
        phaseAfterFileSelect({ currentPhase: "produce", outputLayout: "standard", cleared: false }),
      ).toBe("produce");
    });

    it("skips the chooser when Intent is already set", () => {
      expect(
        phaseAfterFileSelect({
          currentPhase: "home",
          outputLayout: "builtin:invoice",
          cleared: false,
        }),
      ).toBe("produce");
    });

    it("shows the chooser for a fresh upload from home", () => {
      expect(
        phaseAfterFileSelect({ currentPhase: "home", outputLayout: "standard", cleared: false }),
      ).toBe("choose");
    });
  });
});
