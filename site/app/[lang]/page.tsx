import { COPIES } from '@/components/copies'
import { Home } from '@/components/Home'

export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  return <Home c={COPIES[(await params).lang]} />
}
