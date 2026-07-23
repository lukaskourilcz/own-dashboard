"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ConfirmationOptions = {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
};

type Confirm = (options: ConfirmationOptions) => Promise<boolean>;

const ConfirmationContext = createContext<Confirm | null>(null);

export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmationOptions | null>(null);
  const resolver = useRef<((confirmed: boolean) => void) | null>(null);

  const finish = useCallback((confirmed: boolean) => {
    resolver.current?.(confirmed);
    resolver.current = null;
    setOptions(null);
  }, []);

  const confirm = useCallback<Confirm>((next) => {
    resolver.current?.(false);
    setOptions(next);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  return (
    <ConfirmationContext.Provider value={confirm}>
      {children}
      <Dialog open={options !== null} onOpenChange={(open) => !open && finish(false)}>
        <DialogContent className="confirmation-dialog max-w-md">
          {options && (
            <>
              <DialogHeader>
                <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-md border border-destructive/25 bg-destructive/10 text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                </div>
                <DialogTitle>{options.title}</DialogTitle>
                <DialogDescription>{options.description}</DialogDescription>
              </DialogHeader>
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="outline" onClick={() => finish(false)}>
                  {options.cancelLabel}
                </Button>
                <Button
                  variant={options.destructive ? "destructive" : "default"}
                  onClick={() => finish(true)}
                >
                  {options.confirmLabel}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </ConfirmationContext.Provider>
  );
}

export function useConfirmation(): Confirm {
  const confirm = useContext(ConfirmationContext);
  if (!confirm) {
    throw new Error("useConfirmation must be used within ConfirmationProvider");
  }
  return confirm;
}
