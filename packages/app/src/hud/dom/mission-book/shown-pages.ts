import { BRIEFING_HISTORY_LIMIT } from '@open-northland/sim';

/**
 * The briefing pages the book has shown, oldest first, which are its chapters, and the one on display.
 * The list drops its oldest page past {@link BRIEFING_HISTORY_LIMIT} (reading).
 */
export class ShownPages {
  /** The page last shown; null before any. */
  page: number | null = null;
  private pages: number[] = [];

  get list(): readonly number[] {
    return this.pages;
  }

  /** Fold the sim's own delivered history in, so a page shown before this book mounted is a chapter. */
  fold(recorded: readonly number[]): void {
    for (const page of recorded) this.add(page);
  }

  show(page: number): void {
    this.page = page;
    this.add(page);
  }

  /** A page already in the list stays where it was, a new one goes on the end. */
  private add(page: number): void {
    if (this.pages.includes(page)) return;
    this.pages.push(page);
    if (this.pages.length > BRIEFING_HISTORY_LIMIT)
      this.pages.splice(0, this.pages.length - BRIEFING_HISTORY_LIMIT);
  }
}
