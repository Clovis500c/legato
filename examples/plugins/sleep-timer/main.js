// Sleep timer: pauses the music after a while, fading out over the last 30 seconds.
// A Legato plugin (docs/plugins.md). Runs in its own sandbox: everything goes through `app`.

const FADE_MS = 30_000

let minutes = 30
let endsAt = null
let tick = null
let volume = 1

const left = () => Math.max(0, Math.ceil((endsAt - Date.now()) / 60_000))

function panel() {
  return app.ui.setPanel([
    { type: 'heading', text: 'Sleep timer' },
    {
      type: 'text',
      muted: true,
      text: endsAt ? `The music pauses in ${left()} min.` : 'Pauses the music after a while, fading out over the last 30 seconds.',
    },
    { type: 'slider', id: 'minutes', label: 'Minutes', min: 5, max: 120, step: 5, value: minutes },
    {
      type: 'row',
      children: endsAt ? [{ type: 'button', id: 'cancel', label: 'Cancel' }] : [{ type: 'button', id: 'start', label: `Start (${minutes} min)`, primary: true }],
    },
  ])
}

async function start() {
  volume = (await app.player.state()).volume
  endsAt = Date.now() + minutes * 60_000
  clearInterval(tick)
  tick = setInterval(step, 1000)
  await app.storage.set('minutes', minutes)
  await app.ui.notify(`Pausing in ${minutes} min`)
  await panel()
}

async function stop(restore) {
  clearInterval(tick)
  tick = null
  endsAt = null
  if (restore) await app.player.volume(volume)
  await panel()
}

async function step() {
  const ms = endsAt - Date.now()
  if (ms <= 0) {
    await app.player.pause()
    await stop(true)
    await app.ui.notify('Good night')
  } else if (ms <= FADE_MS) {
    await app.player.volume((volume * ms) / FADE_MS)
  } else if (ms % 60_000 < 1000) {
    await panel()
  }
}

app.on('panel', ({ id, value }) => {
  if (id === 'minutes') {
    minutes = value
    panel()
  } else if (id === 'start') start()
  else if (id === 'cancel') stop(true)
})

app.ui.addCommand({ id: 'sleep', title: 'Sleep timer: pause in 30 min', where: ['player'], run: () => ((minutes = 30), start()) })

app.storage.get('minutes').then((m) => {
  if (typeof m === 'number') minutes = m
  panel()
})
