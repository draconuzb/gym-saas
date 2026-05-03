"use client";
import { useState, useEffect, useCallback } from "react";
import { translations, Locale, languages } from "@/lib/i18n";

export function useLocale() {
  const [locale, setLocaleState] = useState<Locale>("uz");

  useEffect(() => {
    const saved = localStorage.getItem("locale") as Locale;
    if (saved && translations[saved]) setLocaleState(saved);
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    localStorage.setItem("locale", l);
  }, []);

  const t = useCallback(
    (key: string): string => {
      return translations[locale]?.[key] || translations["uz"]?.[key] || key;
    },
    [locale]
  );

  return { locale, setLocale, t, languages };
}
