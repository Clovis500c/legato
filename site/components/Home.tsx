import { figuresOf, GITHUB, linked, numbered, PRIVACY, type Copy } from './content'
import { COPIES } from './copies'
import { CopyProvider } from './copy'
import { Footer } from './Footer'
import { Header } from './Header'
import { Block, Community, Faq, Features, Fixes, Next, Privacy, Sources, Start, Why } from './Sections'
import { Story } from './Story'

/** The website, in one language: the scroll story with the real interface, then what it fixes, why, the rest, privacy. */
export function Home({ c }: { c: Copy }) {
  return (
    <CopyProvider c={numbered(c)} langs={Object.keys(COPIES)}>
      <Header />
      <main id="main">
        <Story />
        <Block id="fixes" eyebrow={c.nav.fixes} title={c.fixes.title} intro={c.fixes.intro} wide>
          <Fixes />
        </Block>
        <Block id="why" eyebrow={c.nav.why} title={c.why.title} intro={c.why.intro} wide>
          <Why figures={figuresOf(c)} />
        </Block>
        <Block id="features" eyebrow={c.nav.features} title={c.features.title} intro={c.features.intro} wide>
          <Features />
        </Block>
        <Block id="playback" title={c.playback.title} intro={c.playback.intro} wide>
          <Sources />
        </Block>
        <Block id="privacy" eyebrow={c.nav.privacy} title={c.privacy.title} intro={c.privacy.intro} wide>
          <Privacy rows={PRIVACY} english={c.privacy.english} />
        </Block>
        <Block id="start" title={c.start.title} intro={c.start.intro}>
          <Start />
        </Block>
        <Block id="next" eyebrow={c.nav.next} title={c.next.title} intro={linked(c.next.intro, `${GITHUB}/issues/new?template=feature.yml`)} wide>
          <Next />
        </Block>
        <Block id="faq" eyebrow={c.nav.faq} title={c.faq.title} intro={linked(c.faq.intro, `${GITHUB}/issues`)}>
          <Faq />
        </Block>
        <Community />
      </main>
      <Footer />
    </CopyProvider>
  )
}
