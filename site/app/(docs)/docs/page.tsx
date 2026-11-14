import { COPIES } from '@/components/copies'
import { CopyProvider } from '@/components/copy'
import { DocsBody } from '@/components/docs'
import { Footer } from '@/components/Footer'
import { Header } from '@/components/Header'

export default function Page() {
  return (
    <CopyProvider c={COPIES.en} langs={Object.keys(COPIES)}>
      <Header base="../" />
      <DocsBody />
      <Footer base="../" />
    </CopyProvider>
  )
}
