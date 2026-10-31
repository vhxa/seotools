import { redirect } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getSession } from '@/lib/session'
import { LoginForm } from './login-form'

export const metadata = { title: 'Sign in · seotools' }
export const dynamic = 'force-dynamic'

export default async function LoginPage() {
  if (await getSession()) redirect('/')

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>seotools</CardTitle>
          <CardDescription>Sign in with the admin account.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm />
        </CardContent>
      </Card>
    </main>
  )
}
