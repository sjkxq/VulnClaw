export interface UiPreferences {
  language: "zh-CN" | "en-US";
  defaultCheckMode: "quick" | "standard" | "deep" | "continuous";
  reportFormat: "markdown" | "html";
  showTechnicalLogs: boolean;
}

const STORAGE_KEY = "vulnclaw.ui.preferences";

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  language: "zh-CN",
  defaultCheckMode: "standard",
  reportFormat: "markdown",
  showTechnicalLogs: false,
};

export function loadUiPreferences(): UiPreferences {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_UI_PREFERENCES;
    const parsed = JSON.parse(raw) as Partial<UiPreferences>;
    return {
      language: parsed.language === "en-US" ? "en-US" : "zh-CN",
      defaultCheckMode: isCheckMode(parsed.defaultCheckMode) ? parsed.defaultCheckMode : DEFAULT_UI_PREFERENCES.defaultCheckMode,
      reportFormat: parsed.reportFormat === "html" ? "html" : "markdown",
      showTechnicalLogs: Boolean(parsed.showTechnicalLogs),
    };
  } catch {
    return DEFAULT_UI_PREFERENCES;
  }
}

export function saveUiPreferences(preferences: UiPreferences): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
}

function isCheckMode(value: unknown): value is UiPreferences["defaultCheckMode"] {
  return value === "quick" || value === "standard" || value === "deep" || value === "continuous";
}
