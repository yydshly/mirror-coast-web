/** Colors are linear RGB, ready for a three.js vertex-color attribute. */
export interface PaletteEntry {
  name: string;
  color: [number, number, number];
  glow: number;
}

export const Material = {
  Air: 0,
  Rock: 1,
  Dirt: 2,
  Grass: 3,
  Sand: 4,
  Road: 5,
  Stripe: 6,
  Cream: 7,
  Brick: 8,
  Blue: 9,
  Roof: 10,
  Window: 11,
  DarkWindow: 12,
  Wood: 13,
  Leaves: 14,
  Concrete: 15,
  Red: 16,
  Lamp: 17,
  Trim: 18,
  Mint: 19,
  Terracotta: 20,
} as const;

function entry(name: string, hex: number, glow = 0): PaletteEntry {
  const linear = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return {
    name,
    color: [linear((hex >> 16) & 255), linear((hex >> 8) & 255), linear(hex & 255)],
    glow,
  };
}

export const palette: Record<number, PaletteEntry> = {
  [Material.Air]: entry('air', 0x000000),
  [Material.Rock]: entry('coastal stone', 0x667773),
  [Material.Dirt]: entry('earth', 0x8d7255),
  [Material.Grass]: entry('grass', 0x6c8055),
  [Material.Sand]: entry('sand', 0xd4bd90),
  [Material.Road]: entry('asphalt', 0x3c494d),
  [Material.Stripe]: entry('road marking', 0xe2ce91),
  [Material.Cream]: entry('warm stucco', 0xded3bd),
  [Material.Brick]: entry('salmon brick', 0xb46d53),
  [Material.Blue]: entry('powder blue', 0x7799a3),
  [Material.Roof]: entry('slate roof', 0x485960),
  [Material.Window]: entry('lit glass', 0x3f6876, 1),
  [Material.DarkWindow]: entry('blue glass', 0x223c49),
  [Material.Wood]: entry('timber', 0x82664b),
  [Material.Leaves]: entry('coastal canopy', 0x477461),
  [Material.Concrete]: entry('pavement', 0xb8b7ac),
  [Material.Red]: entry('lighthouse red', 0xb95544),
  [Material.Lamp]: entry('lamplight', 0xffdf9e, 1),
  [Material.Trim]: entry('pale cornice', 0xeee5cf),
  [Material.Mint]: entry('seafoam stucco', 0x99b3a1),
  [Material.Terracotta]: entry('terracotta tile', 0xa26049),
};
