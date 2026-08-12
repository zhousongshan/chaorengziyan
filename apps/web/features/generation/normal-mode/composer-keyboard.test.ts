import { describe, expect, it } from "vitest";

import { shouldSubmitComposerOnEnter } from "./composer-keyboard";

describe("normal mode composer keyboard", () => {
  it("submits on Enter", () => {
    expect(
      shouldSubmitComposerOnEnter({
        key: "Enter",
        shiftKey: false,
        isComposing: false,
        disabled: false
      })
    ).toBe(true);
  });

  it("keeps Shift+Enter as a line break", () => {
    expect(
      shouldSubmitComposerOnEnter({
        key: "Enter",
        shiftKey: true,
        isComposing: false,
        disabled: false
      })
    ).toBe(false);
  });

  it("does not submit while an input method is composing text", () => {
    expect(
      shouldSubmitComposerOnEnter({
        key: "Enter",
        shiftKey: false,
        isComposing: true,
        disabled: false
      })
    ).toBe(false);
  });

  it("does not submit while the composer is disabled", () => {
    expect(
      shouldSubmitComposerOnEnter({
        key: "Enter",
        shiftKey: false,
        isComposing: false,
        disabled: true
      })
    ).toBe(false);
  });
});
