// Only empty driver commands and required=false may cross the Git policy boundary.
export function filterSafetyArguments(output: string): string[] {
  if (output !== "" && !output.endsWith("\0")) throw new Error("Incomplete filter metadata.");
  const drivers = new Set<string>();
  for (const key of output.split("\0").filter(Boolean)) {
    if (!key.toLowerCase().startsWith("filter.")) continue;
    const match = key.match(/^filter\.([A-Za-z0-9_.-]{1,100})\.(?:clean|smudge|process|required)$/i);
    if (match === null) throw new Error("Unsupported filter metadata.");
    drivers.add(match[1] ?? "");
    if (drivers.size > 100) throw new Error("Filter metadata limit.");
  }
  return [...drivers].sort().flatMap((driver) => [
    "-c", `filter.${driver}.clean=`,
    "-c", `filter.${driver}.smudge=`,
    "-c", `filter.${driver}.process=`,
    "-c", `filter.${driver}.required=false`,
  ]);
}
