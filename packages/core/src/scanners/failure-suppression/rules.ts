import { lexSource, type Token } from "./lex.js";
import { LIMITS, suppressionLanguage, type ChangedRange, type RuleId, type Signal } from "./types.js";

function valueRule(values: Token[], python: boolean): RuleId | undefined {
  const text = values.map((token) => token.value).join(" ");
  if (text === "EMPTY_STRING" && values[0]?.literal !== true) return undefined;
  const defaults = ["[ ]", "{ }", "EMPTY_STRING", "0", ...(python ? ["None"] : ["null", "undefined"])];
  if (defaults.includes(text)) return "AFQ-FS002";
  const success = python ? "True" : "true";
  if (text === success || (values.length === 5 && values[0]?.value === "{" &&
    ["ok", "success", "allowed", "authorized", "valid"].includes(values[1]?.value ?? "") &&
    (!python || values[1]?.literal === true) && values[2]?.value === ":" &&
    values[3]?.value === success && values[4]?.value === "}")) return "AFQ-FS003";
  return undefined;
}

export function analyzeSource(path: string, source: string, ranges: readonly ChangedRange[]): { signals: Signal[]; partial: boolean } {
  const python = /\.py$/i.test(path);
  const { tokens, comments, pairs, partial } = lexSource(source, python, /\.[jt]sx$/i.test(path));
  const signals: Signal[] = [];
  const hunks = new Int32Array(source.split("\n").length + 1).fill(-1);
  ranges.forEach((range, index) => {
    for (let line = Math.max(1, range.start); line <= Math.min(range.end, hunks.length - 1); line += 1) hunks[line] = index;
  });
  const languageHunks = new Set<number>();
  const changedComments: Token[] = [];
  for (const comment of comments) {
    if (!suppressionLanguage(comment.value)) continue;
    let changed = false;
    for (let line = comment.line; line <= comment.endLine; line += 1) {
      const hunk = hunks[line] ?? -1;
      if (hunk >= 0) { changed = true; languageHunks.add(hunk); }
    }
    if (changed) changedComments.push(comment);
  }
  const validationLines = new Set(tokens.filter((token) =>
    !token.literal && /^(?:validate\w*|auth\w*|access|permission\w*|check\w*|verify\w*)$/i.test(token.value)).map((token) => token.line));
  const add = (ruleId: RuleId, start: Token, end: Token): void => {
    let changed = false;
    let correlated = false;
    for (let line = start.line; line <= end.endLine; line += 1) {
      const hunk = hunks[line] ?? -1;
      changed ||= hunk >= 0;
      correlated ||= languageHunks.has(hunk);
    }
    if (!changed) return;
    signals.push({ ruleId, path, line: start.line, correlated,
      validationContext: [0, 1, 2, 3].some((distance) => validationLines.has(start.line - distance)) });
  };
  const classifyBody = (body: Token[], start: Token, end: Token, promise = false): void => {
    const values = body.map((token) => token.value);
    while (values.at(-1) === ";") values.pop();
    if (values.length === 0 || (python && values.join(" ") === "pass")) {
      add(promise ? "AFQ-FS004" : "AFQ-FS001", start, end);
    } else if (values[0] === "return") {
      const rule = valueRule(body.slice(1, values.length), python);
      if (rule !== undefined) add(promise && values[1] === "undefined" ? "AFQ-FS004" : rule, start, end);
    }
  };
  for (let index = 0; index < tokens.length && signals.length < LIMITS.signals; index += 1) {
    const token = tokens[index];
    if (token === undefined) continue;
    if (!python && token.value === "catch") {
      const promise = tokens[index - 1]?.value === "." || tokens[index - 1]?.value === "?.";
      if (!promise && tokens[index - 1]?.value !== "}") continue;
      let body = index + 1;
      if (promise) {
        if (tokens[body]?.value !== "(") continue;
        const callEnd = pairs.get(body);
        if (callEnd === undefined) continue;
        body += 1;
        if (tokens[body]?.value === "async") body += 1;
        if (tokens[body]?.value === "function") {
          body += 1;
          if (tokens[body]?.value !== "(") body += 1;
          body = (pairs.get(body) ?? callEnd) + 1;
        } else {
          body = tokens[body]?.value === "(" ? (pairs.get(body) ?? callEnd) + 1 : body + 1;
          if (tokens[body]?.value !== "=>") continue;
          body += 1;
          if (tokens[body]?.value !== "{") {
            let expression = tokens.slice(body, callEnd);
            if (expression[0]?.value === "(" && expression.at(-1)?.value === ")") expression = expression.slice(1, -1);
            const rule = valueRule(expression, false);
            if (rule !== undefined) add(expression[0]?.value === "undefined" ? "AFQ-FS004" : rule, token, tokens[callEnd] ?? token);
            continue;
          }
        }
      } else if (tokens[body]?.value === "(") {
        body = (pairs.get(body) ?? tokens.length) + 1;
      }
      const end = pairs.get(body);
      if (tokens[body]?.value === "{" && end !== undefined) {
        classifyBody(tokens.slice(body + 1, end), token, tokens[end] ?? token, promise);
      }
    } else if (python && token.value === "except") {
      let colon = index + 1;
      while (colon < tokens.length && tokens[colon]?.line === token.line && tokens[colon]?.value !== ":") colon += 1;
      if (tokens[colon]?.value !== ":") continue;
      let end = colon + 1;
      while (end < tokens.length) {
        const current = tokens[end];
        if (current !== undefined && current.line > token.line && current.column <= token.column) break;
        end += 1;
      }
      classifyBody(tokens.slice(colon + 1, end), token, tokens[end - 1] ?? token);
    }
  }
  for (const comment of changedComments) {
    if (signals.length >= LIMITS.signals) break;
    signals.push({ ruleId: "AFQ-FS005", path, line: comment.line, correlated: false, validationContext: false });
  }
  return { signals: signals.slice(0, LIMITS.signals), partial: partial || signals.length >= LIMITS.signals };
}
