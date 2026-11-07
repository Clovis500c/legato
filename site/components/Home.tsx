import { figuresOf, GITHUB, linked, numbered, PRIVACY, type Copy } from './content'
import { COPIES } from './copies'
import { CopyProvider } from './copy'
import { Header } from './Header'
import { rootOf } from './langs'
import { Block, Faq, Features, Rows, Split, Steps, Why } from './Sections'
import { Story } from './Story'

const footerLink = 'hover:text-ink hover:underline'

/** The website, in one language: what the README and the user docs used to say, on one page (docs/ keeps the developer side). */
export function Home({ c }: { c: Copy }) {
  const root = rootOf(c.lang)
  return (
    <CopyProvider c={numbered(c)} langs={Object.keys(COPIES)}>
      <Header />
      <main id="main">
        <Story />
        <Split id="fixes" title={c.fixes.title} intro={c.fixes.intro}>
          <Rows head={c.fixes.head} rows={c.fixes.rows} />
        </Split>
        <Block id="why" title={c.why.title} intro={c.why.intro}>
          <Why figures={figuresOf(c)} />
        </Block>
        <Block id="features" title={c.features.title} intro={c.features.intro}>
          <Features />
        </Block>
        <Split id="playback" title={c.playback.title} intro={c.playback.intro}>
          <Rows head={c.playback.head} rows={c.playback.rows} />
        </Split>
        <Split
          id="privacy"
          title={c.privacy.title}
          intro={
            <>
              {c.privacy.intro}
              {c.privacy.english && <span className="mt-3 block text-ink-3">{c.privacy.english}</span>}
            </>
          }
        >
          <Rows head={c.privacy.head} rows={PRIVACY} />
          <Rows caption={c.privacy.services} rows={c.privacy.rows} />
        </Split>
        <Block id="start" title={c.start.title} intro={c.start.intro}>
          <Steps steps={c.start.steps} />
        </Block>
        <Split id="next" title={c.next.title} intro={linked(c.next.intro, `${GITHUB}/issues/new?template=feature.yml`)}>
          <Rows head={c.next.head} rows={c.next.rows} />
        </Split>
        <Split id="faq" title={c.faq.title} intro={linked(c.faq.intro, `${GITHUB}/issues`)}>
          <Faq />
        </Split>
      </main>
      <footer className="border-t border-line-soft text-[13px] text-ink-3">
        <div className="mx-auto flex max-w-[1440px] flex-wrap justify-between gap-x-8 gap-y-3 px-(--pad) pt-7 pb-10">
          <p>{linked(c.footer.code, GITHUB, footerLink)}</p>
          <p className="flex flex-wrap gap-x-5 gap-y-2">
            {[
              [c.footer.releases, `${GITHUB}/releases`],
              [c.footer.docs, `${GITHUB}/tree/master/docs`],
              [c.footer.license, `${GITHUB}/blob/master/LICENSE`],
              [c.footer.notices, `${root}third-party-licenses.txt`],
              [c.footer.font, `${root}roboto-LICENSE.txt`],
            ].map(([label, href]) => (
              <a key={href} href={href} className={footerLink}>
                {label}
              </a>
            ))}
          </p>
          <p>{c.footer.marks}</p>
        </div>
      </footer>
    </CopyProvider>
  )
}
