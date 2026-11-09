import { tr, type Dictionary } from "./tr";

export type Locale = "tr";
export const defaultLocale: Locale = "tr";
export const locales: Locale[] = ["tr"];

const dictionaries: Record<Locale, Dictionary> = { tr };

// İkinci bir dil eklendiğinde çağıranlar kullanıcının dilini buraya geçirir.
export function getDict(locale: string = defaultLocale): Dictionary {
  return dictionaries[locale as Locale] ?? dictionaries[defaultLocale];
}

export type { Dictionary };
