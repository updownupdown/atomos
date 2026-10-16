/** "About this shape": the microscope sheet for each Atlas shape. A small drawing of the shape in
 *  its period colors, a few facts (when, by whom), then where it comes from, why it is drawn this
 *  way and how to read it. */
import { elementAt, placeColour } from './data';
import { layout, type LayoutId } from './layouts';

interface Story {
  facts: [string, string][];
  origin: string[];
  why: string[];
  read: string[];
}

const STORY: Record<LayoutId, Story> = {
  table: {
    facts: [['First drawn', '1869'], ['By', 'D. Mendeleev'], ['This form', '1945']],
    origin: [
      'Dmitri Mendeleev set the 63 elements known in 1869 in order of weight and saw their behavior repeat. He left gaps for elements nobody had found yet, and predicted gallium, scandium and germanium before they were discovered.',
      'In 1913 Henry Moseley showed that the true order is the atomic number, the charge of the nucleus. In 1945 G. T. Seaborg moved the actinides out into their own row, which gave the table the shape it has today.',
    ],
    why: [
      'Each row is a period: one more shell of electrons. Each column is a group: atoms with the same outer electrons, which is why they react alike.',
      'The f block (cerium to lutetium, thorium to lawrencium) belongs between groups 3 and 4 of periods 6 and 7. Set inside, it would make the table more than twice as wide, so it sits below.',
    ],
    read: ['Read left to right, top to bottom, and the atomic number climbs by one each step. Down a column, the atoms are cousins.'],
  },
  ribbon: {
    facts: [['First drawn', '1975'], ['By', 'J. F. Hyde'], ['Track', 'Unbroken']],
    origin: [
      'James Franklin Hyde, a chemist at Dow Corning and a father of silicone, drew his chart of "the chemical elements and their periodic relationships" in 1975 to show that the elements never really break into rows.',
    ],
    why: [
      'In the usual table each period stops at the right edge and the next starts again at the left. On the ribbon the groups run round one loop, so each noble gas flows straight into the next alkali metal.',
      'The d block only starts in period 4, so periods 4 to 7 share the long loop, one lane each from the inside out. Periods 1 to 3 curl up in rings inside it, lined up with their groups.',
      'The f block rises from the loop as a ring of its own, between groups 3 and 4 where it belongs: cerium to lutetium on the inner lane, thorium to lawrencium on the outer.',
    ],
    read: ['Follow one lane round the loop and you read a whole period. Cross the lanes at one spot and you read a group.'],
  },
  spiral: {
    facts: [['First spiral', '1862'], ['By', 'A. de Chancourtois'], ['Turns', '7']],
    origin: [
      'The geologist Alexandre-Émile Béguyer de Chancourtois wound the elements round a cylinder in 1862, his "telluric screw", and noticed that alike elements fell one above the other. It was the first chart to show the pattern, seven years before Mendeleev.',
      'Spirals have been drawn ever since. Theodor Benfey\'s of 1964 is the best known.',
    ],
    why: [
      'A spiral has no edges, so like the ribbon it never breaks a period in two. Each turn is one period, and a new turn starts when electrons begin a new shell, with an alkali metal.',
      'Later turns hold more atoms because the d and f orbitals open up, which is why the spiral widens as it grows.',
    ],
    read: ['Every turn ends with a noble gas, whose outer shell is full, so the noble gases line up along the seam at the top.'],
  },
  circle: {
    facts: [['Rings', '7'], ['Spokes', '18 groups'], ['Center', 'H and He']],
    origin: [
      'Round tables are almost as old as the square one: chemists have drawn the elements in circles since the 19th century, looking for a shape that shows the repeat without any edges.',
    ],
    why: [
      'One ring per period, from hydrogen and helium in the middle outward. Each spoke is a group, so elements that behave alike line up from the center out.',
      'The s and p groups take wider spokes than the d groups. Periods 2 and 3 have no d block, so their rings stay open on that side.',
    ],
    read: ['Walk round a ring to read a period; walk out along a spoke to read a group. The f block hangs below as two arcs, cerium to lutetium inside and thorium to lawrencium outside.'],
  },
  sizes: {
    facts: [['Radius', 'van der Waals'], ['Smallest', 'H, 110 pm'], ['Largest', 'Fr, 348 pm']],
    origin: [
      'Johannes van der Waals explained in 1873 why real gases are not ideal: their atoms take up room and pull on each other. The size an atom keeps when others come close is named after him, and A. Bondi\'s table of 1964 made it the standard measure.',
    ],
    why: [
      'Every other shape draws each atom the same size. This one draws each to scale, so you can see how much room it takes up. The radii of the heaviest atoms are estimates.',
      'Atoms grow down each group, as every period adds a shell of electrons further out. Across a period they mostly shrink, because the growing charge of the nucleus pulls the same shell in tighter.',
    ],
    read: ['The circle is how close another atom can come before they push apart. Cesium and francium are the giants, about three times as wide as hydrogen.'],
  },
  steps: {
    facts: [['First drawn', '1928'], ['By', 'C. Janet'], ['Rows', '8']],
    origin: [
      'Charles Janet, a French engineer who also studied ants, drew his left-step table in 1928. Physicists like it because it follows the quantum rules exactly, with no exceptions to explain away.',
    ],
    why: [
      'Each row gathers the orbitals with the same n + l, which is the order electrons fill them in: 1s, then 2s, then 2p and 3s, and so on.',
      'So the blocks sit side by side as steps, f, d, p and s from left to right, and every row ends with an s block. Helium sits over beryllium, with the other atoms that fill an s orbital.',
    ],
    read: ['Read each row left to right in the order electrons arrive. Two dashed seats wait at the foot of the s block for elements 119 and 120, which nobody has made yet.'],
  },
  pyramid: {
    facts: [['First drawn', '1895'], ['By', 'J. Thomsen'], ['Redrawn', 'N. Bohr, 1922']],
    origin: [
      'The Danish chemist Julius Thomsen drew the elements as a pyramid in 1895. Niels Bohr redrew it in 1922 for his theory of the atom, and used it in his Nobel lecture to explain why the table has the shape it has.',
    ],
    why: [
      'The columns grow from 2 to 8, 8, 18, 18, 32 and 32 atoms, because each new kind of orbital (p, then d, then f) makes room for more electrons. That is why the table widens.',
    ],
    read: ['Each column is one period, read from top to bottom. Each link joins an atom to the member of its family in the next period, so you can follow a group from column to column.'],
  },
};

