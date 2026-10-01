/** Result contract shared by every server action and its form. */
export type FormState =
  | { ok: true; trackingCode?: string; id?: string; count?: number }
  | { ok: false; error: string; fields?: Record<string, string> };

export const initialFormState: FormState = { ok: true };
