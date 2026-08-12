export function shouldSubmitComposerOnEnter(input: {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  disabled: boolean;
}): boolean {
  return input.key === "Enter" && !input.shiftKey && !input.isComposing && !input.disabled;
}
