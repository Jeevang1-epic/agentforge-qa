import { describe, expect, it } from "vitest";

import { reviewCommandPolicy, SCANNER_LOG_ARGS } from "../../commands/command-policy.js";
import { failureSuppressionRisks } from "../../risk/failure-suppression-risks.js";
import { calculateRiskScore } from "../../risk/calculate-risk-score.js";
import { determineVerdict } from "../../verdict/determine-verdict.js";
import { analyzeSource } from "./rules.js";
import { eligibleSource } from "./scan.js";
import { compareLines } from "./line-diff.js";
import { filterSafetyArguments } from "../../git/filter-safety.js";
import { LIMITS, type ScanResult } from "./types.js";

const all = [{ start: 1, end: 1000 }];
function analyze(source: string, path = "source.ts") {
  return analyzeSource(path, source, all);
}

describe("failure suppression structural rules", () => {
  it.each([
    ["source.ts", "try {} catch { return None; }"],
    ["source.ts", "try {} catch { return { ok: True }; }"],
    ["source.py", "try:\n    work()\nexcept:\n    return null"],
    ["source.py", "try:\n    work()\nexcept:\n    return undefined"],
    ["source.py", "try:\n    work()\nexcept:\n    return {'ok': true}"],
    ["source.py", "try:\n    work()\nexcept:\n    return {ok: True}"],
  ])("does not classify cross-language or variable values in %s: %s", (path, source) => {
    expect(analyze(source, path).signals).toEqual([]);
  });
  it.each(["throw", "yield", "case"])("keeps regex bodies opaque after %s", (keyword) => {
    const result = analyze(keyword + " /x.catch(() => {})/;");
    expect(result.signals).toEqual([]);
    expect(result.partial).toBe(false);
  });
  it.each([
    ["try { work(); } catch (error) {}", "AFQ-FS001"],
    ["try { work(); } catch {}", "AFQ-FS001"],
    ["try {} catch { /* documented fallback */ }", "AFQ-FS001"],
    ["promise.catch(() => {})", "AFQ-FS004"],
    ["promise.catch(error => {})", "AFQ-FS004"],
    ["promise.catch(async () => {})", "AFQ-FS004"],
    ["promise.catch(function(error) {})", "AFQ-FS004"],
    ["promise.catch(() => undefined)", "AFQ-FS004"],
    ["promise.catch(() => { return undefined; })", "AFQ-FS004"],
    ["promise.catch(() => null)", "AFQ-FS002"],
    ["promise.catch(() => [])", "AFQ-FS002"],
    ["promise.catch(() => ({}))", "AFQ-FS002"],
    ["try {} catch { return []; }", "AFQ-FS002"],
    ["try {} catch { return null; }", "AFQ-FS002"],
    ["try {} catch { return undefined; }", "AFQ-FS002"],
    ["try {} catch { return {}; }", "AFQ-FS002"],
    ["try {} catch { return ''; }", "AFQ-FS002"],
    ["try {} catch { return 0; }", "AFQ-FS002"],
    ["try {} catch { return true; }", "AFQ-FS003"],
    ["try {} catch { return { ok: true }; }", "AFQ-FS003"],
    ["promise.catch(() => true)", "AFQ-FS003"],
    ["promise.catch(() => ({ success: true }))", "AFQ-FS003"],
  ])("detects %s", (source, ruleId) => {
    expect(analyze(source).signals.map((signal) => signal.ruleId)).toContain(ruleId);
    expect(analyze(source).partial).toBe(false);
  });

  it.each([
    ["try:\n    work()\nexcept Exception:\n    pass", "AFQ-FS001"],
    ["try:\n    work()\nexcept:\n    pass", "AFQ-FS001"],
    ["try:\n    work()\nexcept Exception as error: pass", "AFQ-FS001"],
    ["try:\n    work()\nexcept Exception:\n    return None", "AFQ-FS002"],
    ["try:\n    work()\nexcept Exception:\n    return []", "AFQ-FS002"],
    ["try:\n    work()\nexcept Exception:\n    return True", "AFQ-FS003"],
    ["try:\n    work()\nexcept Exception:\n    return {'ok': True}", "AFQ-FS003"],
  ])("detects Python %s", (source, ruleId) => {
    expect(analyze(source, "source.py").signals[0]?.ruleId).toBe(ruleId);
  });

  it.each([
    'const text = "try {} catch {}";',
    "const text = `try {} catch {} // fallback`;",
    "const matcher = /try {} catch {} \\/\\/ fallback/;",
    "const fallback = 1; const degraded = 2;",
    "try {} catch (error) { throw error; }",
    "try {} catch (error) { logger.error(error); }",
    "try {} catch { return false; }",
    "try {} catch { function nested() { return true; } throw error; }",
    "const obj = { catch() { return true; } };",
    "promise.catch(() => nullish())",
    "promise.catch(() => true && validate())",
    "promise.catch(() => 'fallback')",
    "promise.catch(() => EMPTY_STRING)",
    "if (x) /try {} catch {}/.test(text);",
    "const view = <div title='try {} catch {}'>Fallback</div>;",
  ])("does not invent structural findings for %s", (source) => {
    expect(analyze(source).signals).toEqual([]);
  });

  it("ignores Python strings, docstrings, and rethrows", () => {
    expect(analyze('value = """except Exception:\n    pass\n# fallback"""', "source.py").signals).toEqual([]);
    expect(analyze("try:\n    work()\nexcept Exception:\n    raise", "source.py").signals).toEqual([]);
  });
  it("distinguishes JSX text/attributes from executable expressions", () => {
    expect(analyze("const view = <div>try {} catch {} // fallback</div>;", "view.tsx").signals).toEqual([]);
    expect(analyze('const view = <div title="try {} catch {}">fallback</div>;', "view.jsx").signals).toEqual([]);
    const result = analyze('const view = <div>{items.catch(() => {})}<span>fallback</span></div>;', "view.tsx");
    expect(result.partial).toBe(false);
    expect(result.signals.map((signal) => signal.ruleId)).toEqual(["AFQ-FS004"]);
  });

  it("restricts structural findings to changed handlers", () => {
    const source = "try {} catch {}\nconst changed = 1;";
    expect(analyzeSource("source.ts", source, [{ start: 2, end: 2 }]).signals).toEqual([]);
  });

  it("correlates comments only in the same changed hunk", () => {
    const source = "// gracefully fallback rather than failing\ntry {} catch { return []; }";
    expect(analyze(source).signals[0]?.correlated).toBe(true);
    const separate = analyzeSource("source.ts", source, [{ start: 1, end: 1 }, { start: 2, end: 2 }]);
    expect(separate.signals[0]?.correlated).toBe(false);
    expect(analyzeSource("source.ts", source, [{ start: 2, end: 2 }]).signals[0]?.correlated).toBe(false);
  });

  it("records nearby validation semantics without attributing intent", () => {
    const source = "function validateAccess() {\ntry {} catch { return true; }\n}";
    expect(analyze(source).signals[0]?.validationContext).toBe(true);
  });

  it("returns deterministic normalized findings without literal contents", () => {
    const source = "try { send('sensitive-string'); } catch {}";
    expect(analyze(source)).toEqual(analyze(source));
    expect(JSON.stringify(analyze(source))).not.toContain("sensitive-string");
  });

  it("marks malformed or excessively nested input partial", () => {
    expect(analyze("try {").partial).toBe(true);
    expect(analyze("(".repeat(LIMITS.nesting + 1)).partial).toBe(true);
    expect(analyze("x;".repeat(LIMITS.tokens)).partial).toBe(true);
  });

  it("supports source extensions and explicitly excludes generated trees", () => {
    for (const path of ["src/a.js", "a.ts", "a.jsx", "a.tsx", "a.py", "a.mjs", "a.cts"]) expect(eligibleSource(path)).toBe(true);
    for (const path of ["node_modules/a.js", ".git/a.py", ".agentforge/a.ts", "dist/a.js", "build/a.py", "vendor/a.ts", "generated/a.ts", "a.min.js", "a.d.ts", "pnpm-lock.yaml", "a.go"]) expect(eligibleSource(path)).toBe(false);
  });

  it("compares additions and deletion anchors without including unrelated lines", () => {
    expect(compareLines("old\nsame", "new\nsame")).toEqual([{ start: 1, end: 1 }]);
    expect(compareLines("same\nremoved\nend", "same\nend")).toEqual([{ start: 2, end: 2 }]);
    expect(compareLines("same\nend", "same\nadded\nend")).toEqual([{ start: 2, end: 2 }]);
    expect(compareLines("a\nsame\nb", "x\nsame\ny")).toEqual([{ start: 1, end: 1 }, { start: 3, end: 3 }]);
    expect(compareLines("same\r\n", "same\n")).toEqual([]);
    expect(() => compareLines(Array.from({ length: 1000 }, (_, i) => "old" + i).join("\n"), Array.from({ length: 1000 }, (_, i) => "new" + i).join("\n"))).toThrow("Line comparison limit");
  });
});

