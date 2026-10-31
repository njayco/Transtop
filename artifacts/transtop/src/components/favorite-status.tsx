import { Link } from "wouter";
import type { ReactNode } from "react";
import type { FavoriteAvailability } from "@workspace/api-client-react";

export function FavoriteLink({ unavailable, children, ...props }: {
  unavailable: boolean; children: ReactNode; href: string; className: string; "data-testid": string;
}) {
  return unavailable
    ? <div className={props.className}>{children}</div>
    : <Link {...props}>{children}</Link>;
}

export function FavoriteStatus({ result, savedName, online, pending }: {
  result?: FavoriteAvailability; savedName: string; online: boolean; pending: boolean;
}) {
  const unavailable = result?.status === "unavailable" && online;
  const renamed = online && result?.status === "available" && result.currentName && result.currentName !== savedName;
  return (
    <div className="w-full border-t border-border px-4 py-3 text-xs text-muted-foreground" role="status">
      {!online ? "Availability not checked while offline. Your saved item is kept."
        : !result ? pending ? "Checking source availability…" : "Could not check availability. Your saved item is kept; try again later."
        : <>
          <p className={result.status !== "available" ? "font-semibold text-[hsl(var(--warn))]" : ""}>
            {unavailable ? "Unavailable in this source" : result.status === "unknown" ? "Availability could not be verified" : renamed ? `Now listed as ${result.currentName}` : "Listed in source"}
          </p>
          <p className="mt-1">{result.message}</p>
          <p className="mt-1">Checked {new Date(result.checkedAt).toLocaleString()}</p>
          {unavailable && <p className="mt-1">Keep it saved or use the remove button. No replacement has been selected.</p>}
        </>}
    </div>
  );
}
