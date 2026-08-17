# Sounds

Every sound in the game is **synthesised with the Web Audio API by default**,
so no files are required. To use real recordings, drop them in here with these
exact names and they are picked up automatically at start-up:

| File            | Used for                                                    |
| --------------- | ----------------------------------------------------------- |
| `engine.mp3`    | Looping engine note (playback rate follows RPM)              |
| `brake.mp3`     | Brake squeal                                                 |
| `tire.mp3`      | Tyre scrub / drift squeal                                    |
| `collision.mp3` | Impacts                                                      |
| `nitro.mp3`     | Nitro activation burst                                       |
| `music.mp3`     | Looping background music                                     |

Notes:

- `engine.mp3` should be a **seamless loop** of a steady engine note; the game
  changes its playback rate rather than crossfading samples.
- Anything missing simply falls back to the synthesised version, so you can
  replace them one at a time.
- Audio only starts after the first click (browser autoplay policy).