describe("scanner risk policy", () => {
  function risks(source: string) {
    const scan: ScanResult = { ...analyze(source), status: "complete", filesScanned: 1, filesSkipped: 0, summary: "Complete." };
    return failureSuppressionRisks(scan, "git:status");
  }
  const artifact = { id: "artifact:ok", artifactId: "ok", label: "ok", path: "ok.txt", matchedPaths: ["ok.txt"], type: "file" as const, required: true, status: "found" as const };
  function verdict(source: string) {
    return determineVerdict({ artifacts: [artifact], claimVerdicts: [], commands: [], risks: risks(source), toolStatus: "OK" });
  }

  it("keeps language-only findings informational, zero-weight, and nonblocking", () => {
    expect(risks("// fallback")[0]).toMatchObject({ severity: "info", blocksVerdict: false, evidenceIds: ["git:status"] });
    expect(calculateRiskScore(risks("// fallback")).score).toBe(0);
    expect(verdict("// fallback")).toBe("SAFE_TO_CONTINUE");
  });
  it("keeps uncorrelated defaults nonblocking and raises correlated defaults to review", () => {
    expect(verdict("try {} catch { return []; }")).toBe("SAFE_TO_CONTINUE");
    expect(verdict("// fallback\ntry {} catch { return []; }")).toBe("NEEDS_REVIEW");
  });
  it.each(["try {} catch {}", "promise.catch(() => {})", "try {} catch { return true; }"])("requires review without unsafe/demo verdict for %s", (source) => {
    expect(verdict(source)).toBe("NEEDS_REVIEW");
  });
  it("makes partial scans blocking warnings", () => {
    const findings = failureSuppressionRisks({ status: "partial", signals: [], filesScanned: 0, filesSkipped: 1, summary: "Source unavailable." }, "git:status");
    expect(findings[0]).toMatchObject({ category: "partial_verification", severity: "warning", blocksVerdict: true });
  });
});

