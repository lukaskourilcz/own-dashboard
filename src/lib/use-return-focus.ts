"use client";

import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * Focus return for a controlled dialog that has no Radix `DialogTrigger`.
 * The element focused when the dialog opens (the button that opened it) is
 * recorded in a layout effect — before the dialog moves focus inside — and
 * refocused on close. Pass the result to `DialogContent.onCloseAutoFocus`.
 */
export function useReturnFocus(open: boolean): (event: Event) => void {
  const returnTo = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open && typeof document !== "undefined") {
      returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
  }, [open]);
  return useCallback((event: Event) => {
    const target = returnTo.current;
    if (target?.isConnected) {
      event.preventDefault();
      target.focus();
    }
    returnTo.current = null;
  }, []);
}
