/** A pasted text that is a shared playlist: the website's link, the app's own, a QR code's text. Rust reads it (`music_core::share::parse`). */
export const isShareCode = (text: string) => /^(https:\/\/clovis500c\.github\.io\/legato\/l\/#|legato:\/\/playlist\/|LG1:)/i.test(text)
