import { LIMITS, type ChangedRange } from "./types.js";

type Edit = "same" | "add" | "delete";

function recoverEdits(trace: Map<number, number>[], oldLength: number, newLength: number): Edit[] {
  const edits: Edit[] = [];
  let x = oldLength;
  let y = newLength;
  for (let depth = trace.length - 1; depth >= 0; depth -= 1) {
    const frontier = trace[depth] ?? new Map<number, number>();
    const diagonal = x - y;
    const previous = diagonal === -depth ||
      (diagonal !== depth && (frontier.get(diagonal - 1) ?? 0) < (frontier.get(diagonal + 1) ?? 0))
      ? diagonal + 1 : diagonal - 1;
    const previousX = frontier.get(previous) ?? 0;
    const previousY = previousX - previous;
    while (x > previousX && y > previousY) {
      edits.push("same");
      x -= 1;
      y -= 1;
    }
    if (depth === 0) break;
    if (x === previousX) { edits.push("add"); y -= 1; }
    else { edits.push("delete"); x -= 1; }
  }
  return edits.reverse();
}

function rangesFromEdits(edits: Edit[]): ChangedRange[] {
  const ranges: ChangedRange[] = [];
  let line = 1;
  let hunk: ChangedRange | undefined;
  for (const edit of edits) {
    if (edit === "same") {
      if (hunk !== undefined) ranges.push(hunk);
      hunk = undefined;
      line += 1;
    } else {
      hunk ??= { start: line, end: line };
      if (edit === "add") {
        hunk.end = line;
        line += 1;
      }
    }
  }
  if (hunk !== undefined) ranges.push(hunk);
  return ranges;
}

// Bounded Myers line comparison avoids invoking repository-configured Git filters.
export function compareLines(before: string, after: string): ChangedRange[] {
  const oldLines = before.replaceAll("\r\n", "\n").split("\n");
  const newLines = after.replaceAll("\r\n", "\n").split("\n");
  const frontier = new Map<number, number>([[1, 0]]);
  const trace: Map<number, number>[] = [];
  let steps = 0;
  for (let depth = 0; depth <= oldLines.length + newLines.length; depth += 1) {
    trace.push(new Map(frontier));
    for (let diagonal = -depth; diagonal <= depth; diagonal += 2) {
      if (++steps > LIMITS.diffSteps) throw new Error("Line comparison limit.");
      let x = diagonal === -depth ||
        (diagonal !== depth && (frontier.get(diagonal - 1) ?? 0) < (frontier.get(diagonal + 1) ?? 0))
        ? frontier.get(diagonal + 1) ?? 0 : (frontier.get(diagonal - 1) ?? 0) + 1;
      let y = x - diagonal;
      while (x < oldLines.length && y < newLines.length && oldLines[x] === newLines[y]) {
        if (++steps > LIMITS.diffSteps) throw new Error("Line comparison limit.");
        x += 1;
        y += 1;
      }
      frontier.set(diagonal, x);
      if (x >= oldLines.length && y >= newLines.length) {
        return rangesFromEdits(recoverEdits(trace, oldLines.length, newLines.length));
      }
    }
  }
  throw new Error("Line comparison unavailable.");
}
