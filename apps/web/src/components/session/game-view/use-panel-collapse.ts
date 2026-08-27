import { useEffect, useRef, useState } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";

export interface PanelCollapseControls {
  /** Ref to attach to the left ResizablePanel on wide layouts. */
  leftPanelRef: React.RefObject<PanelImperativeHandle | null>;
  /** Ref to attach to the right ResizablePanel on wide layouts. */
  rightPanelRef: React.RefObject<PanelImperativeHandle | null>;
  /** Live collapsed state of the left panel/drawer. */
  isLeftCollapsed: boolean;
  /** Live collapsed state of the right panel/drawer. */
  isRightCollapsed: boolean;
  /** Sync handler for the left panel's `onResize`. */
  handleLeftResize: () => void;
  /** Sync handler for the right panel's `onResize`. */
  handleRightResize: () => void;
  /** Toggle the left panel or mobile drawer. */
  toggleLeftPanel: () => void;
  /** Toggle the right panel or mobile drawer. */
  toggleRightPanel: () => void;
}

/**
 * Owns the collapse state of the story/context rails.
 *
 * Wide layouts use the resizable-panels imperative API. Mobile layouts do not
 * put either rail in the vertical panel group: the same booleans drive
 * overlay drawers, so opening a rail never compresses the story into a tiny
 * strip or lets its scroll content paint over the next panel.
 */
export function usePanelCollapse(
  isMobile: boolean,
  isTablet: boolean,
): PanelCollapseControls {
  const leftPanelRef = useRef<PanelImperativeHandle>(null);
  const rightPanelRef = useRef<PanelImperativeHandle>(null);
  // The left rail is collapsed by default on wide layouts. Both mobile
  // drawers start closed; the initializer also avoids a first-frame flash
  // when the media query is already known at mount time.
  const [isLeftCollapsed, setIsLeftCollapsed] = useState(true);
  const [isRightCollapsed, setIsRightCollapsed] = useState(
    () => isMobile || isTablet,
  );

  const isLeftCollapsedRef = useRef(isLeftCollapsed);
  const isRightCollapsedRef = useRef(isRightCollapsed);
  isLeftCollapsedRef.current = isLeftCollapsed;
  isRightCollapsedRef.current = isRightCollapsed;

  useEffect(() => {
    const left = leftPanelRef.current;
    const right = rightPanelRef.current;

    if (isMobile || isTablet) {
      // Tablet still mounts resizable panels; mobile mounts drawers instead.
      // Collapse any panels left behind by a breakpoint transition and reset
      // the drawer state so a desktop layout cannot leak into mobile.
      if (left && !left.isCollapsed()) left.collapse();
      if (right && !right.isCollapsed()) right.collapse();
      setIsLeftCollapsed(true);
      setIsRightCollapsed(true);
      return;
    }

    // A persisted desktop layout may restore either rail open. Synchronize
    // the header buttons after the panel group has measured itself.
    if (left) setIsLeftCollapsed(left.isCollapsed());
    if (right) setIsRightCollapsed(right.isCollapsed());
  }, [isMobile, isTablet]);

  const handleLeftResize = () => {
    const panel = leftPanelRef.current;
    if (panel) setIsLeftCollapsed(panel.isCollapsed());
  };
  const handleRightResize = () => {
    const panel = rightPanelRef.current;
    if (panel) setIsRightCollapsed(panel.isCollapsed());
  };

  const toggleLeftPanel = () => {
    if (isMobile) {
      // Drawers are mutually exclusive; the active surface owns the viewport.
      setIsRightCollapsed(true);
      setIsLeftCollapsed(!isLeftCollapsedRef.current);
      return;
    }
    const panel = leftPanelRef.current;
    if (panel) {
      if (isLeftCollapsedRef.current) panel.expand();
      else panel.collapse();
    }
  };

  const toggleRightPanel = () => {
    if (isMobile) {
      setIsLeftCollapsed(true);
      setIsRightCollapsed(!isRightCollapsedRef.current);
      return;
    }
    const panel = rightPanelRef.current;
    if (panel) {
      if (isRightCollapsedRef.current) panel.expand();
      else panel.collapse();
    }
  };

  return {
    leftPanelRef,
    rightPanelRef,
    isLeftCollapsed,
    isRightCollapsed,
    handleLeftResize,
    handleRightResize,
    toggleLeftPanel,
    toggleRightPanel,
  };
}
