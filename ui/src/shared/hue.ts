/** A hue (0-359) from a name: the same name always gets the same colour when it has no picture to take one from. */
export function hueOf(name: string): number {
  let h = 0
  for (const c of name) h = (h * 31 + c.codePointAt(0)!) % 360
  return h
}

/** First letter or digit of a name, upper case ("?" when it has none): the mark of a tile without a picture. */
export function initialOf(name: string): string {
  const m = name.match(/[\p{L}\p{N}]/u)
  return m ? m[0].toUpperCase() : '?'
}
