export function metricValue(text: string, series: string): number {
  const line = text.split("\n").find((candidate) => candidate.startsWith(`${series} `));
  if (!line) {
    throw new Error(`metric not found: ${series}`);
  }
  return Number(line.slice(series.length + 1));
}
