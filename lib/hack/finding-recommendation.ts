export function extractFindingRecommendation(
  evidence: string,
  fallback: string,
): string {
  const reported = evidence.match(/\bremediation:\s*([\s\S]+)$/i)?.[1]?.trim();
  return reported || fallback;
}
