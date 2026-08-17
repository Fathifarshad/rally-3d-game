# 3D models

Drop a real car model here as:

```
public/assets/models/nissan_z.glb
```

The game checks for that exact path at start-up (`src/core/AssetLoader.ts`).
If the file exists it is loaded, auto-scaled to a 4.38 m wheelbase-correct
length, centred on the ground and used instead of the built-in procedural
model. If it is missing, the procedural Nissan Z is used and nothing breaks.

## Getting the most out of a real model

The loader looks at object names inside the GLB:

| Name contains            | Used as                                  |
| ------------------------ | ---------------------------------------- |
| `wheel`, `tyre`, `tire`, `rim` | Rolling/steering wheels (needs 4+) |
| `steer`                  | Steering wheel (rotated with the input)  |
| `body`, `paint`, `carpaint` | Material recoloured by the garage paint picker |

Model requirements:

- Format: **GLB** (binary glTF 2.0), Y-up.
- Front of the car facing **+Z** (if it faces +X the loader rotates it).
- Origin roughly at the centre of the car; the loader drops it onto the ground.
- Keep it under ~15 MB and use compressed (JPG/PNG) textures for fast loading.
