'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { en, type Copy } from './content'

const Ctx = createContext<{ c: Copy; langs: string[] }>({ c: en, langs: ['en'] })

/** The page's text for the client parts below (Header, Hero, Story, Sections), and the languages that have a page. */
export function CopyProvider({ c, langs, children }: { c: Copy; langs: string[]; children: ReactNode }) {
  return <Ctx.Provider value={{ c, langs }}>{children}</Ctx.Provider>
}

export const useCopy = () => useContext(Ctx).c
export const useLangs = () => useContext(Ctx).langs
