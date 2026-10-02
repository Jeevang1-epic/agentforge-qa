import { LIMITS } from "./types.js";

export interface Token {
  value: string;
  line: number;
  endLine: number;
  column: number;
  literal?: boolean;
}
export interface LexedSource {
  tokens: Token[];
  comments: Token[];
  pairs: Map<number, number>;
  partial: boolean;
}

// Literals are opaque tokens, so source strings and regex bodies cannot become rules.
export function lexSource(source: string, python: boolean, jsx = false): LexedSource {
  const tokens: Token[] = [];
  const comments: Token[] = [];
  const pairs = new Map<number, number>();
  const stack: number[] = [];
  const controlClosings = new Set<number>();
  const jsxExpressions = new Map<number, "tag" | "text">();
  const jsxRoots: number[] = [];
  let jsxMode: "code" | "tag" | "text" = "code";
  let jsxDepth = 0;
  let closingTag = false;
  let partial = false;
  let offset = 0;
  let line = 1;
  let column = 0;
  const advance = (): string => {
    const char = source[offset++] ?? "";
    if (char === "\n") { line += 1; column = 0; } else { column += char === "\t" ? 8 - column % 8 : 1; }
    return char;
  };
  while (offset < source.length) {
    if (tokens.length >= LIMITS.tokens) { partial = true; break; }
    const char = source[offset] ?? "";
    if (jsx && jsxMode !== "code") {
      if (char === "{") {
        jsxExpressions.set(tokens.length, jsxMode);
        jsxMode = "code";
      } else if (jsxMode === "text" && char === "<") {
        closingTag = source[offset + 1] === "/";
        if (!closingTag) jsxDepth += 1;
        jsxMode = "tag";
        advance();
        continue;
      } else if (jsxMode === "tag" && char === ">") {
        if (closingTag || source[offset - 1] === "/") jsxDepth -= 1;
        advance();
        if (jsxDepth === jsxRoots.at(-1)) {
          jsxRoots.pop();
          jsxMode = "code";
        } else jsxMode = "text";
        continue;
      } else if (jsxMode !== "tag" || (char !== "'" && char !== '"')) {
        advance();
        continue;
      }
    } else if (jsx && char === "<" && /[A-Za-z>]/.test(source[offset + 1] ?? "") &&
      /^(?:|=|\(|\[|,|:|return|=>|\?|&&|\|\|)$/.test(tokens.at(-1)?.value ?? "")) {
      jsxRoots.push(jsxDepth);
      jsxDepth += 1;
      closingTag = false;
      jsxMode = "tag";
      advance();
      continue;
    }
    if (/\s/.test(char)) { advance(); continue; }
    const start = offset;
    const startLine = line;
    const startColumn = column;
    let value = "";
    let literal = false;
    const comment = python ? char === "#" : source.startsWith("//", offset) || source.startsWith("/*", offset);
    if (comment) {
      const block = !python && source.startsWith("/*", offset);
      advance(); if (block) advance();
      while (offset < source.length && (block ? !source.startsWith("*/", offset) : source[offset] !== "\n")) advance();
      if (block) {
        if (offset === source.length) partial = true;
        else { advance(); advance(); }
      }
      comments.push({ value: source.slice(start, offset), line: startLine, endLine: line, column: startColumn });
      continue;
    }
    if (char === "'" || char === '"' || (!python && char === "`")) {
      literal = true;
      const triple = python && source.startsWith(char.repeat(3), offset);
      const delimiter = triple ? char.repeat(3) : char;
      for (let i = 0; i < delimiter.length; i += 1) advance();
      const contentStart = offset;
      while (offset < source.length && !source.startsWith(delimiter, offset)) {
        if (source[offset] === "\\") { advance(); if (offset < source.length) advance(); }
        else advance();
      }
      value = offset === contentStart ? "EMPTY_STRING" : "STRING";
      if (["ok", "success", "allowed", "authorized", "valid"].includes(source.slice(contentStart, offset))) {
        value = source.slice(contentStart, offset);
      }
      if (offset === source.length) partial = true;
      else for (let i = 0; i < delimiter.length; i += 1) advance();
    } else if (!python && char === "/" && (controlClosings.has(tokens.length - 1) || /^(?:|=|\(|\[|\{|,|:|;|return|throw|yield|case|=>|!|\?|\|\||&&)$/.test(tokens.at(-1)?.value ?? ""))) {
      advance();
      let characterClass = false;
      let closed = false;
      while (offset < source.length && source[offset] !== "\n") {
        const next = advance();
        if (next === "\\") advance();
        else if (next === "[") characterClass = true;
        else if (next === "]") characterClass = false;
        else if (next === "/" && !characterClass) { closed = true; break; }
      }
      if (!closed) partial = true;
      while (/[a-z]/i.test(source[offset] ?? "") && offset < source.length) advance();
      value = "REGEX";
    } else if (/[a-zA-Z_$0-9]/.test(char)) {
      while (offset < source.length && /[a-zA-Z_$0-9]/.test(source[offset] ?? "")) advance();
      value = source.slice(start, offset);
    } else {
      value = advance();
      if (["=>", "==", "&&", "||", "?.", "**"].includes(value + (source[offset] ?? ""))) value += advance();
    }
    const index = tokens.length;
    tokens.push({ value, line: startLine, endLine: line, column: startColumn, literal });
    if ("([{".includes(value)) {
      stack.push(index);
      if (stack.length > LIMITS.nesting) { partial = true; break; }
    } else if (")]}".includes(value)) {
      const open = stack.pop();
      if (open === undefined || "([{".indexOf(tokens[open]?.value ?? "") !== ")]}".indexOf(value)) partial = true;
      else {
        pairs.set(open, index);
        if (value === ")" && /^(?:if|while|for|with|switch)$/.test(tokens[open - 1]?.value ?? "")) controlClosings.add(index);
        const jsxReturn = jsxExpressions.get(open);
        if (jsxReturn !== undefined) jsxMode = jsxReturn;
      }
    }
  }
  return { tokens, comments, pairs, partial: partial || stack.length > 0 || jsxDepth !== 0 };
}
