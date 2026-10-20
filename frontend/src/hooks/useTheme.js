import { useSyncExternalStore } from "react";
import {
  getThemePreference,
  resolveTheme,
  setThemePreference,
  subscribeTheme,
} from "../lib/theme";

/** The theme preference ("system" | "light" | "dark"), what it resolves to, and a setter. */
export default function useTheme() {
  const preference = useSyncExternalStore(subscribeTheme, getThemePreference, () => "system");
  return { preference, resolved: resolveTheme(preference), setPreference: setThemePreference };
}
