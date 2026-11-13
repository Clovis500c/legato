import { Books, Disc, GearSix, MagnifyingGlass, Microphone, MusicNotes, Radio, Shuffle, UsersThree } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { useSettings } from '../../app/settings'
import { useStore, type View } from '../../app/store'
import { tr } from '../../shared/i18n/i18n'
import { PageHeader } from '../../shared/ui/PageHeader'

/** The living-room mode's front door (Settings › General › TV home, off by default): a few big tiles, each a page, for a pad or the arrow keys. */
export function TvHome() {
  const go = useStore((s) => s.go)
  const podcasts = useSettings((s) => s.settings.podcasts)
  const books = useSettings((s) => s.settings.booksPage)
  const tiles: [string, ReactNode, View][] = [
    [tr('Search'), <MagnifyingGlass key="s" size={40} />, { name: 'search' }],
    [tr('Songs'), <MusicNotes key="o" size={40} />, { name: 'songs' }],
    [tr('Albums'), <Disc key="a" size={40} />, { name: 'albums' }],
    [tr('Artists'), <UsersThree key="r" size={40} />, { name: 'artists' }],
    [tr('Mixes'), <Shuffle key="m" size={40} />, { name: 'mixes' }],
    [tr('Radio'), <Radio key="d" size={40} />, { name: 'radio' }],
  ]
  if (podcasts) tiles.push([tr('Podcasts'), <Microphone key="p" size={40} />, { name: 'podcasts' }])
  if (books) tiles.push([tr('Audiobooks'), <Books key="b" size={40} />, { name: 'books' }])
  tiles.push([tr('Settings'), <GearSix key="g" size={40} />, { name: 'settings', section: 'general' }])
  return (
    <>
      <PageHeader title={tr('TV home')} />
      <div className="grid min-h-0 flex-1 grid-cols-3 content-start gap-4 overflow-y-auto pb-8">
        {tiles.map(([label, icon, view]) => (
          <button key={label} type="button" onClick={() => go(view)} className="flex h-40 flex-col items-center justify-center gap-3 rounded-2xl border border-line bg-raised text-xl font-medium hover:brightness-110">
            {icon}
            {label}
          </button>
        ))}
      </div>
    </>
  )
}
