import * as React from "react";

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  // Read on the first render, not only in the effect: answering "desktop" until
  // the effect ran painted the tickets filter bar's desktop layout on a phone
  // for a frame before swapping it for the phone one (#402).
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(() =>
    typeof window === "undefined"
      ? undefined
      : window.innerWidth < MOBILE_BREAKPOINT,
  );

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}
