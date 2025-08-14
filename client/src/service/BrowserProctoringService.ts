// services/BrowserProctoringService.ts

import type {
  BrowserProctoringConfig,
  BrowserProctoringState,
  Violation,
  ViolationCallback,
  TerminationCallback,
  KeyboardShortcut,
} from "../types/browserProctoring.types";
import { DEFAULT_CONFIG } from "../types/browserProctoring.types";
import { ViolationType } from "../types/browserProctoring.types";

export class BrowserProctoringService {
  private static instance: BrowserProctoringService;
  private config: BrowserProctoringConfig;
  private state: BrowserProctoringState;
  private violationCallbacks: ViolationCallback[] = [];
  private terminationCallbacks: TerminationCallback[] = [];
  private listeners: Map<string, EventListener> = new Map();
  private windowSize: { width: number; height: number } | null = null;
  private devToolsCheckInterval: number | null = null;
  private fullscreenElement: HTMLElement | null = null;

  private forbiddenShortcuts: KeyboardShortcut[] = [
    // Developer Tools
    { key: "F12", preventDefault: true },
    { key: "I", ctrlKey: true, shiftKey: true, preventDefault: true },
    { key: "I", metaKey: true, altKey: true, preventDefault: true }, // Mac
    { key: "J", ctrlKey: true, shiftKey: true, preventDefault: true },
    { key: "J", metaKey: true, altKey: true, preventDefault: true }, // Mac
    { key: "C", ctrlKey: true, shiftKey: true, preventDefault: true },
    { key: "C", metaKey: true, altKey: true, preventDefault: true }, // Mac

    // Copy/Paste
    { key: "C", ctrlKey: true, preventDefault: true },
    { key: "V", ctrlKey: true, preventDefault: true },
    { key: "X", ctrlKey: true, preventDefault: true },
    { key: "A", ctrlKey: true, preventDefault: true },
    { key: "V", metaKey: true, preventDefault: true }, // Mac
    { key: "C", metaKey: true, preventDefault: true }, // Mac
    { key: "X", metaKey: true, preventDefault: true }, // Mac
    { key: "A", metaKey: true, preventDefault: true }, // Mac

    // Windows clipboard history
    { key: "V", metaKey: true, preventDefault: true }, // Windows key + V

    // Browser shortcuts
    { key: "U", ctrlKey: true, preventDefault: true }, // View source
    { key: "S", ctrlKey: true, preventDefault: true }, // Save
    { key: "P", ctrlKey: true, preventDefault: true }, // Print
    { key: "F", ctrlKey: true, preventDefault: true }, // Find
    { key: "H", ctrlKey: true, preventDefault: true }, // History
    { key: "R", ctrlKey: true, preventDefault: true }, // Reload
    { key: "F5", preventDefault: true }, // Reload
  ];

  private constructor() {
    this.config = { ...DEFAULT_CONFIG };
    this.state = {
      isMonitoring: false,
      isFullscreen: false,
      violations: [],
      violationCounts: {},
      totalViolations: 0,
      warningLevel: "none",
      isTerminated: false,
    };
  }

  static getInstance(): BrowserProctoringService {
    if (!BrowserProctoringService.instance) {
      BrowserProctoringService.instance = new BrowserProctoringService();
    }
    return BrowserProctoringService.instance;
  }

  configure(config: Partial<BrowserProctoringConfig>): void {
    this.config = { ...this.config, ...config };
  }

  onViolation(callback: ViolationCallback): () => void {
    this.violationCallbacks.push(callback);
    return () => {
      this.violationCallbacks = this.violationCallbacks.filter(
        (cb) => cb !== callback
      );
    };
  }

  onTermination(callback: TerminationCallback): () => void {
    this.terminationCallbacks.push(callback);
    return () => {
      this.terminationCallbacks = this.terminationCallbacks.filter(
        (cb) => cb !== callback
      );
    };
  }

  async startMonitoring(element?: HTMLElement): Promise<void> {
    if (this.state.isMonitoring) return;

    this.state.isMonitoring = true;
    this.fullscreenElement = element || document.documentElement;

    // Enter fullscreen
    if (this.config.enableFullscreen) {
      await this.enterFullscreen();
    }

    // Setup all event listeners
    this.setupEventListeners();

    // Store initial window size
    this.windowSize = {
      width: window.innerWidth,
      height: window.innerHeight,
    };

    console.log("Browser proctoring started");
  }

  stopMonitoring(): void {
    if (!this.state.isMonitoring) return;

    this.state.isMonitoring = false;
    this.removeEventListeners();

    if (this.devToolsCheckInterval) {
      clearInterval(this.devToolsCheckInterval);
      this.devToolsCheckInterval = null;
    }

    // Exit fullscreen
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }

