/**
 * Scoped-CSS inspection helpers. kanabun's `css\`…\`` tag injects one
 * `<style data-k="<hash>">` per unique body into `document.head`; these read
 * them back so a test can assert on the injected rules.
 */
import { docHead, type MockNode } from "./dom-mock";

/**
 * The `<style>` elements currently injected into `<head>`, in document order,
 * as `[data-k, cssText]` pairs. Non-`<style>` head content (e.g. `<Head>`
 * output) is ignored.
 */
export function styles(): Array<[string | null, string]> {
  return docHead()
    .childNodes.filter(
      (n): n is MockNode => n.nodeType === 1 && n.tagName.toLowerCase() === "style",
    )
    .map((n) => [n.getAttribute("data-k"), n.textContent]);
}

/**
 * The single injected rule text for a scoped class (a `k-<hash>` returned by
 * `css`). Throws unless exactly one matching `<style>` exists — a duplicate
 * means dedupe broke, zero means the injection didn't happen.
 */
export function ruleFor(cls: string): string {
  const id = cls.slice(2); // strip the "k-" prefix
  const matches = styles().filter(([k]) => k === id);
  if (matches.length !== 1) {
    throw new Error(
      `ruleFor("${cls}"): expected exactly one injected <style>, found ${matches.length}`,
    );
  }
  return matches[0]![1];
}
