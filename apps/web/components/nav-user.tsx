'use client'

import { ChevronsUpDownIcon, LogOutIcon, ShieldIcon, UserIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { ThemeChoices } from '@/components/theme-choices'
import { authClient } from '@/lib/auth-client'
import { getInitials } from '@/lib/initials'

export interface NavUserData {
  name: string
  email: string
  image?: string | null
}

function UserSummary({ user }: { user: NavUserData }) {
  return (
    <>
      <Avatar>
        {user.image && <AvatarImage src={user.image} alt="" />}
        <AvatarFallback>{getInitials(user.name, user.email)}</AvatarFallback>
      </Avatar>
      <span className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium">{user.name}</span>
        <span className="truncate text-xs text-muted-foreground">{user.email}</span>
      </span>
    </>
  )
}

/**
 * The signed-in user, the row at the foot of the sidebar: their picture or initials, and a menu
 * with theme and sign out.
 */
export function NavUser({ user, isAdmin = false }: { user: NavUserData; isAdmin?: boolean }) {
  const { isMobile } = useSidebar()
  const t = useTranslations('Common')
  const router = useRouter()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<SidebarMenuButton size="lg" className="data-popup-open:bg-sidebar-accent" />}
          >
            <UserSummary user={user} />
            <ChevronsUpDownIcon className="ml-auto text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-56"
            align="start"
            side={isMobile ? 'top' : 'right'}
            sideOffset={8}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex items-center gap-2 p-1.5 font-normal text-foreground">
                <UserSummary user={user} />
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <ThemeChoices />
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem render={<Link href="/account" />}>
                <UserIcon />
                {t('account')}
              </DropdownMenuItem>
              {isAdmin && (
                <DropdownMenuItem render={<Link href="/system" />}>
                  <ShieldIcon />
                  {t('administration')}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={async () => {
                  await authClient.signOut()
                  router.push('/login')
                  router.refresh()
                }}
              >
                <LogOutIcon />
                {t('signOut')}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
