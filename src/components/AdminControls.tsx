import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { EyeIcon, UserSearchIcon, XIcon } from "lucide-react";

/** Admin-only "view as customer" picker for the sidebar header. */
export function AdminMenu() {
  const state = useQuery(api.admin.state);
  const users = useQuery(api.admin.listUsers, state?.isAdmin ? {} : "skip");
  const impersonate = useMutation(api.admin.impersonate);

  if (!state?.isAdmin) return null;

  const handleSelect = async (userId: Id<"users">) => {
    await impersonate({ userId });
    // Nav state (vehicle/event ids) belongs to the previous user — start fresh
    window.location.assign("/");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" title="View as customer" />}
      >
        <UserSearchIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          <DropdownMenuLabel>View as customer</DropdownMenuLabel>
          {(users ?? []).map((u) => (
            <DropdownMenuItem
              key={u.userId}
              onClick={() => void handleSelect(u.userId)}
            >
              {u.email || u.name || u.userId}
            </DropdownMenuItem>
          ))}
          {users !== undefined && users.length === 0 && (
            <DropdownMenuItem disabled>No other users</DropdownMenuItem>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Floating pill shown on every screen while impersonating a customer. */
export function ImpersonationBanner() {
  const state = useQuery(api.admin.state);
  const stop = useMutation(api.admin.stopImpersonating);

  if (!state?.impersonating) return null;

  const handleStop = async () => {
    await stop();
    window.location.assign("/");
  };

  return (
    // Every corner of the viewer is occupied — the overview bar spans the
    // bottom, the readouts sit above it — so on a touch screen this pill lands
    // on something you need. Impersonating is done from a desk anyway, so it
    // simply isn't there when the pointer is a finger. On a desk it sits in the
    // bottom-right corner, small: it is a status note, not a control.
    <div className="fixed bottom-2 right-2 z-50 pointer-coarse:hidden">
      <div className="flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-950/90 px-2 py-0.5 text-[10px] text-amber-300/90 shadow-lg backdrop-blur">
        <EyeIcon className="size-3" />
        <span>
          Viewing as{" "}
          <span className="font-medium">
            {state.impersonating.email || state.impersonating.name}
          </span>
        </span>
        <button
          onClick={() => void handleStop()}
          className="rounded-full p-0.5 hover:bg-amber-500/20"
          title="Stop impersonating"
        >
          <XIcon className="size-3" />
        </button>
      </div>
    </div>
  );
}
