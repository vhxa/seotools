'use client'

import { createContext, useContext, type ReactNode } from 'react'

const CanEdit = createContext(true)

/**
 * Says to what is rendered inside a domain whether the person can change anything in it, so that
 * those who only read are not offered what would be refused. It is courtesy, not protection: every
 * action checks for itself (`requireDomainEditor`).
 */
export function DomainAccessProvider({
  canEdit,
  children,
}: {
  canEdit: boolean
  children: ReactNode
}) {
  return <CanEdit.Provider value={canEdit}>{children}</CanEdit.Provider>
}

export const useCanEdit = () => useContext(CanEdit)

/** Renders its children only for those who can change the domain. */
export function EditorsOnly({ children }: { children: ReactNode }) {
  return useCanEdit() ? children : null
}
