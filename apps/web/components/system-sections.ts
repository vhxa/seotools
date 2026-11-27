import {
  ActivityIcon,
  ArrowUpCircleIcon,
  BuildingIcon,
  GaugeIcon,
  MailIcon,
  PlugIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react'

/** The sections of Administration, listed in the sidebar. Each one is a route under `/system`. */
export const SYSTEM_SECTIONS: readonly {
  id: 'status' | 'companies' | 'users' | 'email' | 'updates' | 'integrations' | 'capacity'
  href: string
  icon: LucideIcon
  /** Active only on this exact path, not on its sub-pages. */
  exact?: boolean
}[] = [
  { id: 'status', href: '/system', icon: ActivityIcon, exact: true },
  { id: 'capacity', href: '/system/capacity', icon: GaugeIcon },
  { id: 'companies', href: '/system/companies', icon: BuildingIcon },
  { id: 'users', href: '/system/users', icon: UsersIcon },
  { id: 'email', href: '/system/email', icon: MailIcon },
  { id: 'integrations', href: '/system/integrations', icon: PlugIcon },
  { id: 'updates', href: '/system/updates', icon: ArrowUpCircleIcon },
]
