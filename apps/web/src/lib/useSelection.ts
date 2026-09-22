import { useCallback, useMemo, useRef, useState } from "react";

/**
 * A multi-select over an ordered list of ids.
 *
 * The order matters and is the list's own: an action applied to a selection should hit the
 * rows in the sequence the owner read them, and "which rows are chosen" has to answer in the
 * same order for the count beside the checkbox to mean what it says.
 */
export interface Selection {
  has: (id: string) => boolean;
  /** Chosen ids, in list order rather than click order. */
  ids: string[];
  count: number;
  allSelected: boolean;
  /** A shift-click extends from the last plain click instead of replacing the selection. */
  toggle: (id: string, shift?: boolean) => void;
  toggleAll: () => void;
  clear: () => void;
}

export function useSelection(orderedIds: string[]): Selection {
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  // The row a shift-click counts *from*, not the most recent row touched: dragging a range
  // out and then back should shrink it, the way a file manager's does.
  const anchor = useRef<string | null>(null);

  const position = useCallback((id: string) => orderedIds.indexOf(id), [orderedIds]);

  const toggle = useCallback(
    (id: string, shift = false) => {
      setPicked((prev) => {
        const next = new Set(prev);
        const from = anchor.current === null ? -1 : position(anchor.current);
        const to = position(id);
        if (shift && from >= 0 && to >= 0) {
          const [lo, hi] = from < to ? [from, to] : [to, from];
          for (let i = lo; i <= hi; i++) {
            const row = orderedIds[i];
            if (row) next.add(row);
          }
          return next;
        }
        if (next.has(id)) next.delete(id);
        else next.add(id);
        anchor.current = id;
        return next;
      });
    },
    [orderedIds, position],
  );

  const clear = useCallback(() => {
    setPicked(new Set());
    anchor.current = null;
  }, []);

  const ids = useMemo(() => orderedIds.filter((id) => picked.has(id)), [orderedIds, picked]);
  const allSelected = orderedIds.length > 0 && ids.length === orderedIds.length;

  const toggleAll = useCallback(() => {
    setPicked(allSelected ? new Set() : new Set(orderedIds));
    anchor.current = null;
  }, [allSelected, orderedIds]);

  return {
    has: useCallback((id: string) => picked.has(id), [picked]),
    ids,
    count: ids.length,
    allSelected,
    toggle,
    toggleAll,
    clear,
  };
}
