/** A pasted or opened text that is a remix link (`legato://remix/…`, music_dsp::lmix): Rust reads and checks it. */
export const isRemixLink = (text: string) => /^legato:\/\/remix\/[A-Za-z0-9_-]+$/i.test(text.trim())
