export interface PalettedSheetRequest {
  readonly id: number;
  /** The indexed sheet's absolute URL. */
  readonly url: string;
  /** The stem's base64 palette, as its manifest carries it. */
  readonly palette: string;
}

export type PalettedSheetReply =
  | { readonly id: number; readonly bitmap: ImageBitmap }
  | { readonly id: number; readonly error: string };
