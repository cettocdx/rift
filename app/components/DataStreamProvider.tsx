"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { DataUIPart } from "ai";

// --- State context (changes frequently during streaming) ---
interface DataStreamStateValue {
  dataStream: DataUIPart<any>[];
  isAutoResuming: boolean;
  /**
   * True from the moment a reattach begins until the producer's replay-edge
   * marker arrives. While true, replayed history is painted instantly instead
   * of being animated word by word as if it were being typed right now.
   */
  isReplaying: boolean;
  autoContinueCount: number;
}

// --- Dispatch context (stable references, never causes re-renders) ---
interface DataStreamDispatchValue {
  setDataStream: React.Dispatch<React.SetStateAction<DataUIPart<any>[]>>;
  setIsAutoResuming: React.Dispatch<React.SetStateAction<boolean>>;
  setIsReplaying: React.Dispatch<React.SetStateAction<boolean>>;
  setAutoContinueCount: React.Dispatch<React.SetStateAction<number>>;
}

const DataStreamStateContext = createContext<DataStreamStateValue | null>(null);
const DataStreamDispatchContext = createContext<DataStreamDispatchValue | null>(
  null,
);

export function DataStreamProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [dataStream, setDataStream] = useState<DataUIPart<any>[]>([]);
  const [isAutoResuming, setIsAutoResuming] = useState<boolean>(false);
  const [isReplaying, setIsReplaying] = useState<boolean>(false);
  const [autoContinueCount, setAutoContinueCount] = useState<number>(0);

  const stateValue = useMemo(
    () => ({ dataStream, isAutoResuming, isReplaying, autoContinueCount }),
    [dataStream, isAutoResuming, isReplaying, autoContinueCount],
  );

  const dispatchValue = useMemo(
    () => ({
      setDataStream,
      setIsAutoResuming,
      setIsReplaying,
      setAutoContinueCount,
    }),
    // setState functions from useState are stable — this memo runs once
    [setDataStream, setIsAutoResuming, setIsReplaying, setAutoContinueCount],
  );

  return (
    <DataStreamDispatchContext.Provider value={dispatchValue}>
      <DataStreamStateContext.Provider value={stateValue}>
        {children}
      </DataStreamStateContext.Provider>
    </DataStreamDispatchContext.Provider>
  );
}

/** Subscribe to stream state (dataStream, isAutoResuming, autoContinueCount).
 *  Components using this will re-render on every state change. */
export function useDataStreamState() {
  const context = useContext(DataStreamStateContext);
  if (!context) {
    throw new Error(
      "useDataStreamState must be used within a DataStreamProvider",
    );
  }
  return context;
}

/** Subscribe to dispatch functions only (setDataStream, setIsAutoResuming, setAutoContinueCount).
 *  Components using this will NOT re-render when stream state changes. */
export function useDataStreamDispatch() {
  const context = useContext(DataStreamDispatchContext);
  if (!context) {
    throw new Error(
      "useDataStreamDispatch must be used within a DataStreamProvider",
    );
  }
  return context;
}

/** Legacy hook — returns both state and dispatch. Prefer the split hooks above. */
export function useDataStream() {
  const state = useDataStreamState();
  const dispatch = useDataStreamDispatch();
  return { ...state, ...dispatch };
}
