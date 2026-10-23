export type Hint = 'longer' | 'lower' | 'upper' | 'digit' | 'symbol' | 'repeats' | 'common'

const CLASSES: [Hint, RegExp, number][] = [
  ['lower', /[a-z]/, 26],
  ['upper', /[A-Z]/, 26],
  ['digit', /\d/, 10],
  ['symbol', /[^a-zA-Z\d]/, 33],
]
const COMMON = /password|motdepasse|azerty|qwerty|123456|abcdef|azertyuiop|iloveyou|soleil|bonjour/i

/** Rough strength, 0 (too short) to 4 (very strong), plus what to add. Brute-force bits with penalties, no dictionary. */
export function strength(pw: string, min: number): { level: 0 | 1 | 2 | 3 | 4; hints: Hint[] } {
  const hints: Hint[] = []
  let pool = 0
  for (const [hint, re, size] of CLASSES) {
    if (re.test(pw)) pool += size
    else hints.push(hint)
  }
  let bits = pw.length * Math.log2(Math.max(pool, 1))
  if (new Set(pw).size < pw.length / 2) {
    bits /= 2
    hints.push('repeats')
  }
  if (COMMON.test(pw)) {
    bits /= 2
    hints.push('common')
  }
  if (pw.length < 16) hints.unshift('longer')
  const level = pw.length < min ? 0 : bits < 50 ? 1 : bits < 70 ? 2 : bits < 90 ? 3 : 4
  return { level, hints }
}

// 268 distinct words: ~8 bits each.
const WORDS = `amber anchor apple arrow aspen atlas autumn badge bamboo banjo barley basil beacon berry birch bison blanket blossom
bonfire breeze brick bridge bronze brook bubble cabin cactus camel candle canyon carbon cargo castle cedar cello chalk cherry
chess cider circus citrus clover cobalt comet copper coral cotton cousin crane crater crystal cypress daisy delta denim desert
dolphin domino dragon drum dune eagle echo ember emerald falcon feather fern fiddle fig flame flint forest fossil fox galaxy
garden garnet geyser ginger glacier globe granite grape gravel guitar hammer harbor harp hazel heron hickory honey horizon
igloo indigo iris island ivory jacket jade jaguar jasmine jelly jungle kayak kettle kiwi koala lagoon lantern laser lemon
lilac lily linen lizard llama lobster lotus lunar magnet mango maple marble meadow melon meteor mint mirror monsoon moose
mosaic moss nectar needle nickel noodle nutmeg oak oasis ocean olive onyx orbit orchid otter owl paddle palm panda paper
parrot pearl pebble pepper piano pilot pine planet plum polar poppy prism pumpkin quail quartz quill rabbit radar raven reef
ribbon river robin rocket rose ruby saddle saffron salmon sapphire satin scarf shadow shell silver sketch sled slate snow
sonar spark sparrow spice spruce squid stone storm sugar summit sunset swan tango thistle thunder tiger timber toast topaz
torch trumpet tulip tundra turtle umbrella valley vanilla velvet violin volcano wafer walnut walrus willow window winter
wizard wolf yarn yeti zebra zephyr acorn alpine badger beetle bramble buffalo canvas caramel cinder clay cocoa compass
cricket dahlia dew drift elk fable flannel frost gazelle glimmer hollow juniper lark lemur marsh mesa mocha nimbus oyster
pecan quiver raft sage`.split(/\s+/)

/** Random passphrase: 5 capitalized words + 2 digits, dash-joined (~47 bits; Argon2id in Rust makes guessing slow). */
export function passphrase(): string {
  const n = new Uint32Array(6)
  crypto.getRandomValues(n)
  const words = [...n.slice(0, 5)].map((r) => WORDS[r % WORDS.length]).map((w) => w[0].toUpperCase() + w.slice(1))
  words.splice(2, 0, String(10 + (n[5] % 90)))
  return words.join('-')
}
