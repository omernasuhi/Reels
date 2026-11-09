import * as React from "react";
import { cn } from "@/lib/utils";

type AlertProps = React.ComponentProps<"div"> & { tone?: "info" | "error" };

function Alert({ className, tone = "info", ...props }: AlertProps) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-md border px-4 py-3 text-base",
        tone === "error" ? "border-destructive text-destructive" : "border-border bg-card",
        className,
      )}
      {...props}
    />
  );
}

export { Alert };
