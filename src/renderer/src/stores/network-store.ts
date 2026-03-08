import { create } from 'zustand'
import type { NetworkItem, NetworkCleanResult } from '@shared/types'

type NetworkCategory = NetworkItem['type']

interface NetworkState {
  items: NetworkItem[]
  selectedIds: Set<string>
  status: 'idle' | 'scanning' | 'cleaning' | 'complete'
  cleanResult: NetworkCleanResult | null
  activeCategory: NetworkCategory

  setItems: (items: NetworkItem[]) => void
  setSelectedIds: (ids: Set<string>) => void
  setStatus: (status: 'idle' | 'scanning' | 'cleaning' | 'complete') => void
  setCleanResult: (result: NetworkCleanResult | null) => void
  setActiveCategory: (category: NetworkCategory) => void
  toggleItem: (id: string) => void
  toggleCategory: (type: NetworkCategory) => void
  reset: () => void
}

export const useNetworkStore = create<NetworkState>((set) => ({
  items: [],
  selectedIds: new Set<string>(),
  status: 'idle',
  cleanResult: null,
  activeCategory: 'dns-cache',

  setItems: (items) => set({ items }),
  setSelectedIds: (selectedIds) => set({ selectedIds }),
  setStatus: (status) => set({ status }),
  setCleanResult: (cleanResult) => set({ cleanResult }),
  setActiveCategory: (activeCategory) => set({ activeCategory }),
  toggleItem: (id) =>
    set((s) => {
      const next = new Set(s.selectedIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { selectedIds: next }
    }),
  toggleCategory: (type) =>
    set((s) => {
      const catItems = s.items.filter((i) => i.type === type)
      const allSelected = catItems.every((i) => s.selectedIds.has(i.id))
      const next = new Set(s.selectedIds)
      for (const item of catItems) {
        if (allSelected) next.delete(item.id)
        else next.add(item.id)
      }
      return { selectedIds: next }
    }),
  reset: () =>
    set({
      items: [],
      selectedIds: new Set<string>(),
      status: 'idle',
      cleanResult: null
    })
}))
