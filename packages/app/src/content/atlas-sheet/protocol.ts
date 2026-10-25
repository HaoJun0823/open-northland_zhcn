export interface PalettedSheetRequest {
  readonly id: number;
  /** The indexed sheet's absolute URL. */
  readonly url: string;
  /** The stem's base64 palette, as its manifest carries it, for a coloured page; absent asks for the
   *  sheet's index and coverage bytes. */
  readonly palette?: string;
}

/** A sheet's pixels as stored: palette index then coverage, two bytes a texel, row-major. */
export interface IndexedSheetPixels {
  readonly pixels: Uint8Array;
  readonly width: number;
  readonly height: number;
}

/** What a request answers: a coloured page, or the sheet's own bytes. */
export type PalettedSheetPayload =
  | { readonly bitmap: ImageBitmap }
  | { readonly indexed: IndexedSheetPixels };

export type PalettedSheetReply =
  | ({ readonly id: number } & PalettedSheetPayload)
  | { readonly id: number; readonly error: string };