/** The shape in miniature: every cell in its period color, no text. Collect shows it the
 *  moment a period is finished. */
export function shapeFigure(id: LayoutId): string {
  const l = layout(id);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of l.cells) {
    const r = Math.max(c.w, c.h) * 0.75;
    x0 = Math.min(x0, c.x - r); y0 = Math.min(y0, c.y - r); x1 = Math.max(x1, c.x + r); y1 = Math.max(y1, c.y + r);
  }
  const links = (l.decor ?? []).map((d) => `<path d="${d.d}" class="ss-${d.kind}"/>`).join('');
  const cells = l.cells.map((c) => `<path d="${c.d}" fill="${placeColour(elementAt(c.z))}"/>`).join('');
  return `<svg class="ss-fig" viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}" role="img" aria-label="The shape in miniature">${links}${cells}</svg>`;
}

const section = (title: string, ps: string[]) => `<h3>${title}</h3>${ps.map((p) => `<p>${p}</p>`).join('')}`;

/** The sheet's body for one shape, under its title. */
export function shapeStory(id: LayoutId): string {
  const s = STORY[id];
  return `<div class="ss">${shapeFigure(id)}
    <dl class="ss-facts">${s.facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
    ${section('Where it comes from', s.origin)}${section('Why draw it this way', s.why)}${section('How to read it', s.read)}</div>`;
}