    console.log("Browser proctoring stopped");
  }

  private setupEventListeners(): void {
    // Visibility change
    if (this.config.enableTabSwitchDetection) {
      const handleVisibilityChange = (): void => {
        if (document.hidden) {
          this.recordViolation(ViolationType.TAB_SWITCH, "User switched tabs");
        }
      };
      document.addEventListener("visibilitychange", handleVisibilityChange);
      this.listeners.set("visibilitychange", handleVisibilityChange);
    }

    // Window blur
    if (this.config.enableWindowBlurDetection) {
      const handleBlur = (): void => {
        if (!document.hasFocus()) {
          this.recordViolation(ViolationType.WINDOW_BLUR, "Window lost focus");
        }
      };
      window.addEventListener("blur", handleBlur);
      this.listeners.set("blur", handleBlur);
    }

    // Right-click prevention
    if (this.config.enableRightClickPrevention) {
      const handleContextMenu = (e: Event): void => {
        e.preventDefault();
        this.recordViolation(
          ViolationType.RIGHT_CLICK,
          "Right-click attempted"
        );
      };
      document.addEventListener("contextmenu", handleContextMenu);
      this.listeners.set("contextmenu", handleContextMenu);
    }

    // Keyboard shortcuts
    if (
      this.config.enableDevToolsPrevention ||
      this.config.enableCopyPastePrevention
    ) {
      const handleKeyDown = (e: KeyboardEvent): void => {
        const shortcut = this.forbiddenShortcuts.find(
          (s) =>
            s.key.toUpperCase() === e.key.toUpperCase() &&
            (s.ctrlKey === undefined || s.ctrlKey === e.ctrlKey) &&
            (s.shiftKey === undefined || s.shiftKey === e.shiftKey) &&
            (s.altKey === undefined || s.altKey === e.altKey) &&
            (s.metaKey === undefined || s.metaKey === e.metaKey)
        );

        if (shortcut) {
          e.preventDefault();
          e.stopPropagation();

          const isDevTools =
            ["F12", "I", "J", "C"].includes(shortcut.key.toUpperCase()) &&
            (shortcut.shiftKey || shortcut.key === "F12");
          const isCopyPaste =
            ["C", "V", "X", "A"].includes(shortcut.key.toUpperCase()) &&
            !shortcut.shiftKey;

          if (isDevTools && this.config.enableDevToolsPrevention) {
            this.recordViolation(
              ViolationType.DEV_TOOLS,
              `Dev tools shortcut: ${this.getShortcutString(e)}`
            );
          } else if (isCopyPaste && this.config.enableCopyPastePrevention) {
            this.recordViolation(
              ViolationType.COPY_PASTE,
              `Copy/paste shortcut: ${this.getShortcutString(e)}`
            );
          } else {
            this.recordViolation(
              ViolationType.KEYBOARD_SHORTCUT,
              `Forbidden shortcut: ${this.getShortcutString(e)}`
            );
          }
        }
      };
      document.addEventListener("keydown", handleKeyDown, true);
      this.listeners.set("keydown", handleKeyDown as EventListener);
    }

    // Clipboard events
    if (this.config.enableCopyPastePrevention) {
      const handleClipboardEvent = (e: Event): void => {
        const clipboardEvent = e as ClipboardEvent;
        clipboardEvent.preventDefault();
        this.recordViolation(
          ViolationType.COPY_PASTE,
          `${clipboardEvent.type} attempted`
        );
      };

      ["copy", "cut", "paste"].forEach((type) => {
        document.addEventListener(type, handleClipboardEvent);
        this.listeners.set(type, handleClipboardEvent);
      });
    }

    // Resize
    if (this.config.enableResizeDetection) {
      const handleResize = (): void => {
        if (!this.windowSize) return;
        const current = {
          width: window.innerWidth,
          height: window.innerHeight,
        };
        const wDiff = Math.abs(current.width - this.windowSize.width);
        const hDiff = Math.abs(current.height - this.windowSize.height);
        if (wDiff > 50 || hDiff > 50) {
          this.recordViolation(
            ViolationType.WINDOW_RESIZE,
            `Window resized from ${this.windowSize.width}x${this.windowSize.height} to ${current.width}x${current.height}`
          );
          this.windowSize = current;
        }
      };
      window.addEventListener("resize", handleResize);
      this.listeners.set("resize", handleResize);
    }

    // Fullscreen changes
    if (this.config.enableFullscreen) {
      const handleFullscreenChange = (): void => {
        this.state.isFullscreen = !!document.fullscreenElement;
        if (!this.state.isFullscreen && this.state.isMonitoring) {
          this.recordViolation(
            ViolationType.FULLSCREEN_EXIT,
            "Exited fullscreen mode"
          );
          setTimeout(() => {
            if (this.state.isMonitoring && !document.fullscreenElement) {
              this.enterFullscreen();
            }
          }, 1000);
        }
      };
      document.addEventListener("fullscreenchange", handleFullscreenChange);
      this.listeners.set("fullscreenchange", handleFullscreenChange);
    }

    // DevTools interval check
    if (this.config.enableDevToolsPrevention) {
      this.devToolsCheckInterval = window.setInterval(() => {
        if (this.isDevToolsOpen()) {
          this.recordViolation(
            ViolationType.DEV_TOOLS,
            "Developer tools detected open"
          );
        }
      }, 1000);
    }
  }

  private removeEventListeners(): void {
    this.listeners.forEach((listener, event) => {
      if (event === "blur" || event === "resize") {
        window.removeEventListener(event, listener);
      } else {
        document.removeEventListener(event, listener);
      }
    });
    this.listeners.clear();
  }

  private getShortcutString(e: KeyboardEvent): string {
    const parts = [];
    if (e.ctrlKey) parts.push("Ctrl");
    if (e.shiftKey) parts.push("Shift");
    if (e.altKey) parts.push("Alt");
    if (e.metaKey) parts.push("Meta");
    parts.push(e.key);
    return parts.join("+");
  }

  private isDevToolsOpen(): boolean {
    // Multiple detection methods
    const threshold = 160;
    const widthThreshold = window.outerWidth - window.innerWidth > threshold;
    const heightThreshold = window.outerHeight - window.innerHeight > threshold;

    // Firefox specific
    const firefoxDetection = window.outerHeight - window.innerHeight > 150;

    return widthThreshold || heightThreshold || firefoxDetection;
  }

  async enterFullscreen(element?: HTMLElement): Promise<void> {
    const targetElement =
      element || this.fullscreenElement || document.documentElement;

    console.log("enterFullscreen called with:", targetElement);
    console.log("Current fullscreen element:", document.fullscreenElement);

    try {
      if (targetElement.requestFullscreen) {
        console.log("Using standard requestFullscreen");
        await targetElement.requestFullscreen();
      } else if ((targetElement as any).webkitRequestFullscreen) {
        console.log("Using webkit requestFullscreen");
        await (targetElement as any).webkitRequestFullscreen();
      } else if ((targetElement as any).msRequestFullscreen) {
        console.log("Using ms requestFullscreen");
        await (targetElement as any).msRequestFullscreen();
      } else {
        console.log("No fullscreen method available");
      }
      this.state.isFullscreen = true;
    } catch (error) {
      console.error("Failed to enter fullscreen:", error);
    }
  }

  private recordViolation(type: ViolationType, details?: string): void {
    if (this.state.isTerminated) return;

    const violation: Violation = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      timestamp: Date.now(),
      details,
      severity: this.getViolationSeverity(type),
    };

    // Update state
    this.state.violations.push(violation);
    this.state.violationCounts[type] =
      (this.state.violationCounts[type] || 0) + 1;
    this.state.totalViolations++;

    // Update warning level
    this.updateWarningLevel();

    // Notify callbacks
    this.violationCallbacks.forEach((cb) => cb(violation));

    // Check for termination
    if (this.shouldTerminate()) {
      this.terminate();
    }

    console.log(`Violation recorded: ${type} - ${details}`);
  }

  private getViolationSeverity(type: ViolationType): "low" | "medium" | "high" {
    switch (type) {
      case ViolationType.DEV_TOOLS:
        return "high";
      case ViolationType.FULLSCREEN_EXIT:
      case ViolationType.TAB_SWITCH:
        return "medium";
      default:
        return "low";
    }
  }

  private updateWarningLevel(): void {
    const { totalViolations } = this.state;
    const { warningThresholds } = this.config;

    if (totalViolations >= warningThresholds.high) {
      this.state.warningLevel = "high";
    } else if (totalViolations >= warningThresholds.medium) {
      this.state.warningLevel = "medium";
    } else if (totalViolations >= warningThresholds.low) {
      this.state.warningLevel = "low";
    } else {
      this.state.warningLevel = "none";
    }
  }

  private shouldTerminate(): boolean {
    if (!this.config.autoTerminateOnMaxViolations) return false;

    // Check total violations
    if (this.state.totalViolations >= this.config.maxViolations) {
      return true;
    }

    // Check specific violation thresholds
    for (const [type, count] of Object.entries(this.state.violationCounts)) {
      const threshold = this.config.violationThresholds[type as ViolationType];
      if (threshold && count >= threshold) {
        return true;
      }
    }

    return false;
  }

  private terminate(): void {
    this.state.isTerminated = true;
    this.terminationCallbacks.forEach((cb) => cb(this.state.violations));
    this.stopMonitoring();
  }

  getState(): BrowserProctoringState {
    return { ...this.state };
  }

  getViolations(): Violation[] {
    return [...this.state.violations];
  }

  clearViolations(): void {
    this.state.violations = [];
    this.state.violationCounts = {};
    this.state.totalViolations = 0;
    this.state.warningLevel = "none";
    this.state.isTerminated = false;
  }

  captureScreenshot(
    canvas: HTMLCanvasElement,
    video: HTMLVideoElement
  ): string | null {
    if (!canvas || !video) return null;

    const context = canvas.getContext("2d");
    if (!context) return null;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0);

    return canvas.toDataURL("image/jpeg", 0.8);
  }
}
