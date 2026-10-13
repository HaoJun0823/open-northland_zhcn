/** Each turn creates at most this many cards, allowing input and painting between batches. */
export const CARDS_PER_BATCH = 12;

export function renderCardBatches<T>(
  rows: readonly T[],
  append: (rows: readonly T[], complete: boolean) => void,
): () => void {
  let offset = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;
  const next = () => {
    if (cancelled) return;
    const batch = rows.slice(offset, offset + CARDS_PER_BATCH);
    offset += batch.length;
    const complete = offset === rows.length;
    append(batch, complete);
    if (!complete && !cancelled) timer = setTimeout(next, 0);
  };
  next();
  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}
