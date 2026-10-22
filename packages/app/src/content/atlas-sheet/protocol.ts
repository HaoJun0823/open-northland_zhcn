/** What the page wants back for one paletted sheet: a bitmap for a texture, or an image file for the DOM. */
export type PalettedSheetForm = 'bitmap' | 'blob';

export interface PalettedSheetRequest {
  readonly id: number;
  /** The indexed sheet's absolute URL. */
  readonly url: string;
  /** The stem's base64 palette, as its manifest carries it. */
  readonly palette: string;
  readonly form: PalettedSheetForm;
}

export type PalettedSheetReply =
  | { readonly id: number; readonly bitmap: ImageBitmap }
  | { readonly id: number; readonly blob: Blob }
  | { readonly id: number; readonly error: string };
