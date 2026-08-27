import { useEffect, useRef } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { onNavEvent, type NavEvent } from "@/lib/nav-events.js";

export interface NavTabActivationOptions {
  /** Ref to the right panel so it can be expanded before activating a tab. */
  rightPanelRef: React.RefObject<PanelImperativeHandle | null>;
  /** Open the plugin settings surface (topbar "open-plugins" event). */
  onOpenPlugins: () => void;
  /** Open a mobile context surface instead of resizing a desktop rail. */
  onOpenContext?: (event: NavEvent) => void;
}

/**
 * Bridges global topbar navigation events to in-page panel actions.
 *
 * The global topbar dispatches via nav-events because it cannot reach this
 * component's local state directly. `open-plugins` opens the plugin settings;
 * `open-images` / `open-database` open the context surface — the RightPanel
 * subscribes to the same events and switches its controlled tab itself.
 */
export function useNavTabActivation({
  rightPanelRef,
  onOpenPlugins,
  onOpenContext,
}: NavTabActivationOptions): void {
  const onOpenPluginsRef = useRef(onOpenPlugins);
  const onOpenContextRef = useRef(onOpenContext);
  onOpenPluginsRef.current = onOpenPlugins;
  onOpenContextRef.current = onOpenContext;

  useEffect(() => {
    return onNavEvent((event) => {
      if (event === "open-plugins") {
        onOpenPluginsRef.current();
        return;
      }
      const openContext = onOpenContextRef.current;
      if (openContext) {
        openContext(event);
        return;
      }
      const panel = rightPanelRef.current;
      if (panel && panel.isCollapsed()) panel.expand();
    });
  }, [rightPanelRef]);
}
