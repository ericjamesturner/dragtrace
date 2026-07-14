import { createContext, useContext, useState, useCallback, useEffect, lazy, Suspense } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import type { Id } from "../../convex/_generated/dataModel";
import { VehicleSidebar } from "./VehicleSidebar";
import { EventList } from "./EventList";
import { FileList } from "./FileList";
import { ChannelManager } from "./ChannelManager";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { MenuIcon, LogOutIcon, SettingsIcon } from "lucide-react";
import { Tip } from "@/components/ui/tooltip";
import { AdminMenu } from "./AdminControls";

const LogViewer = lazy(() => import("./LogViewer"));

type NavState =
  | { view: "vehicles" }
  | { view: "events"; vehicleId: Id<"vehicles"> }
  | { view: "files"; vehicleId: Id<"vehicles">; eventId: Id<"events"> }
  | { view: "viewer"; vehicleId: Id<"vehicles">; eventId: Id<"events">; fileIds: Id<"files">[] }
  | { view: "channel-manager" };

interface NavContextValue {
  nav: NavState;
  goToVehicles: () => void;
  goToEvents: (vehicleId: Id<"vehicles">) => void;
  goToFiles: (vehicleId: Id<"vehicles">, eventId: Id<"events">) => void;
  goToViewer: (vehicleId: Id<"vehicles">, eventId: Id<"events">, fileIds: Id<"files">[]) => void;
  goToChannelManager: () => void;
}

const NavContext = createContext<NavContextValue | null>(null);

export function useNav() {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error("useNav must be used within Layout");
  return ctx;
}

function parseNavFromUrl(): NavState {
  const params = new URLSearchParams(window.location.search);
  if (params.has("channels")) {
    return { view: "channel-manager" };
  }
  const vehicleId = params.get("vehicle");
  const eventId = params.get("event");
  const viewer = params.get("viewer");
  if (vehicleId && eventId && viewer) {
    const fileIds = viewer.split(",").filter(Boolean) as Id<"files">[];
    if (fileIds.length > 0) {
      return {
        view: "viewer",
        vehicleId: vehicleId as Id<"vehicles">,
        eventId: eventId as Id<"events">,
        fileIds,
      };
    }
  }
  if (vehicleId && eventId) {
    return {
      view: "files",
      vehicleId: vehicleId as Id<"vehicles">,
      eventId: eventId as Id<"events">,
    };
  }
  if (vehicleId) {
    return { view: "events", vehicleId: vehicleId as Id<"vehicles"> };
  }
  return { view: "vehicles" };
}

function navToUrl(nav: NavState): string {
  const params = new URLSearchParams();
  if (nav.view === "channel-manager") {
    params.set("channels", "");
    return `?${params.toString()}`;
  }
  if (nav.view === "events" || nav.view === "files" || nav.view === "viewer") {
    params.set("vehicle", nav.vehicleId);
  }
  if (nav.view === "files" || nav.view === "viewer") {
    params.set("event", nav.eventId);
  }
  if (nav.view === "viewer") {
    params.set("viewer", nav.fileIds.join(","));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : window.location.pathname;
}

export function Layout() {
  const { signOut } = useAuthActions();
  const [nav, setNav] = useState<NavState>(parseNavFromUrl);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Sync nav state to URL
  useEffect(() => {
    const url = navToUrl(nav);
    if (url !== `${window.location.pathname}${window.location.search}`) {
      window.history.pushState(null, "", url);
    }
  }, [nav]);

  // Handle browser back/forward
  useEffect(() => {
    const handlePopState = () => setNav(parseNavFromUrl());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const goToVehicles = useCallback(() => setNav({ view: "vehicles" }), []);
  const goToEvents = useCallback(
    (vehicleId: Id<"vehicles">) => setNav({ view: "events", vehicleId }),
    []
  );
  const goToFiles = useCallback(
    (vehicleId: Id<"vehicles">, eventId: Id<"events">) =>
      setNav({ view: "files", vehicleId, eventId }),
    []
  );
  const goToViewer = useCallback(
    (vehicleId: Id<"vehicles">, eventId: Id<"events">, fileIds: Id<"files">[]) =>
      setNav({ view: "viewer", vehicleId, eventId, fileIds }),
    []
  );
  const goToChannelManager = useCallback(() => setNav({ view: "channel-manager" }), []);

  const contextValue: NavContextValue = {
    nav,
    goToVehicles,
    goToEvents,
    goToFiles,
    goToViewer,
    goToChannelManager,
  };

  const sidebarContent = <VehicleSidebar onSelect={() => setMobileOpen(false)} />;

  // Channel Manager takes over the full screen
  if (nav.view === "channel-manager") {
    return (
      <NavContext value={contextValue}>
        <ChannelManager />
      </NavContext>
    );
  }

  // Viewer takes over the full screen — no app sidebar
  if (nav.view === "viewer") {
    return (
      <NavContext value={contextValue}>
        <Suspense fallback={<div className="flex h-screen items-center justify-center text-muted-foreground">Loading viewer...</div>}>
          <LogViewer
            vehicleId={nav.vehicleId}
            eventId={nav.eventId}
            fileIds={nav.fileIds}
          />
        </Suspense>
      </NavContext>
    );
  }

  return (
    <NavContext value={contextValue}>
      <div className="flex h-screen">
        {/* Desktop sidebar */}
        <aside className="hidden w-64 shrink-0 border-r bg-muted/30 md:flex md:flex-col">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h1 className="text-sm font-semibold tracking-tight">DragTrace</h1>
            <div className="flex items-center gap-1">
              <AdminMenu />
              <Tip content="Channel Manager">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={goToChannelManager}
                >
                  <SettingsIcon />
                </Button>
              </Tip>
              <Tip content="Sign out">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => void signOut()}
                >
                  <LogOutIcon />
                </Button>
              </Tip>
            </div>
          </div>
          <div className="flex-1 overflow-hidden">
            {sidebarContent}
          </div>
        </aside>

        {/* Mobile header + sheet sidebar */}
        <div className="flex flex-1 flex-col overflow-hidden md:hidden">
          <header className="flex items-center gap-2 border-b px-4 py-3">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger render={<Button variant="ghost" size="icon-sm" />}>
                <MenuIcon />
              </SheetTrigger>
              <SheetContent side="left" className="w-64 p-0">
                <div className="border-b px-4 py-3">
                  <h1 className="text-sm font-semibold tracking-tight">
                    DragTrace
                  </h1>
                </div>
                {sidebarContent}
              </SheetContent>
            </Sheet>
            <h1 className="text-sm font-semibold tracking-tight">DragTrace</h1>
            <div className="ml-auto flex items-center gap-1">
              <AdminMenu />
              <Tip content="Sign out">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => void signOut()}
                >
                  <LogOutIcon />
                </Button>
              </Tip>
            </div>
          </header>
          <main className="flex-1 overflow-auto">
            <ContentArea />
          </main>
        </div>

        {/* Desktop content */}
        <main className="hidden flex-1 overflow-auto md:block">
          <ContentArea />
        </main>
      </div>
    </NavContext>
  );
}

function ContentArea() {
  const { nav } = useNav();

  switch (nav.view) {
    case "vehicles":
      return (
        <div className="flex h-full items-center justify-center text-muted-foreground">
          <p>Select a vehicle from the sidebar</p>
        </div>
      );
    case "events":
      return <EventList vehicleId={nav.vehicleId} />;
    case "files":
      return <FileList vehicleId={nav.vehicleId} eventId={nav.eventId} />;
    case "channel-manager":
      return null; // Handled above as full-screen view
  }
}
