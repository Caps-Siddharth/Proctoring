// types/browserProctoring.types.ts

export const ViolationType = {
  TAB_SWITCH: 'TAB_SWITCH',
  WINDOW_BLUR: 'WINDOW_BLUR',
  FULLSCREEN_EXIT: 'FULLSCREEN_EXIT',
  RIGHT_CLICK: 'RIGHT_CLICK',
  DEV_TOOLS: 'DEV_TOOLS',
  COPY_PASTE: 'COPY_PASTE',
  WINDOW_RESIZE: 'WINDOW_RESIZE',
  KEYBOARD_SHORTCUT: 'KEYBOARD_SHORTCUT'
} as const;
export type ViolationType = typeof ViolationType[keyof typeof ViolationType];

export interface Violation {
  id: string;
  type: typeof ViolationType[keyof typeof ViolationType];
  timestamp: number;
  details?: string;
  screenshot?: string;
  severity: 'low' | 'medium' | 'high';
}

export interface ViolationThresholds {
  [ViolationType.TAB_SWITCH]: number;
  [ViolationType.WINDOW_BLUR]: number;
  [ViolationType.FULLSCREEN_EXIT]: number;
  [ViolationType.RIGHT_CLICK]: number;
  [ViolationType.DEV_TOOLS]: number;
  [ViolationType.COPY_PASTE]: number;
  [ViolationType.WINDOW_RESIZE]: number;
  [ViolationType.KEYBOARD_SHORTCUT]: number;
}

export interface BrowserProctoringConfig {
  enableFullscreen: boolean;
  enableTabSwitchDetection: boolean;
  enableWindowBlurDetection: boolean;
  enableRightClickPrevention: boolean;
  enableDevToolsPrevention: boolean;
  enableCopyPastePrevention: boolean;
  enableResizeDetection: boolean;
  maxViolations: number;
  violationThresholds: Partial<ViolationThresholds>;
  warningThresholds: {
    low: number;
    medium: number;
    high: number;
  };
  autoTerminateOnMaxViolations: boolean;
  screenshotOnViolation: boolean;
}

export interface BrowserProctoringState {
  isMonitoring: boolean;
  isFullscreen: boolean;
  violations: Violation[];
  violationCounts: Partial<Record<ViolationType, number>>;
  totalViolations: number;
  warningLevel: 'none' | 'low' | 'medium' | 'high';
  isTerminated: boolean;
}

export type ViolationCallback = (violation: Violation) => void;
export type TerminationCallback = (violations: Violation[]) => void;

export interface KeyboardShortcut {
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  preventDefault: boolean;
}

export const DEFAULT_CONFIG: BrowserProctoringConfig = {
  enableFullscreen: true,
  enableTabSwitchDetection: true,
  enableWindowBlurDetection: true,
  enableRightClickPrevention: true,
  enableDevToolsPrevention: true,
  enableCopyPastePrevention: true,
  enableResizeDetection: true,
  maxViolations: 10,
  violationThresholds: {
    [ViolationType.TAB_SWITCH]: 3,
    [ViolationType.WINDOW_BLUR]: 3,
    [ViolationType.FULLSCREEN_EXIT]: 2,
    [ViolationType.RIGHT_CLICK]: 5,
    [ViolationType.DEV_TOOLS]: 1,
    [ViolationType.COPY_PASTE]: 5,
    [ViolationType.WINDOW_RESIZE]: 3,
    [ViolationType.KEYBOARD_SHORTCUT]: 3
  },
  warningThresholds: {
    low: 2,
    medium: 5,
    high: 8
  },
  autoTerminateOnMaxViolations: true,
  screenshotOnViolation: true
};