describe("scanner Git allowlist", () => {
  const prefix = ["-c", "core.fsmonitor=false", "--no-optional-locks"];
  const approved = (args: string[]) => reviewCommandPolicy("git", [...prefix, ...args]).approved;
  it("bounds and validates filter-neutralization metadata", () => {
    expect(filterSafetyArguments("filter.demo.clean\0filter.demo.required\0")).toEqual([
      "-c", "filter.demo.clean=", "-c", "filter.demo.smudge=",
      "-c", "filter.demo.process=", "-c", "filter.demo.required=false",
    ]);
    expect(() => filterSafetyArguments("filter.demo.clean")).toThrow("Incomplete");
    expect(() => filterSafetyArguments("filter.bad name.clean\0")).toThrow("Unsupported");
    expect(() => filterSafetyArguments(Array.from({ length: 101 }, (_, i) => `filter.f${i}.clean\0`).join(""))).toThrow("limit");
  });
  it("allows only the exact scanner forms", () => {
    expect(approved(["ls-tree", "--full-tree", "-z", "HEAD", "--", ":(literal)source.ts"])).toBe(true);
    expect(approved(["cat-file", "blob", "a".repeat(40)])).toBe(true);
    expect(approved([...SCANNER_LOG_ARGS, "main..HEAD", "--"])).toBe(true);
    expect(approved(["rev-parse", "--verify", "HEAD"])).toBe(true);
    expect(approved(["ls-tree", "--full-tree", "-z", "HEAD", "--", "*.ts"])).toBe(false);
    expect(approved(["cat-file", "--filters", "a".repeat(40)])).toBe(false);
    expect(approved(["-c", "filter.demo.clean=node evil.js", "status", "--porcelain=v1", "-z", "--untracked-files=all"])).toBe(false);
    expect(approved(["-c", "filter.demo.clean=", "-c", "filter.demo.required=false", "status", "--porcelain=v1", "-z", "--untracked-files=all"])).toBe(true);
    expect(approved([...SCANNER_LOG_ARGS, "main..HEAD", "--", "--all"])).toBe(false);
  });
  it.each(["--output=file", "HEAD~1", "a..b", "-evil", "HEAD;whoami", "HEAD\n", "HEAD^{tree}"])("rejects unsafe reference %s", (ref) => {
    expect(approved(["ls-tree", "--full-tree", "-z", ref, "--", ":(literal)source.ts"])).toBe(false);
    expect(approved([...SCANNER_LOG_ARGS, ref + "..HEAD", "--"])).toBe(false);
  });
  it.each(["commit", "add", "checkout", "switch", "reset", "clean", "stash", "push", "pull", "fetch"])("rejects %s", (subcommand) => {
    expect(approved([subcommand])).toBe(false);
  });
});
