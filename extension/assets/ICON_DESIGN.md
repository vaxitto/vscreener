# Icon design reference

The original static icons shipped with the extension have been removed so that
you can regenerate them yourself. This note documents their appearance and the
palette that was used.

## Canvas sizes

Icons were provided at 16, 32, 48, and 128 px. Each size shared the same layout
and colours.

## Colours

| Purpose            | Hex       | Notes                                        |
| ------------------ | --------- | -------------------------------------------- |
| Background         | `#101018` | Near-black background that fills the canvas. |
| Accent (solid)     | `#7F00FF` | Used for the solid stripe on the left edge.  |
| Accent (soft glow) | `#7F00FF` | Reused with ~70% opacity for the diagonal fill. |
| Highlight          | `#C8C8FF` | Applied at ~70% opacity near the diagonal tip. |

## Layout

1. Fill the entire canvas with the background colour.
2. Paint a vertical accent stripe along the left edge that is roughly 4 pixels
   wide on the 128 px asset (scale proportionally for the smaller sizes).
3. Starting from the upper-left interior, overlay a diagonal accent shape that
   stretches from the top edge toward the lower-right corner. The shape fades
   from the semi-transparent accent colour into the lighter highlight colour to
   create a soft gradient.

This composition results in a minimalist dark tile with a vivid violet edge and
an angular glow that hints at a scrolling page. Feel free to recreate the PNGs
with these guidelines or customise the colours as needed.
