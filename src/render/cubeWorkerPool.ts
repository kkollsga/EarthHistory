export function cubeWorkerPoolLimit(hardwareConcurrency: number | undefined): 1 | 2 | 4 {
  const concurrency = Number.isFinite(hardwareConcurrency) ? hardwareConcurrency! : 2;
  if (concurrency >= 8) return 4;
  if (concurrency >= 6) return 2;
  return 1;
}

export function partitionCubeWorkerRequests<T>(
  requests: readonly T[],
  concurrency: number,
): T[][] {
  if (requests.length === 0) return [];
  const requested = Number.isFinite(concurrency) ? Math.floor(concurrency) : 1;
  const count = Math.max(1, Math.min(requests.length, requested));
  const groups = Array.from({ length: count }, () => [] as T[]);
  requests.forEach((request, index) => groups[index % count].push(request));
  return groups;
}
