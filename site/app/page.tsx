import { FIXES, GITHUB, PLAYBACK, PRIVACY, ROADMAP, SERVICES, STEPS } from '@/components/content'
import { Header } from '@/components/Header'
import { Block, Faq, Features, Rows, Split, Steps, Why } from '@/components/Sections'
import { Story } from '@/components/Story'

/** The website: what the README and the user docs used to say, on one page (docs/ keeps the developer side). */
export default function Home() {
  return (
    <>
      <Header />
      <main id="main">
        <Story />
        <Split id="fixes" title="What listeners keep asking the big apps for" intro="Collected from Spotify's community forum, YouTube Music reviews and press coverage of their redesigns. Each line is something Legato does today.">
          <Rows head={['The complaint', 'In Legato']} rows={FIXES} />
        </Split>
        <Block id="why" title="Why Legato" intro="Four things you can check for yourself.">
          <Why />
        </Block>
        <Block id="features" title="Also in the app" intro="The rest, in a line each.">
          <Features />
        </Block>
        <Split id="playback" title="Official playback only" intro="Each service plays in its own player, your files in the app's. No platform's audio is downloaded, recorded or extracted (the Music Detector listens only when you ask it to); the sound features work on what plays, as it plays, in memory.">
          <Rows head={['Source', 'How it plays']} rows={PLAYBACK} />
        </Split>
        <Split id="privacy" title="What leaves your PC" intro="Nothing, until you connect a service or turn a feature on. No server, no account of ours.">
          <Rows head={['What', 'Where it goes']} rows={PRIVACY} />
          <Rows caption="Connecting services" rows={SERVICES} />
        </Split>
        <Block id="start" title="Get started" intro="About a minute, then your music is in one place.">
          <Steps steps={STEPS} />
        </Block>
        <Split
          id="next"
          title="What's next"
          intro={
            <>
              In this order, one release each, on the Beta channel first. No dates: each comes when it's ready. Missing something?{' '}
              <a href={`${GITHUB}/issues/new?template=feature.yml`} className="text-ink underline decoration-line underline-offset-4 hover:decoration-ink">
                Suggest it
              </a>
              .
            </>
          }
        >
          <Rows head={['Coming', 'What it brings']} rows={ROADMAP} />
        </Split>
        <Split
          id="faq"
          title="Questions"
          intro={
            <>
              Something else? Ask in the{' '}
              <a href={`${GITHUB}/issues`} className="text-ink underline decoration-line underline-offset-4 hover:decoration-ink">
                GitHub issues
              </a>
              .
            </>
          }
        >
          <Faq />
        </Split>
      </main>
      <footer className="border-t border-line-soft text-[13px] text-ink-3">
        <div className="mx-auto flex max-w-[1440px] flex-wrap justify-between gap-x-8 gap-y-3 px-(--pad) pt-7 pb-10">
          <p>
            Source-available. Free to use. Code on{' '}
            <a href={GITHUB} className="hover:text-ink hover:underline">
              GitHub
            </a>
            .
          </p>
          <p className="flex flex-wrap gap-x-5 gap-y-2">
            {[
              ['Releases', `${GITHUB}/releases`],
              ['Docs for developers', `${GITHUB}/tree/master/docs`],
              ['License', `${GITHUB}/blob/master/LICENSE`],
              ['Third-party licenses', 'third-party-licenses.txt'],
              ['Font license', 'roboto-LICENSE.txt'],
            ].map(([label, href]) => (
              <a key={label} href={href} className="hover:text-ink hover:underline">
                {label}
              </a>
            ))}
          </p>
          <p>Spotify, YouTube and Apple Music are trademarks of their owners.</p>
        </div>
      </footer>
    </>
  )
}
