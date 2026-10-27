/** Pure helpers of the benchmark page (M4). */
import { BENCHMARK_PROMPTS, type BenchmarkResult } from '../../../../lib/benchmark-prompts'

/** The newest run of each prompt, in the order of the prompts. Pure. */
export function latestRuns(runs: readonly BenchmarkResult[]): BenchmarkResult[] {
  const out: BenchmarkResult[] = []
  for (const prompt of BENCHMARK_PROMPTS) {
    const mine = runs.filter((r) => r.promptId === prompt.id)
    if (mine.length > 0) out.push(mine[mine.length - 1])
  }
  return out
}
