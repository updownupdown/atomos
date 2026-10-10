# Icons

Drop a 24×24 SVG in this folder and it becomes an icon in the app, named after the file
(`view-cloud.svg` → `'view-cloud'`). `npm run dev` and `npm run build` pick new files up on
their own; `npm run icons` regenerates by hand. Open `/src/icons/preview.html` in the dev
server to see every icon at 24 and 48 px on dark and light.

Drawing rules:
- `viewBox="0 0 24 24"`; the shape about 20 units tall and centred, 2 units of padding.
- One colour. Black (or any solid colour) becomes `currentColor`, so icons follow the text colour.
- Seed icons use a 1.25 stroke with round caps and joins; dots and nucleons are solid,
  neutrons hollow, shells broken with an electron in the gap, like the logo.

In code:

```ts
import { icon, iconEl } from './ui/icons';
button.innerHTML = icon('close');                  // decorative, 24 px
button.innerHTML = icon('settings', { size: 20 });
el.append(iconEl('info', { label: 'Instructions' }));
```
