// The website's demo: the app's own interface over a fake Tauri, invented data, no sound, no network.
import './tauri'

// Dynamic: static imports would run first, and the app reads Tauri as it loads.
await import('../../ui/src/main')
await import('./scenes')
