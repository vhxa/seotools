import { needsSetup } from '@seotools/db'
import { redirect } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getDb } from '@/lib/db'
import { SetupForm } from './setup-form'

export const metadata = { title: 'Set up · seotools' }
export const dynamic = 'force-dynamic'

export default async function SetupPage() {
  // Setup exists only until the first admin does.
  if (!(await needsSetup(await getDb()))) redirect('/login')

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Welcome to seotools</CardTitle>
          <CardDescription>Create the admin account to get started.</CardDescription>
        </CardHeader>
        <CardContent>
          <SetupForm />
        </CardContent>
      </Card>
    </main>
  )
}
