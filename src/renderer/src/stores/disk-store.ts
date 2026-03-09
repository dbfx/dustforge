import { create } from 'zustand'
import type { DiskNode, DriveInfo, FileTypeInfo } from '@shared/types'

interface DiskState {
  drives: DriveInfo[]
  selectedDrive: string
  data: DiskNode | null
  analyzing: boolean
  breadcrumb: DiskNode[]
  error: string | null
  fileTypes: FileTypeInfo[]
  fileTypesLoading: boolean

  setDrives: (drives: DriveInfo[]) => void
  setSelectedDrive: (drive: string) => void
  setData: (data: DiskNode | null) => void
  setAnalyzing: (analyzing: boolean) => void
  setBreadcrumb: (breadcrumb: DiskNode[]) => void
  pushBreadcrumb: (node: DiskNode) => void
  sliceBreadcrumb: (toIndex: number) => void
  setError: (error: string | null) => void
  setFileTypes: (fileTypes: FileTypeInfo[]) => void
  setFileTypesLoading: (loading: boolean) => void
  reset: () => void
}

export const useDiskStore = create<DiskState>((set) => ({
  drives: [],
  selectedDrive: 'C',
  data: null,
  analyzing: false,
  breadcrumb: [],
  error: null,
  fileTypes: [],
  fileTypesLoading: false,

  setDrives: (drives) => set({ drives }),
  setSelectedDrive: (selectedDrive) => set({ selectedDrive }),
  setData: (data) => set({ data }),
  setAnalyzing: (analyzing) => set({ analyzing }),
  setBreadcrumb: (breadcrumb) => set({ breadcrumb }),
  pushBreadcrumb: (node) =>
    set((s) => ({ breadcrumb: [...s.breadcrumb, node] })),
  sliceBreadcrumb: (toIndex) =>
    set((s) => ({ breadcrumb: s.breadcrumb.slice(0, toIndex + 1) })),
  setError: (error) => set({ error }),
  setFileTypes: (fileTypes) => set({ fileTypes }),
  setFileTypesLoading: (fileTypesLoading) => set({ fileTypesLoading }),
  reset: () =>
    set({
      data: null,
      analyzing: false,
      breadcrumb: [],
      error: null,
      fileTypes: [],
      fileTypesLoading: false
    })
}))
