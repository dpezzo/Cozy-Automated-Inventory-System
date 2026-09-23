import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

export const HOME_LABEL_OPTIONS = ["Home", "Run Reconciliation"] as const;
export type HomeLabel = (typeof HOME_LABEL_OPTIONS)[number];

interface HomeLabelState {
  homeLabel: HomeLabel;
  setHomeLabel: (label: HomeLabel) => void;
}

const STORAGE_KEY = "cw-home-label";

const HomeLabelContext = createContext<HomeLabelState | null>(null);

function getInitialHomeLabel(): HomeLabel {
  const stored = localStorage.getItem(STORAGE_KEY);
  return (HOME_LABEL_OPTIONS as readonly string[]).includes(stored ?? "") ? (stored as HomeLabel) : "Home";
}

export function HomeLabelProvider({ children }: { children: ReactNode }) {
  const [homeLabel, setHomeLabelState] = useState<HomeLabel>(getInitialHomeLabel);

  const setHomeLabel = useCallback((label: HomeLabel) => {
    setHomeLabelState(label);
    localStorage.setItem(STORAGE_KEY, label);
  }, []);

  return <HomeLabelContext.Provider value={{ homeLabel, setHomeLabel }}>{children}</HomeLabelContext.Provider>;
}

export function useHomeLabel(): HomeLabelState {
  const ctx = useContext(HomeLabelContext);
  if (!ctx) throw new Error("useHomeLabel must be used within a HomeLabelProvider");
  return ctx;
}
