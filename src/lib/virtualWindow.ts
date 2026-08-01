export type ItemWindow = { start: number; end: number }

export const itemWindowAround = (
  visibleIndices: Iterable<number>,
  totalItems: number,
  overscan: number,
): ItemWindow => {
  const visible = [...visibleIndices]
  if (totalItems <= 0) return { start: 0, end: -1 }
  if (!visible.length) return { start: 0, end: Math.min(totalItems - 1, overscan) }
  return {
    start: Math.max(0, Math.min(...visible) - overscan),
    end: Math.min(totalItems - 1, Math.max(...visible) + overscan),
  }
}
