import { create } from "zustand";

interface InterfaceState {
  importPanelOpen: boolean;
  selectedTrackId: string | null;
  setImportPanelOpen: (open: boolean) => void;
  setSelectedTrackId: (id: string | null) => void;
}

export const useInterfaceStore = create<InterfaceState>((set) => ({
  importPanelOpen: false,
  selectedTrackId: null,
  setImportPanelOpen: (importPanelOpen) => set({ importPanelOpen }),
  setSelectedTrackId: (selectedTrackId) => set({ selectedTrackId })
}));
