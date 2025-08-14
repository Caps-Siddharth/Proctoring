import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import apiService from "../service/apiService";

interface TokenState {
  current_stage: number;
  stages: {
    1: string;
    2: string;
    3: string;
  };
  terminated: boolean;
  completed: boolean;
}

interface UseTokenNavigationOptions {
  requiredStage: 1 | 2 | 3;
  onAccessDenied?: () => void;
}

export const useTokenNavigation = (options: UseTokenNavigationOptions) => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const [isLoading, setIsLoading] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);
  const [tokenState, setTokenState] = useState<TokenState | null>(null);

  // ✅ Define this early so token is available
  const navigateToStage = (
    stage: "credentials" | "calibration" | "interview" | "feedback" | "terminated"
  ) => {
    if (!token) return;

    const routes = {
      credentials: `/test/${token}`,  // ✅ Fixed
      calibration: `/test/${token}/calibration`, // ✅ Fixed
      interview: `/test/${token}/interview`, // Already correct
      feedback: `/feedback`,
      terminated: `/test-terminated`,
    };

    navigate(routes[stage], { replace: true });
  };

  // ✅ Access control + redirection logic
  useEffect(() => {
    const checkAccess = async () => {
      if (!token) {
        console.error("No token provided");
        console.error("redirected 1");

        navigate("/", { replace: true });
        return;
      }

      try {
        setIsLoading(true);
        const response = await apiService.checkTokenAccess(token, options.requiredStage);

        if (response.allowed && response.token_state) {
          setHasAccess(true);
          setTokenState(response.token_state);

          if (response.token_state.stages[options.requiredStage] === "incomplete") {
            await apiService.updateTokenStage(token, options.requiredStage, "in_progress");
          }
        } else {
          setHasAccess(false);

          if (response.redirect === "terminated") {
            navigateToStage("terminated");
          } else if (response.redirect === "feedback") {
            navigateToStage("feedback");
          } else if (typeof response.redirect === "number") {
            if (response.redirect === 1) navigateToStage("credentials");
            if (response.redirect === 2) navigateToStage("calibration");
            if (response.redirect === 3) navigateToStage("interview");
          }

          if (options.onAccessDenied) options.onAccessDenied();
        }
      } catch (error) {
        console.error("Error checking token access:", error);
        console.log('redirected 2');
        navigate("/", { replace: true });
      } finally {
        setIsLoading(false);
      }
    };

    checkAccess();
  }, [token, options.requiredStage, navigate]);

  // 🚫 Block back nav and shortcuts
  useEffect(() => {
    if (!hasAccess) return;

    const handlePopState = (event: PopStateEvent) => {
      event.preventDefault();
      window.history.pushState(null, "", window.location.href);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        (event.altKey && event.key === "ArrowLeft") ||
        (event.key === "Backspace" &&
          !["INPUT", "TEXTAREA"].includes((event.target as HTMLElement)?.tagName))
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.history.pushState(null, "", window.location.href);
    window.addEventListener("popstate", handlePopState);
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [hasAccess]);

  const completeCurrentStage = async () => {
    if (!token) return;

    try {
      await apiService.updateTokenStage(token, options.requiredStage, "complete");

      if (options.requiredStage === 1) {
        navigateToStage("calibration");
      } else if (options.requiredStage === 2) {
        navigateToStage("interview");
      } else if (options.requiredStage === 3) {
        navigateToStage("feedback");
      }
    } catch (error) {
      console.error("Error completing stage:", error);
    }
  };

  return {
    isLoading,
    hasAccess,
    tokenState,
    completeCurrentStage,
    navigateToStage, // ✅ now exposed
    token,
  };
};
